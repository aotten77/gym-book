import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowDown,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  ImageOff,
  Plus,
  Timer,
  X,
} from 'lucide-react';
import { Alert } from '@/components/Alert';
import { AppShell } from '@/components/AppShell';
import { ExerciseMedia } from '@/components/ExerciseMedia';
import { ExerciseTargetFields } from '@/components/ExerciseTargetFields';
import { MediaLightbox } from '@/components/MediaLightbox';
import { SectionCard } from '@/components/SectionCard';
import { Button, IconButton } from '@/components/ui/Button';
import { CheckboxField, SelectField, TextArea } from '@/components/ui/Field';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SessionExerciseCard } from '@/components/SessionExerciseCard';
import { SupersetBlock } from '@/components/SupersetBlock';
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
  startRestTimerForExercise,
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
  DEFAULT_REST_SECONDS,
  isRestTrackReady,
  REST_TIMER_STEP_SECONDS,
  remainingRestSeconds,
  resolveManualRestTarget,
  restTrackKey,
  selectPrimaryRestTrack,
} from '@/domain/rest-timer';
import { resolveNextFocus } from '@/domain/session';
import { elapsedSetTimerSeconds, remainingSetTimerSeconds } from '@/domain/set-timer';
import {
  buildSupersetBlocks,
  moveSupersetBlock,
  moveWithinGroup,
  supersetPositionLabel,
} from '@/domain/superset';
import { supportsBand, supportsReps, supportsSeconds, supportsWeight } from '@/domain/tracking';
import {
  formatDateTime,
  formatSessionWeekContext,
  formatSetLogWithSide,
  formatSideLabel,
  formatTimer,
  formatTrackingMode,
} from '@/lib/format';
import { optionalNumberInput } from '@/lib/number-input';
import { isChimeFresh, playTimerChime, primeTimerSound } from '@/lib/sound';
import { cn } from '@/lib/utils';
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
 * Sortierung aller Pausenanzeigen: was zuerst wieder frei ist, steht vorn.
 *
 * Die Einfügereihenfolge wäre die des Abhakens - für den Blick auf die Leiste
 * ohne Bedeutung.
 */
function byRestTrackEnd(left: RestTimerTrack, right: RestTimerTrack) {
  return left.endsAt - right.endsAt;
}

