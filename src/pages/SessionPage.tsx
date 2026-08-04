import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle2, Clock3, Plus, Timer, X } from 'lucide-react';
import { Alert } from '@/components/Alert';
import { AppShell } from '@/components/AppShell';
import { RestMode } from '@/components/RestMode';
import { ExerciseMedia } from '@/components/ExerciseMedia';
import { ExerciseTargetFields } from '@/components/ExerciseTargetFields';
import { MediaLightbox } from '@/components/MediaLightbox';
import { SectionCard } from '@/components/SectionCard';
import { Button, IconButton } from '@/components/ui/Button';
import { CheckboxField, SelectField, TextArea } from '@/components/ui/Field';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SessionBlockCard } from '@/components/SessionBlockCard';
import {
  SessionExerciseStage,
  SessionPartnerRow,
  type ActiveSetAction,
} from '@/components/SessionExerciseStage';
import { SessionStatsHeader } from '@/components/SessionStatsHeader';
import { db } from '@/db/appDb';
import {
  abortSession,
  addSessionExercise,
  clearRestTimer,
  clearSetTimer,
  completeSession,
  deleteSetLog,
  extendRestTimer,
  finishSetTimer,
  groupSessionExerciseWithPrevious,
  pruneRestTimers,
  reorderSessionExercises,
  startRestTimerForSetLog,
  startSetTimer,
  toggleSkipSessionExercise,
  ungroupSessionExercise,
} from '@/db/session-actions';
import { loadLastValuesForExercises } from '@/db/history-queries';
import { sortSetLogs } from '@/domain/history';
import type {
  MediaAsset,
  RestTimerTrack,
  WorkoutSessionExercise,
  WorkoutSetLog,
} from '@/domain/models';
import {
  findRestTrack,
  isRestTrackReady,
  REST_TIMER_STEP_SECONDS,
  remainingRestSeconds,
  restTrackKey,
  selectPrimaryRestTrack,
} from '@/domain/rest-timer';
import { resolveNextFocus } from '@/domain/session';
import { elapsedSetTimerSeconds, remainingSetTimerSeconds } from '@/domain/set-timer';
import { buildSupersetBlocks, moveSupersetBlock, moveWithinGroup } from '@/domain/superset';
import {
  buildSessionBlockProgress,
  buildSetRounds,
  describeSetRow,
  describeSetRowValues,
  setRowFallback,
  summarizeSessionProgress,
  type SessionExerciseProgress,
} from '@/domain/session-summary';
import { supportsBand, supportsReps, supportsSeconds, supportsWeight } from '@/domain/tracking';
import {
  formatDateTime,
  formatSessionWeekContext,
  formatSideLabel,
  formatTimer,
  formatTrackingMode,
} from '@/lib/format';
import { optionalNumberInput } from '@/lib/number-input';
import { isChimeFresh, playTimerChime, primeTimerSound } from '@/lib/sound';
import { cn } from '@/lib/utils';
import { Sheet } from '@/components/ui/Sheet';
import { useUiStore } from '@/store/ui-store';

interface SessionExerciseFormState {
  exerciseId: string;
  workSetCount: string;
  includeWarmup: boolean;
  targetReps: string;
  targetSeconds: string;
  targetWeight: string;
  targetBandId: string;
  restSeconds: string;
  notes: string;
}

const defaultSessionExerciseFormState: SessionExerciseFormState = {
  exerciseId: '',
  workSetCount: '3',
  includeWarmup: true,
  targetReps: '',
  targetSeconds: '',
  targetWeight: '',
  targetBandId: '',
  restSeconds: '',
  notes: '',
};

/** Stabile Identität für "keine Pause läuft" - siehe die Effekt-Deps unten. */
const EMPTY_REST_TIMERS: RestTimerTrack[] = [];

/**
 * Wie oft nach abgelaufener Karenzzeit gesucht wird.
 *
 * Gemessen an den zehn Minuten Karenz ist eine halbe Minute genau genug, und
 * gröber als der Sekundentakt zu sein ist Absicht: [pruneRestTimers] schreibt
 * zwar nur bei echter Änderung, aber jeder Lauf ist eine Dexie-Transaktion.
 */
const REST_PRUNE_INTERVAL_MS = 30_000;

/**
 * Sortierung aller Pausenanzeigen: was zuerst wieder frei ist, steht vorn.
 *
 * Die Einfügereihenfolge wäre die des Abhakens - für den Blick auf die Leiste
 * ohne Bedeutung.
 */
function byRestTrackEnd(left: RestTimerTrack, right: RestTimerTrack) {
  return left.endsAt - right.endsAt;
}

interface PendingSetLogDelete {
  log: WorkoutSetLog;
  exerciseName: string;
}

/**
 * Die Session-Steuerung steht zweimal auf der Seite - einmal über den Übungen,
 * einmal darunter. Bei einer langen Session ist der untere Block erst nach
 * vielen Wischern erreichbar, bei einer kurzen liegt der obere im Weg; welcher
 * der nähere ist, entscheidet sich erst beim Training.
 */
type SessionControlsPlacement = 'top' | 'bottom';

function groupLogsByExercise(setLogs: WorkoutSetLog[]) {
  return setLogs.reduce<Record<string, WorkoutSetLog[]>>((groups, item) => {
    if (!groups[item.sessionExerciseId]) {
      groups[item.sessionExerciseId] = [];
    }

    groups[item.sessionExerciseId].push(item);
    return groups;
  }, {});
}

export function SessionPage() {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  // Selektoren statt des ganzen Stores: sonst rendert jede Netzwerk- oder
  // Update-Statusänderung diese Seite komplett neu.
  const activeSessionExerciseId = useUiStore((state) => state.activeSessionExerciseId);
  const setActiveSessionExerciseId = useUiStore((state) => state.setActiveSessionExerciseId);
  const openSessionBlockKey = useUiStore((state) => state.openSessionBlockKey);
  const setOpenSessionBlockKey = useUiStore((state) => state.setOpenSessionBlockKey);
  const minimizedRestKey = useUiStore((state) => state.minimizedRestKey);
  const setMinimizedRestKey = useUiStore((state) => state.setMinimizedRestKey);
  const [now, setNow] = useState(Date.now());
  const [sessionError, setSessionError] = useState<string | null>(null);
  /*
   * Das Formular gehört zu dem Block, über den es geöffnet wurde: sonst
   * klappten beide Blöcke gleichzeitig auf und man tippte in ein Formular,
   * während das zweite unbemerkt dieselben Werte zeigt.
   */
  const [addExerciseFormAnchor, setAddExerciseFormAnchor] =
    useState<SessionControlsPlacement | null>(null);
  const [isSavingExercise, setIsSavingExercise] = useState(false);
  const [isReorderingExercises, setIsReorderingExercises] = useState(false);
  const [isClosingSession, setIsClosingSession] = useState(false);
  const [sessionExerciseOrder, setSessionExerciseOrder] = useState<string[]>([]);
  const [pendingSetLogDelete, setPendingSetLogDelete] = useState<PendingSetLogDelete | null>(null);
  const [isDeletingSetLog, setIsDeletingSetLog] = useState(false);
  const [mediaPreview, setMediaPreview] = useState<{
    mediaAsset: MediaAsset;
    alt: string;
  } | null>(null);
  const [exerciseForm, setExerciseForm] = useState<SessionExerciseFormState>(
    defaultSessionExerciseFormState,
  );
  /** Spuren, deren Ablauf schon gemeldet wurde - siehe den Effekt unten. */
  const notifiedRestKeysRef = useRef<Set<string>>(new Set());

  const session = useLiveQuery(() => db.workoutSessions.get(sessionId), [sessionId]);
  const restTimers = session?.restTimers ?? EMPTY_REST_TIMERS;
  const hasRestTimers = restTimers.length > 0;
  const setTimer = session?.setTimer;
  // Primitiven statt des Objekts: useLiveQuery liefert bei jedem Emit eine neue
  // Identität, an der die Effekte unten sonst dauernd neu anspringen würden.
  const setTimerEndsAt = setTimer?.endsAt ?? null;
  const setTimerDurationSeconds = setTimer?.durationSeconds ?? null;
  const appSettings = useLiveQuery(() => db.appSettings.get('app-settings'), []);
  // Additiv wie includeWarmup: nur ein ausdrückliches Aus schaltet den Ton ab.
  const timerSoundEnabled = appSettings?.timerSoundEnabled !== false;
  const availableExercises = useLiveQuery(() => db.exercises.orderBy('name').toArray(), []);
  const bandLevels = useLiveQuery(() => db.bandLevels.orderBy('orderIndex').toArray(), []);
  const sessionExercises = useLiveQuery(
    () => db.workoutSessionExercises.where('sessionId').equals(sessionId).sortBy('orderIndex'),
    [sessionId],
  );
  const setLogs = useLiveQuery(async () => {
    const items = await db.workoutSessionExercises.where('sessionId').equals(sessionId).toArray();

    if (items.length === 0) {
      return [];
    }

    return db.workoutSetLogs.where('sessionExerciseId').anyOf(items.map((item) => item.id)).toArray();
  }, [sessionId]);
  const lastValues = useLiveQuery(async () => {
    const currentExercises = await db.workoutSessionExercises
      .where('sessionId')
      .equals(sessionId)
      .toArray();

    if (currentExercises.length === 0) {
      return {};
    }

    return loadLastValuesForExercises(
      [...new Set(currentExercises.map((item) => item.exerciseId))],
      sessionId,
    );
  }, [sessionId]);
  const orderedSessionExercises = useMemo(() => {
    if (!sessionExercises) {
      return [];
    }

    const exerciseById = new Map(sessionExercises.map((item) => [item.id, item]));
    const orderedItems = sessionExerciseOrder
      .map((itemId) => exerciseById.get(itemId))
      .filter((item): item is WorkoutSessionExercise => Boolean(item));

    return orderedItems.length === sessionExercises.length ? orderedItems : sessionExercises;
  }, [sessionExerciseOrder, sessionExercises]);

  useEffect(() => {
    if (orderedSessionExercises.length && !activeSessionExerciseId) {
      setActiveSessionExerciseId(orderedSessionExercises[0].id);
    }
  }, [activeSessionExerciseId, orderedSessionExercises, setActiveSessionExerciseId]);

  useEffect(() => {
    if (!orderedSessionExercises.length) {
      return;
    }

    if (!orderedSessionExercises.some((item) => item.id === activeSessionExerciseId)) {
      setActiveSessionExerciseId(orderedSessionExercises[0].id);
    }
  }, [activeSessionExerciseId, orderedSessionExercises, setActiveSessionExerciseId]);

  useEffect(() => {
    if (!sessionExercises) {
      return;
    }

    setSessionExerciseOrder(sessionExercises.map((item) => item.id));
  }, [sessionExercises]);

  useEffect(() => {
    if (!timerSoundEnabled) {
      return;
    }

    /*
     * Früh genug freischalten: der Ablauf eines Timers ist keine Nutzergeste,
     * ein gesperrter AudioContext bliebe dort stumm. Der Aufruf hängt sich an
     * die erste Berührung auf dieser Seite - die kommt spätestens beim
     * Starten des Timers, dessen Ablauf zu melden ist.
     */
    primeTimerSound();
  }, [timerSoundEnabled]);

  useEffect(() => {
    // Ein Takt für alle Uhren: es können mehrere Pausen und ein Satz-Timer
    // gleichzeitig laufen, sie brauchen aber dieselbe Sekundenauflösung.
    if (!hasRestTimers && !setTimerEndsAt) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    // Nach dem Zurückwechseln aus dem Hintergrund sofort neu rechnen, statt
    // auf den nächsten - vom Browser gedrosselten - Intervall zu warten.
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setNow(Date.now());
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [hasRestTimers, setTimerEndsAt]);

  /*
   * Schlüssel der gerade abgelaufenen Pausen, als String stabil vergleichbar.
   * Die Spuren selbst taugen nicht als Effekt-Abhängigkeit: useLiveQuery
   * liefert bei jedem Emit ein neues Array.
   *
   * Das angehängte Ende trägt den Zeitpunkt mit in den Effekt, ohne dass er
   * die Spuren selbst braucht - der Ton hängt davon ab, wie lange der Ablauf
   * her ist. Verlängert [extendRestTimer] eine Spur, ist es ohnehin ein neuer
   * Ablauf, der wieder gemeldet werden soll.
   */
  const expiredRestTrackKeys = restTimers
    .filter((track) => isRestTrackReady(track, now))
    .map((track) => `${restTrackKey(track.sessionExerciseId, track.side)}@${track.endsAt}`)
    .join('|');

  useEffect(() => {
    const expiredKeys = expiredRestTrackKeys ? expiredRestTrackKeys.split('|') : [];

    /*
     * Die Erinnerung gilt nur für aktuell abgelaufene Spuren: startet dieselbe
     * Seite eine neue Pause, soll ihr Ablauf wieder vibrieren. Ein Reload
     * verliert höchstens eine Vibration - der Zustand gehört nicht in die
     * Datenbank.
     */
    notifiedRestKeysRef.current = new Set(
      [...notifiedRestKeysRef.current].filter((key) => expiredKeys.includes(key)),
    );

    const freshKeys = expiredKeys.filter((key) => !notifiedRestKeysRef.current.has(key));

    if (freshKeys.length === 0) {
      return;
    }

    for (const key of freshKeys) {
      notifiedRestKeysRef.current.add(key);
    }

    // Beim Ablauf spürbar melden - im Gym liegt das Telefon in der Tasche.
    if (typeof navigator.vibrate === 'function') {
      navigator.vibrate([180, 90, 180]);
    }

    /*
     * Hörbar nur, wenn der Ablauf gerade passiert ist: kommt die App nach
     * Minuten im Hintergrund zurück, meldet sie lauter Vergangenheit.
     */
    const chimeWorthy = freshKeys.some((key) => {
      const endsAt = Number(key.slice(key.lastIndexOf('@') + 1));

      return Number.isFinite(endsAt) && isChimeFresh(endsAt, Date.now());
    });

    if (timerSoundEnabled && chimeWorthy) {
      playTimerChime();
    }

  }, [expiredRestTrackKeys, sessionId, timerSoundEnabled]);

  /*
   * Abgelaufene Spuren bleiben zunächst stehen und melden "bereit" - genau das
   * sucht man beim Zurückwechseln. Weggeräumt werden sie erst nach der
   * Karenzzeit, und dafür braucht es einen eigenen Takt.
   *
   * Am Ablauf-Ereignis hing der Aufruf hier früher, und dort konnte er nichts
   * ausrichten: in der Sekunde des Ablaufs ist die Karenz noch keine zehn
   * Minuten alt. Danach kam kein zweiter Anlass mehr, also blieb ein "bereit"
   * beliebig lange stehen - bis zufällig eine neue Pause startete, die beim
   * Schreiben ohnehin aufräumt.
   */
  useEffect(() => {
    if (!hasRestTimers) {
      return undefined;
    }

    // Auch sofort: nach Minuten im Hintergrund ist beim Zurückkommen die halbe
    // Leiste veraltet, und darauf will niemand erst den nächsten Takt abwarten.
    void pruneRestTimers(sessionId);

    const timer = window.setInterval(() => {
      void pruneRestTimers(sessionId);
    }, REST_PRUNE_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [hasRestTimers, sessionId]);

  useEffect(() => {
    if (!setTimerEndsAt || !setTimerDurationSeconds || setTimerEndsAt > now) {
      return;
    }

    // Dasselbe Signal wie am Ende der Pause: beim Plank liegt das Telefon
    // neben der Matte und wird nicht angesehen.
    if (typeof navigator.vibrate === 'function') {
      navigator.vibrate([180, 90, 180]);
    }

    if (timerSoundEnabled && isChimeFresh(setTimerEndsAt, Date.now())) {
      playTimerChime();
    }

    // Durchgehalten heißt: die volle gestartete Zeit landet im Satz.
    void finishSetTimer(sessionId, setTimerDurationSeconds);
  }, [now, sessionId, setTimerDurationSeconds, setTimerEndsAt, timerSoundEnabled]);

  useEffect(() => {
    if (!availableExercises?.length) {
      return;
    }

    setExerciseForm((current) => {
      if (
        current.exerciseId &&
        availableExercises.some((exercise) => exercise.id === current.exerciseId)
      ) {
        return current;
      }

      return {
        ...current,
        exerciseId: availableExercises[0].id,
      };
    });
  }, [availableExercises]);

  const groupedLogs = useMemo(() => groupLogsByExercise(setLogs ?? []), [setLogs]);
  const availableExerciseById = Object.fromEntries(
    (availableExercises ?? []).map((exercise) => [exercise.id, exercise]),
  );
  const focusedExercise =
    orderedSessionExercises.find((item) => item.id === activeSessionExerciseId) ?? orderedSessionExercises[0];

  /*
   * Genau die Bilder dieser Session laden, nicht die ganze Tabelle: ein
   * `toArray()` über mediaAssets zöge sämtliche Blobs in den Speicher.
   * `bulkGet` hält das auf die Übungen der laufenden Session begrenzt.
   */
  const sessionMediaIds = useMemo(() => {
    const ids = orderedSessionExercises
      .map((item) => availableExerciseById[item.exerciseId]?.mediaAssetId)
      .filter((id): id is string => Boolean(id));

    return [...new Set(ids)].sort();
  }, [availableExerciseById, orderedSessionExercises]);
  const mediaAssetById = useLiveQuery(
    async () => {
      if (sessionMediaIds.length === 0) {
        return {} as Record<string, MediaAsset>;
      }

      const assets = await db.mediaAssets.bulkGet(sessionMediaIds);

      return Object.fromEntries(
        assets.filter((asset): asset is MediaAsset => Boolean(asset)).map((asset) => [asset.id, asset]),
      );
    },
    // Die Liste selbst ist die Abhängigkeit; als String stabil vergleichbar.
    [sessionMediaIds.join(',')],
  );

  function mediaAssetForExercise(sessionExercise?: WorkoutSessionExercise) {
    const mediaAssetId = sessionExercise
      ? availableExerciseById[sessionExercise.exerciseId]?.mediaAssetId
      : undefined;

    return mediaAssetId ? mediaAssetById?.[mediaAssetId] : undefined;
  }

  /*
   * Die Sätze der Übung, in der der Fokus steht - die Grundlage der Bühne im
   * Sheet, der Pausenauswahl und des Streifens im Sheet-Kopf.
   */
  const focusedExerciseId = focusedExercise?.id;
  const sortedFocusedLogs = useMemo(
    () => sortSetLogs(focusedExerciseId ? (groupedLogs[focusedExerciseId] ?? []) : []),
    [focusedExerciseId, groupedLogs],
  );

  /*
   * Die große Zahl gehört der Pause, auf die gerade gewartet wird: der
   * fokussierten Übung und dort der Seite, die als Nächstes drankommt. Alle
   * anderen laufenden Pausen stehen als Chips daneben.
   */
  const nextOpenFocusedSide = sortedFocusedLogs.find((log) => !log.completed)?.side;
  const primaryRestTrack = selectPrimaryRestTrack(
    restTimers,
    focusedExercise?.id,
    nextOpenFocusedSide,
    now,
  );
  const remainingSeconds = remainingRestSeconds(primaryRestTrack, now);
  const secondaryRestTracks = restTimers
    .filter((track) => track !== primaryRestTrack)
    .sort(byRestTrackEnd);
  const restTracksByExerciseId = useMemo(
    () =>
      [...restTimers]
        .sort(byRestTrackEnd)
        .reduce<Record<string, RestTimerTrack[]>>((groups, track) => {
          groups[track.sessionExerciseId] = [...(groups[track.sessionExerciseId] ?? []), track];
          return groups;
        }, {}),
    [restTimers],
  );
  const sessionBlocks = useMemo(
    () => buildSupersetBlocks(orderedSessionExercises),
    [orderedSessionExercises],
  );
  /*
   * Der Stand je Block trägt die Liste, das Sheet und die Automatik beim
   * Schließen. Er wird deshalb einmal berechnet und nicht dreimal abgeleitet.
   */
  const blockProgress = useMemo(
    () =>
      buildSessionBlockProgress(sessionBlocks, groupedLogs, activeSessionExerciseId ?? undefined),
    [activeSessionExerciseId, groupedLogs, sessionBlocks],
  );
  const sessionProgress = useMemo(() => summarizeSessionProgress(setLogs ?? []), [setLogs]);
  const openBlock = blockProgress.find((block) => block.key === openSessionBlockKey);
  /*
   * Welcher Satz auf der Bühne groß liegt.
   *
   * Überwiegend abgeleitet statt gespeichert: normalerweise ist es die nächste
   * offene Zeile, und die wandert nach jedem Haken von selbst weiter. Nur wenn
   * jemand eine andere Zeile antippt - um einen Aufwärmsatz zu korrigieren
   * etwa -, hält `selectedSetLogId` das fest. Der Griff geht ins Leere, sobald
   * der Fokus die Übung wechselt: die fremde Id steht in dieser Liste nicht,
   * die Ableitung fällt auf die nächste offene Zeile zurück. Genau deshalb
   * muss nichts zurückgesetzt werden.
   */
  const [selectedSetLogId, setSelectedSetLogId] = useState<string | null>(null);
  const activeSetLog =
    sortedFocusedLogs.find((log) => log.id === selectedSetLogId) ??
    sortedFocusedLogs.find((log) => log.id === setTimer?.setLogId) ??
    sortedFocusedLogs.find((log) => !log.completed) ??
    sortedFocusedLogs[sortedFocusedLogs.length - 1];
  /*
   * Der große Knopf im Fuß des Sheets gehört dem aktiven Satz, steht aber
   * außerhalb seiner Komponente - der Fuß hängt am `visualViewport` und bleibt
   * deshalb über der Tastatur stehen. Beschriftung und Aktion meldet der
   * Editor hier herauf; nur er kennt den Draft.
   */
  const [activeSetAction, setActiveSetAction] = useState<ActiveSetAction | null>(null);
  const handleActiveSetActionChange = useCallback(
    (action: ActiveSetAction | null) => setActiveSetAction(action),
    [],
  );
  /*
   * Die Runden der Übung auf der Bühne: sie tragen den Streifen im Kopf des
   * Sheets. Eine Runde ist eine Satznummer - bei einer einbeinigen Übung also
   * beide Seiten zusammen, und genau so zählt man im Training auch.
   */
  const focusedRounds = useMemo(() => buildSetRounds(sortedFocusedLogs), [sortedFocusedLogs]);
  const activeRoundIndex = focusedRounds.findIndex((round) =>
    round.rows.some((row) => row.id === activeSetLog?.id),
  );
  /*
   * "Runde 2 von 3", während groß "Satz 1" steht, wäre eine Zumutung: der
   * Aufwärmsatz ist zwar eine Runde, trägt aber keine Nummer. Gezählt werden
   * deshalb nur die Arbeitssätze, und im Aufwärmsatz heißt es Aufwärmen.
   */
  const workRounds = focusedRounds.filter((round) => round.kind === 'work');
  const activeRound = activeRoundIndex >= 0 ? focusedRounds[activeRoundIndex] : undefined;
  const roundLabel = !activeRound
    ? undefined
    : activeRound.kind === 'warmup'
      ? 'Aufwärmen'
      : `Runde ${workRounds.indexOf(activeRound) + 1} von ${workRounds.length}`;
  const blockKeyByExerciseId = useMemo(
    () =>
      Object.fromEntries(
        blockProgress.flatMap((block) =>
          block.exercises.map((item) => [item.exercise.id, block.key] as const),
        ),
      ),
    [blockProgress],
  );

  /*
   * Das offene Sheet an seiner Übung festhalten, nicht an der Blockkennung.
   *
   * Beim Verbinden zu einem Supersatz bekommt der Block eine neue Kennung, beim
   * Lösen zerfällt er in zwei - der Schlüssel, mit dem das Sheet geöffnet
   * wurde, zeigt danach ins Leere und das Sheet verschwände mitten im Handgriff.
   * Hier wird er auf den Block der fokussierten Übung nachgezogen.
   */
  useEffect(() => {
    if (!openSessionBlockKey || blockProgress.length === 0) {
      return;
    }

    if (blockProgress.some((block) => block.key === openSessionBlockKey)) {
      return;
    }

    const nextKey = activeSessionExerciseId
      ? blockKeyByExerciseId[activeSessionExerciseId]
      : undefined;

    setOpenSessionBlockKey(nextKey ?? null);
  }, [
    activeSessionExerciseId,
    blockKeyByExerciseId,
    blockProgress,
    openSessionBlockKey,
    setOpenSessionBlockKey,
  ]);

  function describeRestTrack(track: RestTimerTrack) {
    const exercise = orderedSessionExercises.find((item) => item.id === track.sessionExerciseId);
    const name = exercise?.exerciseNameSnapshot ?? 'Übung';

    return track.side === 'both' ? name : `${name} · ${formatSideLabel(track.side)}`;
  }

  const setTimerRemainingSeconds = remainingSetTimerSeconds(setTimer, now);
  /*
   * Die Übung, auf deren Satz gerade die Zeit läuft.
   *
   * Der Timer kennt nur die Satzzeile - für die Liste, in der die Sätze nicht
   * stehen, muss daraus die Übung werden. Höchstens ein Satz-Timer je Session,
   * also höchstens eine Übung.
   */
  const runningSetTimerExerciseId = setTimer
    ? (setLogs ?? []).find((log) => log.id === setTimer.setLogId)?.sessionExerciseId
    : undefined;

  /*
   * Die Pause des Ruhemodus: die der Satzzeile, die gerade dran ist - genau
   * die, die auf dem limettenen Balken steht.
   *
   * Vorher stand hier einmal die kürzeste laufende Uhr überhaupt. Das war im
   * Supersatz und bei einer einbeinigen Übung nicht zu gebrauchen: dort laufen
   * zwei, drei Pausen gleichzeitig, und die große Zahl sprang zwischen ihnen
   * hin und her, ohne zu sagen, wozu sie gehört. Läuft für die dran-Zeile
   * keine, bleibt der Bildschirm frei; die übrigen stehen unverändert als
   * Chips und Abzeichen daneben.
   *
   * Der Satz-Timer bleibt bewusst außen vor. Der Ruhemodus ist der Zustand des
   * Wartens - während ein Satz auf Zeit läuft, wartet man nicht, sondern hält,
   * und die Zeit dafür steht auf der Bühne im Sheet, wo auch der Satz steht.
   */
  const activeRestTrack = activeSetLog
    ? findRestTrack(restTimers, activeSetLog.sessionExerciseId, activeSetLog.side)
    : undefined;
  const activeRestSeconds = remainingRestSeconds(activeRestTrack, now);
  /*
   * Der Schlüssel gilt nur, solange die Pause läuft. Abgelaufene Spuren bleiben
   * als "bereit" stehen (siehe `pruneRestTracks`) - hinge der Schlüssel an
   * ihnen, bliebe der Reiter für diese Übung und Seite auf Dauer
   * zusammengeklappt, und die nächste Pause käme nie mehr groß.
   */
  const activeRestKey =
    activeRestTrack && activeRestSeconds > 0
      ? restTrackKey(activeRestTrack.sessionExerciseId, activeRestTrack.side)
      : null;

  /*
   * Nach der Pause bleibt der Reiter nicht zusammengeklappt liegen: die
   * nächste öffnet den Ruhemodus wieder. Wer eine Pause weggelegt hat, hat das
   * für diese eine getan.
   */
  useEffect(() => {
    if (!activeRestKey && minimizedRestKey) {
      setMinimizedRestKey(null);
    }
  }, [activeRestKey, minimizedRestKey, setMinimizedRestKey]);

  /*
   * Was nach der Pause ansteht - dieselbe Zeile, auf die die Pause wartet, und
   * dieselben Werte, die das Sheet auf seinem großen Knopf verspricht.
   */
  const activeSetExercise = activeSetLog
    ? orderedSessionExercises.find((item) => item.id === activeSetLog.sessionExerciseId)
    : undefined;
  const nextValues =
    activeSetLog && activeSetExercise
      ? describeSetRowValues(
          activeSetLog,
          setRowFallback(
            activeSetExercise,
            lastValues?.[activeSetExercise.exerciseId]?.setValues?.resolve(activeSetLog),
          ),
        )
      : undefined;
  const isReadOnly = session?.status !== 'active';
  const selectedExistingExercise = (availableExercises ?? []).find(
    (exercise) => exercise.id === exerciseForm.exerciseId,
  );
  const selectedExerciseMedia = useLiveQuery(
    async () =>
      selectedExistingExercise?.mediaAssetId
        ? db.mediaAssets.get(selectedExistingExercise.mediaAssetId)
        : undefined,
    [selectedExistingExercise?.mediaAssetId],
  );
  const effectiveTrackingMode = selectedExistingExercise?.trackingMode ?? 'reps_weight';
  const effectiveLoadKind = selectedExistingExercise?.loadKind;
  const effectiveUnilateral = selectedExistingExercise?.unilateral ?? false;

  /**
   * Öffnet das Fokus-Sheet auf dem Block, zu dem die Übung gehört.
   *
   * Der Fokus wandert mit: im Supersatz zeigt das Sheet beide Mitglieder, und
   * ausgeklappt ist das, was angetippt wurde.
   */
  function handleOpenExerciseSheet(sessionExerciseId: string) {
    const blockKey = blockKeyByExerciseId[sessionExerciseId];

    if (!blockKey) {
      return;
    }

    setActiveSessionExerciseId(sessionExerciseId);
    setOpenSessionBlockKey(blockKey);
    // Wer eine Übung öffnet, will bei dem Satz landen, der dran ist - nicht
    // bei dem, den er beim letzten Besuch angetippt hat.
    setSelectedSetLogId(null);
  }

  /** Wechsel auf das andere Mitglied des Supersatzes, ohne das Sheet zu verlassen. */
  function handleSelectSheetMember(sessionExerciseId: string) {
    setActiveSessionExerciseId(sessionExerciseId);
    setSelectedSetLogId(null);
  }

  /**
   * Fokus über einen Chip der Pausenleiste - dorthin will man auch sehen.
   *
   * Eine abgelaufene Spur ist damit erledigt: "bereit" ist die Auskunft, dass
   * diese Übung wieder frei ist, und wer daraufhin hingeht, hat sie erhalten.
   * Das ist zugleich der einzige Weg, sie von Hand loszuwerden - die große
   * Zahl in der Leiste trägt zwar ein Abbrechen-Kreuz, bekommt aber nur
   * laufende Spuren.
   */
  function handleFocusRestTrack(track: RestTimerTrack) {
    handleOpenExerciseSheet(track.sessionExerciseId);

    if (isRestTrackReady(track, Date.now())) {
      void clearRestTimer(sessionId, track.sessionExerciseId, track.side);
    }
  }

  async function handleAddExercise() {
    if (!session || session.status !== 'active') {
      return;
    }

    if (!exerciseForm.exerciseId) {
      return;
    }

    setIsSavingExercise(true);

    try {
      const sessionExerciseId = await addSessionExercise({
        sessionId: session.id,
        workSetCount: Number(exerciseForm.workSetCount) || 1,
        includeWarmup: exerciseForm.includeWarmup,
        targetReps: supportsReps(effectiveTrackingMode)
          ? optionalNumberInput(exerciseForm.targetReps)
          : undefined,
        targetSeconds: supportsSeconds(effectiveTrackingMode)
          ? optionalNumberInput(exerciseForm.targetSeconds)
          : undefined,
        targetWeight: supportsWeight(effectiveTrackingMode, effectiveLoadKind)
          ? optionalNumberInput(exerciseForm.targetWeight)
          : undefined,
        targetBandId: supportsBand(effectiveTrackingMode, effectiveLoadKind)
          ? exerciseForm.targetBandId
          : undefined,
        restSeconds: optionalNumberInput(exerciseForm.restSeconds),
        notes: exerciseForm.notes,
        exerciseId: exerciseForm.exerciseId,
        trackingMode: effectiveTrackingMode,
        loadKind: effectiveLoadKind,
        unilateral: effectiveUnilateral,
      });

      setActiveSessionExerciseId(sessionExerciseId);
      setAddExerciseFormAnchor(null);
      setExerciseForm({
        ...defaultSessionExerciseFormState,
        exerciseId: availableExercises?.[0]?.id ?? '',
      });
    } finally {
      setIsSavingExercise(false);
    }
  }

  /**
   * Sortiert eine Übung um.
   *
   * Innerhalb eines Supersatzes bewegt sie sich nur in der Gruppe - der Block
   * als Ganzes wandert über die Pfeile in seiner Kopfzeile. Sonst zerrisse
   * jeder zweite Tap den Supersatz.
   */
  async function handleMoveSessionExercise(sessionExerciseId: string, direction: -1 | 1) {
    const exercise = orderedSessionExercises.find((item) => item.id === sessionExerciseId);

    await applySessionExerciseOrder(
      exercise?.supersetGroupId
        ? moveWithinGroup(orderedSessionExercises, sessionExerciseId, direction)
        : moveSupersetBlock(orderedSessionExercises, sessionExerciseId, direction),
    );
  }

  async function handleMoveSupersetBlock(sessionExerciseId: string, direction: -1 | 1) {
    await applySessionExerciseOrder(
      moveSupersetBlock(orderedSessionExercises, sessionExerciseId, direction),
    );
  }

  async function applySessionExerciseOrder(nextOrder: string[] | null) {
    if (isReadOnly || !session || !nextOrder) {
      return;
    }

    const previousOrder = sessionExerciseOrder;
    setSessionExerciseOrder(nextOrder);
    setIsReorderingExercises(true);

    try {
      await reorderSessionExercises(session.id, nextOrder);
      setSessionError(null);
    } catch (error) {
      // Optimistische Reihenfolge zurücknehmen, sonst zeigt die Liste eine
      // Sortierung, die nie gespeichert wurde.
      setSessionExerciseOrder(previousOrder);
      setSessionError(
        error instanceof Error ? error.message : 'Reihenfolge konnte nicht gespeichert werden.',
      );
    } finally {
      setIsReorderingExercises(false);
    }
  }

  function handleRequestDeleteSetLog(log: WorkoutSetLog, exerciseName: string) {
    /*
     * Rückfrage nur, wenn etwas verloren gehen kann. Ein leerer, offener Satz
     * verschwindet direkt - sonst kostet jeder Handgriff im Training einen
     * Dialog.
     */
    const carriesData =
      log.completed ||
      typeof log.reps === 'number' ||
      typeof log.seconds === 'number' ||
      typeof log.weight === 'number' ||
      Boolean(log.bandId);

    if (!carriesData) {
      void handleDeleteSetLog(log.id);
      return;
    }

    setPendingSetLogDelete({ log, exerciseName });
  }

  async function handleDeleteSetLog(setLogId: string) {
    setIsDeletingSetLog(true);

    try {
      await deleteSetLog(setLogId);
      setPendingSetLogDelete(null);
      setSessionError(null);
    } catch (error) {
      setPendingSetLogDelete(null);
      setSessionError(
        error instanceof Error ? error.message : 'Satz konnte nicht entfernt werden.',
      );
    } finally {
      setIsDeletingSetLog(false);
    }
  }

  async function handleGroupWithPrevious(sessionExerciseId: string) {
    try {
      await groupSessionExerciseWithPrevious(sessionExerciseId);
      setSessionError(null);
    } catch (error) {
      setSessionError(
        error instanceof Error ? error.message : 'Supersatz konnte nicht angelegt werden.',
      );
    }
  }

  async function handleUngroup(sessionExerciseId: string) {
    try {
      await ungroupSessionExercise(sessionExerciseId);
      setSessionError(null);
    } catch (error) {
      setSessionError(
        error instanceof Error ? error.message : 'Verbindung konnte nicht gelöst werden.',
      );
    }
  }

  async function handleToggleSkip(sessionExerciseId: string) {
    try {
      await toggleSkipSessionExercise(sessionExerciseId);
      setSessionError(null);
    } catch (error) {
      setSessionError(
        error instanceof Error ? error.message : 'Übung konnte nicht übersprungen werden.',
      );
    }
  }

  async function handleStartSetTimer(setLogId: string, seconds: number) {
    try {
      await startSetTimer(sessionId, setLogId, seconds);
      setSessionError(null);
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : 'Timer konnte nicht starten.');
    }
  }

  /**
   * Beendet den Satz-Timer und übernimmt die gehaltene Zeit in den Satz.
   *
   * Gibt den geschriebenen Wert zurück, weil die Satzzeile ihn für ihren
   * Eingabe-Draft braucht - sonst überschriebe ihr Autosave den gemessenen
   * Wert kurz darauf wieder mit dem alten Feldinhalt.
   */
  async function handleStopSetTimer() {
    const runningTimer = session?.setTimer;

    if (!runningTimer) {
      return undefined;
    }

    const achievedSeconds = elapsedSetTimerSeconds(runningTimer, Date.now());

    try {
      await finishSetTimer(sessionId, achievedSeconds);
      setSessionError(null);
      return achievedSeconds;
    } catch (error) {
      setSessionError(
        error instanceof Error ? error.message : 'Zeit konnte nicht übernommen werden.',
      );
      return undefined;
    }
  }

  /**
   * Reaktion auf einen abgehakten Satz: Pause für genau diese Übung und Seite
   * starten und den Fokus weiterziehen, wo es sinnvoll ist.
   *
   * Bewusst getrennt von [handleStartRest]: den Timer startet auch die Leiste
   * am unteren Rand, dort wurde aber kein Satz abgehakt und der Fokus darf
   * sich nicht bewegen.
   */
  async function handleSetCompleted(sessionExerciseId: string, completedSetLog: WorkoutSetLog) {
    /*
     * Die Live-Query hinkt dem gerade geschriebenen Haken hinterher: dieser
     * Aufruf erfolgt direkt nach `toggleSetCompletion`, `setLogs` trägt den
     * neuen Stand aber erst nach dem nächsten Emit. Ohne diesen Patch bliebe
     * der Fokus ausgerechnet beim letzten Satz stehen - dem einzigen Moment,
     * für den die Automatik gebaut ist.
     */
    const effectiveLogs = (setLogs ?? []).map((log) =>
      log.id === completedSetLog.id ? { ...log, completed: true } : log,
    );
    const next = resolveNextFocus({
      exercises: orderedSessionExercises,
      setLogs: effectiveLogs,
      currentSessionExerciseId: sessionExerciseId,
      completedSetNumber: completedSetLog.setNumber,
    });

    if (next) {
      setActiveSessionExerciseId(next.id);
    }

    // Ein abgehakter Satz gibt die Bühne frei: die Auswahl von Hand fällt weg,
    // damit die nächste offene Zeile nachrückt.
    setSelectedSetLogId(null);

    /*
     * Das Sheet schließt sich, sobald sein Block keine offene Zeile mehr hat.
     *
     * Bewusst kein Selbstsprung in den nächsten Block: zwischen zwei Übungen
     * wird umgebaut, getrunken, gelaufen - dafür ist die Liste der richtige
     * Ort. Der Wechsel *innerhalb* eines Supersatzes bleibt dagegen im Sheet,
     * denn genau dort geht es ohne Pause weiter.
     */
    const openMembers = openBlock?.exercises.map((item) => item.exercise.id) ?? [];

    if (
      openMembers.includes(sessionExerciseId) &&
      !effectiveLogs.some((log) => openMembers.includes(log.sessionExerciseId) && !log.completed)
    ) {
      setOpenSessionBlockKey(null);
    }

    try {
      await startRestTimerForSetLog(completedSetLog.id);
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : 'Pausentimer konnte nicht starten.');
    }
  }

  async function handleCloseSession(mode: 'complete' | 'abort') {
    setIsClosingSession(true);

    try {
      await (mode === 'complete' ? completeSession(session.id) : abortSession(session.id));
      navigate('/');
    } catch (error) {
      setSessionError(
        error instanceof Error ? error.message : 'Session konnte nicht abgeschlossen werden.',
      );
      setIsClosingSession(false);
    }
  }

  /**
   * Die Timer-Leiste.
   *
   * Sie steht an zwei Orten - am unteren Rand der Liste und im Fuß des
   * Fokus-Sheets -, aber nie an beiden gleichzeitig. Deshalb eine Funktion
   * statt zweier Kopien: die Rangfolge, welche Uhr groß wird, darf sich nicht
   * je nach Ansicht unterscheiden.
   *
   * Die Rangfolge lautet: laufender Satz-Timer, dann laufende Pause, dann der
   * Weg zurück in die Übung. Nur das Oberste bekommt die große Zahl.
   */
  function renderSessionTimerBar() {
    return (
      <>
        {/*
            Der Name über der Zahl: sobald mehrere Pausen laufen, ist "1:12"
            allein zweideutig - im Supersatz wie bei links und rechts.
          */}
        {setTimerRemainingSeconds === 0 && primaryRestTrack ? (
          <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-content-muted">
            Pause · {describeRestTrack(primaryRestTrack)}
          </p>
        ) : null}
        <div className="flex items-center gap-2">
          {setTimerRemainingSeconds > 0 ? (
            /*
                Der Satz-Timer verdrängt die Pause: er läuft *während* der
                Übung, und wer im Plank liegt, sieht nur diese eine Zahl. Die
                Bedienung liegt hier statt in der Satzzeile - beim Halten
                scrollt niemand zur Karte zurück.
              */
            <>
              <div
                role="timer"
                aria-live="off"
                className="flex min-h-touch flex-1 items-center justify-center gap-2 rounded-control bg-accent-soft px-3 text-2xl font-semibold tabular-nums text-accent"
              >
                <Timer size={18} />
                {formatTimer(setTimerRemainingSeconds)}
              </div>
              <Button
                variant="ghost"
                size="md"
                aria-label="Zeit stoppen und in den Satz übernehmen"
                onClick={() => void handleStopSetTimer()}
              >
                Stopp
              </Button>
              <IconButton
                label="Satz-Timer verwerfen, ohne die Zeit zu übernehmen"
                onClick={() => void clearSetTimer(sessionId)}
              >
                <X size={16} />
              </IconButton>
            </>
          ) : primaryRestTrack && remainingSeconds > 0 ? (
            <>
              {/*
                  Die verbleibende Zeit ist die einzige Zahl, die während der
                  Pause zählt - sie trägt deshalb die Größe, nicht die
                  Bedienelemente daneben.

                  Und die Größe ist auch alles, was sie trägt: hier lag ein
                  warmes Braun auf Beige, die Warnfarbe der App. Eine laufende
                  Pause warnt vor nichts - sie ist derselbe neutrale Zustand,
                  den die Chips auf der Karte zeigen. Bedeutung bekommt sie
                  erst, wenn sie abgelaufen ist, und dann ist die Leiste
                  ohnehin schon beim Knopf zurück in die Übung.
                */}
              <div
                role="timer"
                aria-live="off"
                className="flex min-h-touch flex-1 items-center justify-center gap-2 rounded-control bg-accent-soft px-3 text-2xl font-semibold tabular-nums text-accent"
              >
                <Clock3 size={18} />
                {formatTimer(remainingSeconds)}
              </div>
              <Button
                variant="ghost"
                size="md"
                onClick={() =>
                  void extendRestTimer(
                    sessionId,
                    primaryRestTrack.sessionExerciseId,
                    primaryRestTrack.side,
                    REST_TIMER_STEP_SECONDS,
                  )
                }
              >
                +{REST_TIMER_STEP_SECONDS}s
              </Button>
              <IconButton
                label="Pausentimer abbrechen"
                onClick={() =>
                  void clearRestTimer(
                    sessionId,
                    primaryRestTrack.sessionExerciseId,
                    primaryRestTrack.side,
                  )
                }
              >
                <X size={16} />
              </IconButton>
            </>
          ) : (
            /*
                Läuft keine Uhr, ist der Weg zurück in die Übung die einzige
                Sache in der Leiste. Hier stand daneben ein Knopf, der eine
                Pause von Hand startete - die Pause beginnt jetzt
                ausschließlich beim Abhaken eines Satzes.
              */
            <button
              type="button"
              onClick={() => focusedExercise && handleOpenExerciseSheet(focusedExercise.id)}
              disabled={!focusedExercise}
              className={cn(
                'flex min-h-touch flex-1 items-center justify-center gap-2 rounded-control px-4',
                'bg-accent text-[15px] font-bold text-accent-contrast transition hover:opacity-90',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-app',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              <span className="truncate">
                {openBlock
                  ? 'Zurück zur Übung'
                  : `Los mit ${focusedExercise?.exerciseNameSnapshot ?? 'der Übung'}`}
              </span>
            </button>
          )}
        </div>

        {/*
            Die übrigen Pausen als Chips: sie beantworten im Vorbeigehen, ob
            der Partner im Supersatz oder die andere Seite schon wieder frei
            ist. Bewusst ohne `role="timer"` - mehrere Live-Regionen, die im
            Sekundentakt sprechen, machen den Screenreader unbenutzbar.
          */}
        {secondaryRestTracks.length > 0 ? (
          <div className="mt-2 flex gap-2 overflow-x-auto px-1 pb-1">
            {secondaryRestTracks.map((track) => {
              const isReady = isRestTrackReady(track, now);
              const description = describeRestTrack(track);

              return (
                <button
                  key={restTrackKey(track.sessionExerciseId, track.side)}
                  type="button"
                  onClick={() => handleFocusRestTrack(track)}
                  aria-label={`Zu ${description} wechseln - ${
                    isReady
                      ? 'Pause vorbei'
                      : `noch ${formatTimer(remainingRestSeconds(track, now))}`
                  }`}
                  className={cn(
                    'flex min-h-touch shrink-0 items-center gap-2 rounded-control border px-3 text-xs font-semibold',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    isReady
                      ? 'border-accent-border bg-accent-soft text-accent'
                      : 'border-line bg-surface-raised text-content-secondary',
                  )}
                >
                  <Clock3 size={14} aria-hidden="true" />
                  <span className="max-w-[9rem] truncate">{description}</span>
                  <span className="tabular-nums">
                    {isReady ? 'bereit' : formatTimer(remainingRestSeconds(track, now))}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </>
    );
  }

  /**
   * Der Fuß des Fokus-Sheets.
   *
   * Er trägt die Pausen als Chips und darunter die eine Handlung, um die es
   * gerade geht: den Satz abhaken. Beides sitzt hier und nicht an der
   * Satzzeile, weil der Fuß am `visualViewport` hängt - er bleibt damit auch
   * dann sichtbar, wenn die Tastatur für ein Zahlenfeld aufgeht.
   *
   * Genau ein `role="timer"` steht im Dokument: läuft ein Satz-Timer, trägt
   * ihn dessen Fläche auf der Bühne, sonst der erste Pausen-Chip hier.
   *
   * Die Pause von Hand zu starten geht hier bewusst nicht: im Sheet führt man
   * die Übung aus, und die Pause beginnt beim Abhaken. Der Knopf dafür steht
   * in der Leiste unter der Liste.
   */
  function renderSheetFooter() {
    const tracks = [...restTimers].sort(byRestTrackEnd);

    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
            {tracks.map((track, index) => {
              const isReady = isRestTrackReady(track, now);
              const description = describeRestTrack(track);

              return (
                <button
                  key={restTrackKey(track.sessionExerciseId, track.side)}
                  type="button"
                  onClick={() => handleFocusRestTrack(track)}
                  aria-label={`Zu ${description} wechseln - ${
                    isReady
                      ? 'Pause vorbei'
                      : `noch ${formatTimer(remainingRestSeconds(track, now))}`
                  }`}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold tabular-nums transition',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    isReady
                      ? 'bg-success text-success-contrast'
                      : 'bg-surface-raised text-content-secondary',
                  )}
                >
                  <Clock3 size={12} aria-hidden="true" />
                  <span className="max-w-[8rem] truncate">{description}</span>
                  <span
                    {...(index === 0 && setTimerRemainingSeconds === 0
                      ? { role: 'timer', 'aria-live': 'off' as const }
                      : {})}
                  >
                    {isReady ? 'bereit' : formatTimer(remainingRestSeconds(track, now))}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {activeSetAction ? (
          <button
            type="button"
            onClick={() => void activeSetAction.run()}
            disabled={activeSetAction.disabled}
            className={cn(
              'flex min-h-[3.25rem] w-full items-center justify-center rounded-full px-4',
              'bg-accent text-[15px] font-bold text-accent-contrast transition hover:opacity-90',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            <span className="truncate">{activeSetAction.label}</span>
          </button>
        ) : null}

        {/*
          Auslassen leise darunter: es kommt vor, aber es ist nie das, was man
          im Sheet sucht.
        */}
        {focusedExercise && !isReadOnly ? (
          <button
            type="button"
            onClick={() => void handleToggleSkip(focusedExercise.id)}
            className="flex min-h-[2rem] w-full items-center justify-center text-[13px] font-semibold text-content-muted transition hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {focusedExercise.wasSkipped ? 'Übung zurückholen' : 'Übung auslassen'}
          </button>
        ) : null}
      </div>
    );
  }

  /**
   * Ein Mitglied des offenen Blocks.
   *
   * Die Übung, in der der Fokus steht, bekommt die Bühne; alle anderen
   * schrumpfen auf eine Zeile mit Name und Uhr. Im Supersatz stehen beide
   * gleichzeitig im Sheet - der Wechsel von Satz zu Satz braucht dann keinen
   * Ansichtswechsel.
   */
  function renderSheetMember(
    item: SessionExerciseProgress,
    position: { isFirst: boolean; isLast: boolean; isSupersetMember: boolean },
  ) {
    const { exercise } = item;

    if (activeSessionExerciseId !== exercise.id) {
      return (
        <SessionPartnerRow
          key={exercise.id}
          exercise={exercise}
          completedCount={item.completedCount}
          totalCount={item.totalCount}
          restTracks={restTracksByExerciseId[exercise.id]}
          now={now}
          onSelect={handleSelectSheetMember}
        />
      );
    }

    return (
      <SessionExerciseStage
        key={exercise.id}
        exercise={exercise}
        exerciseLogs={sortedFocusedLogs}
        mediaAsset={mediaAssetForExercise(exercise)}
        bandLevels={bandLevels}
        lastSetValues={lastValues?.[exercise.exerciseId]?.setValues}
        activeSetLog={activeSetLog}
        onSelectSetLog={setSelectedSetLogId}
        isBusy={isReorderingExercises}
        isReadOnly={isReadOnly}
        isFirst={position.isFirst}
        isLast={position.isLast}
        isSupersetMember={position.isSupersetMember}
        canGroupWithPrevious={orderedSessionExercises[0]?.id !== exercise.id}
        setTimer={setTimer}
        timerRemainingSeconds={setTimerRemainingSeconds}
        restTracks={restTracksByExerciseId[exercise.id]}
        now={now}
        onActionChange={handleActiveSetActionChange}
        onMove={handleMoveSessionExercise}
        onGroupWithPrevious={(id) => void handleGroupWithPrevious(id)}
        onUngroup={(id) => void handleUngroup(id)}
        onSetCompleted={handleSetCompleted}
        onStartSetTimer={handleStartSetTimer}
        onStopSetTimer={handleStopSetTimer}
        onClearSetTimer={() => void clearSetTimer(sessionId)}
        onRequestDeleteSetLog={handleRequestDeleteSetLog}
        onOpenMedia={(mediaAsset, alt) => setMediaPreview({ mediaAsset, alt })}
      />
    );
  }

  /**
   * Die Steuerung der laufenden Session: Übung hinzufügen, abschließen,
   * abbrechen.
   *
   * Als Funktion, weil derselbe Block über *und* unter der Übungsliste steht -
   * siehe [SessionControlsPlacement]. Die Platzierung dient nur dazu,
   * auseinanderzuhalten, welcher der beiden das Hinzufügen-Formular trägt.
   */
  /**
   * Der Knopf, der das Formular für eine zusätzliche Übung auf- und zuklappt.
   *
   * Er steht über und unter der Liste; das Formular gehört jeweils zu der
   * Stelle, an der es geöffnet wurde - sonst tippt man oben und das zweite
   * Formular unten zeigt unbemerkt dieselben Werte.
   */
  function renderAddExerciseControl(
    placement: SessionControlsPlacement,
    showAddExerciseForm: boolean,
  ) {
    return (
      <Button
        variant="ghost"
        size="md"
        className="w-full justify-center text-content-muted"
        onClick={() =>
          setAddExerciseFormAnchor((current) => (current === placement ? null : placement))
        }
      >
        {showAddExerciseForm ? (
          <>
            <X size={16} />
            Hinzufügen schließen
          </>
        ) : (
          <>
            <Plus size={16} />
            Übung hinzufügen
          </>
        )}
      </Button>
    );
  }

  /**
   * Das Formular für eine zusätzliche Übung.
   *
   * Es gehört zu der Platzierung, über die es geöffnet wurde - oben wie unten.
   * Zuvor hing es nur an der unteren Karte; der obere Knopf setzte damit einen
   * Zustand, zu dem nichts erschien.
   */
  function renderAddExerciseForm() {
    return (
      <div className="space-y-4 rounded-panel border border-line bg-surface p-4">
        {(availableExercises?.length ?? 0) > 0 ? (
          <div className="space-y-3">
            <SelectField
              label="Übung"
              value={exerciseForm.exerciseId}
              onChange={(event) =>
                setExerciseForm((current) => ({
                  ...current,
                  exerciseId: event.target.value,
                }))
              }
            >
              {(availableExercises ?? []).map((exercise) => (
                <option key={exercise.id} value={exercise.id}>
                  {exercise.name}
                </option>
              ))}
            </SelectField>

            <p className="text-sm text-content-muted">
              {formatTrackingMode(effectiveTrackingMode)} ·{' '}
              {effectiveUnilateral ? 'links/rechts getrennt' : 'beidseitig'}
            </p>
            <ExerciseMedia
              mediaAsset={selectedExerciseMedia}
              alt={selectedExistingExercise?.name ?? 'Übung'}
              className="h-32 w-full"
              imageClassName="h-full w-full"
            />
          </div>
        ) : (
          <div className="rounded-panel bg-surface-raised px-4 py-4 text-sm text-content-muted">
            Noch keine Übung in der Bibliothek.{' '}
            <Link to="/exercises" className="text-accent underline underline-offset-2">
              Jetzt anlegen
            </Link>
            .
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <ExerciseTargetFields
            trackingMode={effectiveTrackingMode}
            loadKind={effectiveLoadKind}
            bandLevels={bandLevels}
            values={exerciseForm}
            onChange={(field, value) =>
              setExerciseForm((current) => ({ ...current, [field]: value }))
            }
            layout="grid"
          />
        </div>

        <CheckboxField
          label="Warmup-Satz anlegen"
          checked={exerciseForm.includeWarmup}
          onChange={(event) =>
            setExerciseForm((current) => ({
              ...current,
              includeWarmup: event.target.checked,
            }))
          }
        />

        <TextArea
          label="Notizen für diese Session-Übung, optional"
          value={exerciseForm.notes}
          onChange={(event) =>
            setExerciseForm((current) => ({
              ...current,
              notes: event.target.value,
            }))
          }
          rows={3}
        />

        <div className="grid grid-cols-2 gap-3">
          <Button
            variant="secondary"
            onClick={() => {
              setAddExerciseFormAnchor(null);
              setExerciseForm({
                ...defaultSessionExerciseFormState,
                exerciseId: availableExercises?.[0]?.id ?? '',
              });
            }}
          >
            Abbrechen
          </Button>
          <Button
            variant="primary"
            onClick={handleAddExercise}
            disabled={isSavingExercise || !exerciseForm.exerciseId}
          >
            {isSavingExercise ? 'Speichert...' : 'Zur Session hinzufügen'}
          </Button>
        </div>
      </div>
    );
  }

  function renderSessionControls(placement: SessionControlsPlacement) {
    const showAddExerciseForm = addExerciseFormAnchor === placement;

    /*
     * Oben nur die Handgriffe, unten die ganze Karte.
     *
     * Der Kopf mit Startzeit und Woche stand vor der Liste und schob die erste
     * Übung unter die Falz - dieselbe Information steht ohnehin schon in der
     * Kopfzeile der Seite. Was oben wirklich gebraucht wird, ist das Ergänzen
     * einer Übung und der Abbruch; abgeschlossen wird am Ende, und dort steht
     * die Karte weiterhin vollständig.
     */
    if (placement === 'top') {
      return (
        <div className="space-y-3">
          {renderAddExerciseControl(placement, showAddExerciseForm)}
          {showAddExerciseForm ? renderAddExerciseForm() : null}
        </div>
      );
    }

    return (
      <SectionCard
        title="Session"
        subtitle={`Gestartet ${formatDateTime(session.startedAt)} · ${sessionWeekContext}`}
      >
        <div className="space-y-3">
          {renderAddExerciseControl(placement, showAddExerciseForm)}

          {showAddExerciseForm ? renderAddExerciseForm() : null}

          {/*
            Abschließen ist unumkehrbar - abgeschlossene Sessions sind
            schreibgeschützt. Deshalb steht es allein und in voller Breite,
            statt als gleich großer Zwilling neben dem Abbrechen zu sitzen,
            wo der Daumen leicht danebengreift.
          */}
          <Button
            variant="primary"
            fullWidth
            onClick={() => void handleCloseSession('complete')}
            disabled={isClosingSession}
          >
            <CheckCircle2 size={18} />
            {isClosingSession ? 'Wird beendet...' : 'Session abschließen'}
          </Button>
          <Button
            variant="danger"
            size="md"
            fullWidth
            onClick={() => void handleCloseSession('abort')}
            disabled={isClosingSession}
          >
            <X size={16} />
            Session abbrechen
          </Button>
        </div>
      </SectionCard>
    );
  }

  if (!session) {
    return (
      <AppShell title="Session">
        <SectionCard title="Session nicht gefunden">
          <p className="text-sm text-content-muted">
            Entweder wurde sie noch nicht angelegt oder bereits gelöscht.
          </p>
        </SectionCard>
      </AppShell>
    );
  }

  const sessionWeekContext = formatSessionWeekContext(session);

  return (
    // Der Eyebrow trägt jetzt die Woche statt des Wortes "Session" - dass hier
    // ein Training läuft, ist ohnehin offensichtlich.
    <AppShell title={session.templateNameSnapshot} eyebrow={sessionWeekContext}>
      <div className="space-y-4">
        {/* Der Stand der Einheit, nicht der einer einzelnen Übung. */}
        {orderedSessionExercises.length > 0 ? (
          <SessionStatsHeader
            session={session}
            progress={sessionProgress}
            blocks={sessionBlocks}
            logsByExercise={groupedLogs}
          />
        ) : null}

        {sessionError ? <Alert>{sessionError}</Alert> : null}

        {/*
          Die Steuerung gleich über der Liste: beim Start der Session ist das
          Hinzufügen einer Übung der nächste Handgriff.
        */}
        {session.status === 'active' ? renderSessionControls('top') : null}

        {orderedSessionExercises.length > 0 ? (
          /*
            Die Einheit als Liste von Blöcken.

            Zuvor stand hier jede Übung als volle Karte samt Sätzen, Feldern
            und Bild - bei einem Supersatz zweimal untereinander. Wer wissen
            wollte, wie weit er ist, musste dafür scrollen. Jetzt trägt die
            Liste den Überblick und das Sheet die Arbeit.
          */
          <div className="space-y-3">
            {blockProgress.map((block, blockIndex) => (
              <SessionBlockCard
                key={block.key}
                isFirstBlock={blockIndex === 0}
                isLastBlock={blockIndex === blockProgress.length - 1}
                onMoveBlock={(sessionExerciseId, direction) =>
                  void handleMoveSupersetBlock(sessionExerciseId, direction)
                }
                block={block}
                restTracks={restTimers}
                now={now}
                runningSetTimerExerciseId={runningSetTimerExerciseId}
                isReadOnly={isReadOnly}
                isBusy={isReorderingExercises}
                onOpen={handleOpenExerciseSheet}
              />
            ))}
          </div>
        ) : (
          <SectionCard title="Noch keine Übung">
            <p className="text-sm text-content-muted">
              In dieser Session steht noch keine Übung. Du kannst sie direkt darüber oder darunter
              hinzufügen.
            </p>
          </SectionCard>
        )}

        {/*
          Derselbe Block noch einmal unter der Liste: von hier aus wird die
          Session abgeschlossen, wenn der letzte Satz abgehakt ist - ohne
          zurückzuscrollen.
        */}
        {session.status === 'active' ? (
          renderSessionControls('bottom')
        ) : (
          <SectionCard title="Session abgeschlossen">
            <p className="text-sm text-content-muted">
              Diese Session ist abgeschlossen und lässt sich nicht mehr ändern.
            </p>
          </SectionCard>
        )}
      </div>

      {/*
        Die Leiste steht nur dort, wo sie gebraucht wird: liegt das Sheet
        darüber, trägt dessen Fuß dieselbe Leiste. Beide gleichzeitig hieße
        zwei `role="timer"` im Dokument - und zwei Live-Regionen, die im
        Sekundentakt sprechen, machen den Screenreader unbenutzbar.
      */}
      {session.status === 'active' && !openBlock ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-md">
          <div className="pointer-events-auto rounded-t-card border border-b-0 border-line bg-surface-glass p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-soft backdrop-blur-xl">
            {renderSessionTimerBar()}
          </div>
        </div>
      ) : null}

      {/*
        Das Fokus-Sheet.

        Es zeigt den ganzen Block: im Supersatz beide Mitglieder, damit der
        Wechsel von Satz zu Satz keinen Ansichtswechsel braucht. Groß ist darin
        immer nur eines - die Übung mit dem Fokus und darin der eine Satz, der
        dran ist.
            */}
      <Sheet
        open={Boolean(openBlock)}
        label={
          openBlock?.isSuperset
            ? 'Supersatz'
            : (openBlock?.exercises[0]?.exercise.exerciseNameSnapshot ?? 'Übung')
        }
        header={
          openBlock ? (
            <div className="min-w-0 space-y-2">
              <div className="min-w-0">
                {/*
                  Oben steht, wo man in der Einheit ist. Der Zählstand ist
                  bewusst der der ganzen Session und nicht der des Blocks: "Satz
                  5 von 14" ist die Zahl, nach der man im Training fragt, und
                  die Liste dahinter zeigt dieselbe.
                */}
                <p className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-content-muted">
                  {openBlock.isSuperset ? 'Supersatz' : 'Einzelübung'}
                  {roundLabel ? ` · ${roundLabel}` : ''}
                </p>
                <p className="mt-0.5 font-display text-2xl font-extrabold leading-none tabular-nums tracking-tight">
                  Satz {Math.min(sessionProgress.completedCount + 1, sessionProgress.totalCount)}
                  <span className="ml-1.5 text-sm font-semibold text-content-muted">
                    von {sessionProgress.totalCount}
                  </span>
                </p>
              </div>
              {/*
                Die Runden als Streifen: er zeigt in einem Blick, wie viel von
                dieser Übung noch aussteht - eine Zahl, die im Satz selbst
                niemand nachzählen will.
              */}
              {focusedRounds.length > 1 ? (
                <div aria-hidden="true" className="flex gap-1">
                  {focusedRounds.map((round, index) => (
                    <span
                      key={round.key}
                      className={cn(
                        'h-1.5 flex-1 rounded-full',
                        round.isDone
                          ? 'bg-success'
                          : index === activeRoundIndex
                            ? 'bg-highlight'
                            : 'bg-surface-raised',
                      )}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null
        }
        footer={renderSheetFooter()}
        onClose={() => setOpenSessionBlockKey(null)}
      >
        <div className="space-y-2">
          {openBlock?.exercises.map((item, index) =>
            renderSheetMember(item, {
              isFirst: index === 0,
              isLast: index === (openBlock?.exercises.length ?? 1) - 1,
              isSupersetMember: openBlock.isSuperset,
            }),
          )}
        </div>
      </Sheet>

      {/*
        Der Ruhemodus - für den Blick aus einem Meter Entfernung, wenn das
        Handy während der Pause auf dem Boden liegt. Er nimmt den Bildschirm
        ein, solange man wartet, und klappt zum Reiter an der Kante zusammen,
        sobald man doch etwas eintragen will: siehe [RestMode].

        Nur über dem Sheet. In der Liste hat man die Einheit vor sich - welcher
        Block dran ist, was noch aussteht, wo man weitermacht -, und dort trägt
        die Leiste am unteren Rand die Restzeit. Im Sheet steht ohnehin nur die
        eine Übung, und man wartet.
      */}
      {openBlock && activeRestTrack ? (
        <RestMode
          seconds={activeRestSeconds}
          total={activeRestTrack.durationSeconds}
          restLabel={describeRestTrack(activeRestTrack)}
          nextLabel={activeSetLog ? describeSetRow(activeSetLog) : undefined}
          nextValues={nextValues}
          isMinimized={minimizedRestKey === activeRestKey}
          onMinimize={() => setMinimizedRestKey(activeRestKey)}
          onExpand={() => setMinimizedRestKey(null)}
          onExtend={() =>
            void extendRestTimer(
              sessionId,
              activeRestTrack.sessionExerciseId,
              activeRestTrack.side,
              REST_TIMER_STEP_SECONDS,
            )
          }
          onFinish={() =>
            void clearRestTimer(
              sessionId,
              activeRestTrack.sessionExerciseId,
              activeRestTrack.side,
            )
          }
        />
      ) : null}

      <MediaLightbox
        mediaAsset={mediaPreview?.mediaAsset}
        alt={mediaPreview?.alt ?? ''}
        onClose={() => setMediaPreview(null)}
      />

      <ConfirmDialog
        open={pendingSetLogDelete !== null}
        title="Satz entfernen?"
        description={
          pendingSetLogDelete
            ? `${
                pendingSetLogDelete.log.setKind === 'warmup'
                  ? 'Der Warmup-Satz'
                  : `Satz ${pendingSetLogDelete.log.setNumber}`
              } von ${pendingSetLogDelete.exerciseName} wird samt eingetragener Werte entfernt.`
            : ''
        }
        confirmLabel="Entfernen"
        busy={isDeletingSetLog}
        onConfirm={() => {
          if (pendingSetLogDelete) {
            void handleDeleteSetLog(pendingSetLogDelete.log.id);
          }
        }}
        onCancel={() => setPendingSetLogDelete(null)}
      />
    </AppShell>
  );
}