/** Sprungziel des Streifens oben - siehe [handleJumpToFocusedExercise]. */
function sessionExerciseAnchorId(sessionExerciseId: string) {
  return `session-exercise-${sessionExerciseId}`;
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
  const [mediaPreview, setMediaPreview] = useState<{ mediaAsset: MediaAsset; alt: string } | null>(
    null,
  );
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

    /*
     * Abgelaufene Spuren bleiben zunächst stehen und melden "bereit" - genau
     * das sucht man beim Zurückwechseln. Weggeräumt werden sie erst nach der
     * Karenzzeit in [pruneRestTimers].
     */
    void pruneRestTimers(sessionId);
  }, [expiredRestTrackKeys, sessionId, timerSoundEnabled]);

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
  const availableExerciseById = Object.fromEntries((availableExercises ?? []).map((exercise) => [exercise.id, exercise]));
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

  const focusedExerciseMedia = mediaAssetForExercise(focusedExercise);

  /*
   * Der Streifen oben zeigt jetzt den Fortschritt der aktiven Übung statt des
   * Hinweises auf die Bildansicht: beim Tippen springt er zur Übung, das Bild
   * hängt eine Karte tiefer an derselben Stelle wie zuvor.
   */
  const focusedLogs = focusedExercise ? groupedLogs[focusedExercise.id] ?? [] : [];
  const focusedCompletedCount = focusedLogs.filter((log) => log.completed).length;
  const focusedProgressPercent = focusedLogs.length
    ? Math.round((focusedCompletedCount / focusedLogs.length) * 100)
    : 0;

  const focusedLastValues = focusedExercise ? lastValues?.[focusedExercise.exerciseId] : undefined;
  const focusedLastValuesSummary = focusedLastValues
    ? {
        text: focusedLastValues.logs.map(formatSetLogWithSide).join(' · '),
        completedAt: formatDateTime(focusedLastValues.completedAt),
        templateName: focusedLastValues.templateName,
      }
    : undefined;
  /*
   * Die große Zahl gehört der Pause, auf die gerade gewartet wird: der
   * fokussierten Übung und dort der Seite, die als Nächstes drankommt. Alle
   * anderen laufenden Pausen stehen als Chips daneben.
   */
  const nextOpenFocusedSide = sortSetLogs(focusedLogs).find((log) => !log.completed)?.side;
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

  function describeRestTrack(track: RestTimerTrack) {
    const exercise = orderedSessionExercises.find((item) => item.id === track.sessionExerciseId);
    const name = exercise?.exerciseNameSnapshot ?? 'Übung';

    return track.side === 'both' ? name : `${name} · ${formatSideLabel(track.side)}`;
  }

  const setTimerRemainingSeconds = remainingSetTimerSeconds(setTimer, now);
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

  function scrollToSessionExercise(sessionExerciseId: string) {
    const target = document.getElementById(sessionExerciseAnchorId(sessionExerciseId));

    /*
     * `scrollIntoView` kennt die Systemeinstellung nicht - anders als die
     * CSS-Regel in index.css muss sie hier von Hand abgefragt werden.
     */
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    target?.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
  }

  function handleJumpToFocusedExercise() {
    if (!focusedExercise) {
      return;
    }

    scrollToSessionExercise(focusedExercise.id);
  }

  /** Fokus über einen Chip der Pausenleiste - dorthin will man auch sehen. */
  function handleFocusRestTrack(track: RestTimerTrack) {
    setActiveSessionExerciseId(track.sessionExerciseId);
    scrollToSessionExercise(track.sessionExerciseId);
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
      setSessionError(error instanceof Error ? error.message : 'Satz konnte nicht entfernt werden.');
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

  /** Manueller Start über die Leiste - für die Seite, die als Nächstes kommt. */
  async function handleStartRest() {
    if (!focusedExercise) {
      return;
    }

    try {
      await startRestTimerForExercise(
        sessionId,
        focusedExercise.id,
        resolveManualRestTarget(focusedExercise.id, focusedLogs),
      );
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : 'Pausentimer konnte nicht starten.');
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
    const current = orderedSessionExercises.find((item) => item.id === sessionExerciseId);
    const next = resolveNextFocus({
      exercises: orderedSessionExercises,
      setLogs: effectiveLogs,
      currentSessionExerciseId: sessionExerciseId,
      completedSetNumber: completedSetLog.setNumber,
    });

    if (next) {
      setActiveSessionExerciseId(next.id);

      /*
       * Nur beim Wechsel innerhalb eines Supersatzes mitscrollen: dort steht
       * die Partnerübung direkt daneben und man will sofort weitermachen.
       * Beim Sprung nach einer fertigen Übung bleibt es beim Streifen oben,
       * über den man selbst springt.
       */
      if (current?.supersetGroupId && next.supersetGroupId === current.supersetGroupId) {
        scrollToSessionExercise(next.id);
      }
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
   * Eine Übungskarte samt Sprungziel.
   *
   * Als Funktion und nicht inline, weil dieselbe Karte an zwei Stellen der
   * Liste steht: allein und als Mitglied eines Supersatz-Blocks.
   */
  function renderSessionExerciseCard(
    exercise: WorkoutSessionExercise,
    position: { isFirst: boolean; isLast: boolean; supersetPosition?: string },
  ) {
    const isFocused = activeSessionExerciseId === exercise.id;

    return (
      // Sprungziel des Streifens. Der Abstand oben hält die Karte
      // frei vom Streifen, der sonst genau darüber liegt.
      <div
        key={exercise.id}
        id={sessionExerciseAnchorId(exercise.id)}
        className="scroll-mt-[calc(6rem+env(safe-area-inset-top))]"
      >
        <SessionExerciseCard
          exercise={exercise}
          exerciseLogs={sortSetLogs(groupedLogs[exercise.id] ?? [])}
          mediaAsset={mediaAssetForExercise(exercise)}
          bandLevels={bandLevels}
          lastSetValues={lastValues?.[exercise.exerciseId]?.setValues}
          lastValuesSummary={isFocused ? focusedLastValuesSummary : undefined}
          isFocused={isFocused}
          isBusy={isReorderingExercises}
          isReadOnly={isReadOnly}
          isFirst={position.isFirst}
          isLast={position.isLast}
          supersetPosition={position.supersetPosition}
          canGroupWithPrevious={orderedSessionExercises[0]?.id !== exercise.id}
          restTracks={restTracksByExerciseId[exercise.id]}
          now={now}
          onMove={handleMoveSessionExercise}
          onFocus={setActiveSessionExerciseId}
          onGroupWithPrevious={(id) => void handleGroupWithPrevious(id)}
          onUngroup={(id) => void handleUngroup(id)}
          runningTimerSetLogId={setTimer?.setLogId}
          timerRemainingSeconds={setTimerRemainingSeconds}
          onToggleSkip={handleToggleSkip}
          onSetCompleted={handleSetCompleted}
          onStartSetTimer={handleStartSetTimer}
          onStopSetTimer={handleStopSetTimer}
          onRequestDeleteSetLog={handleRequestDeleteSetLog}
          onOpenMedia={(mediaAsset, alt) => setMediaPreview({ mediaAsset, alt })}
        />
      </div>
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
  function renderSessionControls(placement: SessionControlsPlacement) {
    const showAddExerciseForm = addExerciseFormAnchor === placement;

    return (
      <SectionCard
        title="Session"
        subtitle={`Gestartet ${formatDateTime(session.startedAt)} · ${sessionWeekContext}`}
      >
        <div className="space-y-3">
          <Button
            variant="secondary"
            fullWidth
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

          {showAddExerciseForm ? (
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
          ) : null}

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
        {/*
          Der Streifen klebt beim Scrollen oben fest: welche Übung gerade
          dran ist und wie weit sie ist, muss auch beim letzten Satz noch
          sichtbar sein.

          Er läuft bis an den Geräterand und legt sich beim Scrollen unter die
          Statusleiste - deshalb das Safe-Area-Padding oben, damit der Inhalt
          nicht unter den Notch rutscht. Die durchscheinende Fläche mit
          `backdrop-blur` trennt ihn vom Inhalt, ohne ihn abzuschneiden.
        */}
        {focusedExercise ? (
          <div className="sticky top-0 z-30 -mx-4 border-b border-line bg-surface-glass px-4 pb-3 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur-xl">
            <button
              type="button"
              onClick={handleJumpToFocusedExercise}
              aria-label={`Zur aktiven Übung springen: ${focusedExercise.exerciseNameSnapshot}`}
              className="flex w-full items-center gap-3 rounded-control text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {focusedExerciseMedia ? (
                <ExerciseMedia
                  mediaAsset={focusedExerciseMedia}
                  alt={focusedExercise.exerciseNameSnapshot}
                  className="h-11 w-11 shrink-0 rounded-control"
                  imageClassName="h-full w-full"
                />
              ) : (
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-surface-raised text-content-muted">
                  <ImageOff size={18} />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-content">
                  {focusedExercise.exerciseNameSnapshot}
                </span>
                <span className="block truncate text-xs text-content-muted">
                  {focusedLogs.length
                    ? `${focusedCompletedCount} von ${focusedLogs.length} Sätzen erledigt`
                    : 'Noch kein Satz angelegt'}
                </span>
              </span>
              <span
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line text-content-secondary"
              >
                <ArrowDown size={16} />
              </span>
            </button>
            {/*
              Der Fortschritt als Linie statt als weitere Zahl: er liest sich
              im Vorbeigehen und braucht keine Breite neben dem Namen.
            */}
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-raised">
              <div
                className="h-full rounded-full bg-accent transition-[width]"
                style={{ width: `${focusedProgressPercent}%` }}
              />
            </div>
          </div>
        ) : null}

        {sessionError ? <Alert>{sessionError}</Alert> : null}

        {/*
          Die Steuerung gleich unter dem Streifen: beim Start der Session ist
          das Hinzufügen einer Übung der nächste Handgriff, und ein Abbruch
          passiert eher am Anfang als nach dem letzten Satz.
        */}
        {session.status === 'active' ? renderSessionControls('top') : null}

        {/*
          Die Übungen stehen darunter. Zuvor lag hier eine Karte, deren Titel
          der Name der aktiven Übung und deren Untertitel Session-Daten waren -
          sie beantwortete damit zwei Fragen gleichzeitig und wiederholte Name
          und Bild der Übung, die zwei Karten tiefer ohnehin schon standen.
        */}
        {orderedSessionExercises.length > 0 ? (
          <div className="space-y-4">
            {sessionBlocks.map((block, blockIndex) => {
              const isFirstBlock = blockIndex === 0;
              const isLastBlock = blockIndex === sessionBlocks.length - 1;

              if (block.kind === 'single') {
                return (
                  <div key={block.exercise.id}>
                    {renderSessionExerciseCard(block.exercise, {
                      isFirst: isFirstBlock,
                      isLast: isLastBlock,
                    })}
                  </div>
                );
              }

              return (
                <SupersetBlock
                  key={block.groupId}
                  positions={block.exercises.map((_, index) => supersetPositionLabel(index))}
                  action={
                    <div className="flex shrink-0 items-center gap-2">
                      <IconButton
                        label="Supersatz nach oben"
                        disabled={isReorderingExercises || isReadOnly || isFirstBlock}
                        onClick={() => void handleMoveSupersetBlock(block.exercises[0].id, -1)}
                      >
                        <ChevronUp size={16} />
                      </IconButton>
                      <IconButton
                        label="Supersatz nach unten"
                        disabled={isReorderingExercises || isReadOnly || isLastBlock}
                        onClick={() => void handleMoveSupersetBlock(block.exercises[0].id, 1)}
                      >
                        <ChevronDown size={16} />
                      </IconButton>
                    </div>
                  }
                >
                  {block.exercises.map((exercise, memberIndex) =>
                    renderSessionExerciseCard(exercise, {
                      isFirst: memberIndex === 0,
                      isLast: memberIndex === block.exercises.length - 1,
                      supersetPosition: supersetPositionLabel(memberIndex),
                    }),
                  )}
                </SupersetBlock>
              );
            })}
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
        Der Timer gehört dorthin, wo der Daumen liegt, und muss während der
        Pause sichtbar bleiben - als Karten-Badge scrollt er nach zwei Wischern
        aus dem Bild.
      */}
      {session.status === 'active' ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-md">
          <div className="pointer-events-auto rounded-t-card border border-b-0 border-line bg-surface-glass p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-soft backdrop-blur-xl">
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
                  */}
                  <div
                    role="timer"
                    aria-live="off"
                    className="flex min-h-touch flex-1 items-center justify-center gap-2 rounded-control bg-warning-soft px-3 text-2xl font-semibold tabular-nums text-warning"
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
                <Button variant="secondary" size="md" fullWidth onClick={() => void handleStartRest()}>
                  <Clock3 size={16} />
                  Pause starten ({focusedExercise?.restSeconds ?? DEFAULT_REST_SECONDS}s)
                </Button>
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
                        isReady ? 'Pause vorbei' : `noch ${formatTimer(remainingRestSeconds(track, now))}`
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
          </div>
        </div>
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
