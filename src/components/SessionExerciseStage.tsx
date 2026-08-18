import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Link2,
  Minus,
  Play,
  Plus,
  Trash2,
  Unlink,
} from 'lucide-react';
import { ExerciseMedia } from '@/components/ExerciseMedia';
import { Button, IconButton } from '@/components/ui/Button';
import {
  toggleSetCompletion,
  updateSetLogValues,
  type SetLogValuesInput,
} from '@/db/session-actions';
import type { LastSetValues, SetValues } from '@/domain/history';
import type {
  BandLevel,
  LoadKind,
  MediaAsset,
  RestTimerTrack,
  SetTimerState,
  TrackingMode,
  WorkoutSessionExercise,
  WorkoutSetLog,
} from '@/domain/models';
import {
  buildRestBadges,
  isRestTrackReady,
  remainingRestSeconds,
  type RestBadge,
} from '@/domain/rest-timer';
import {
  buildSetRounds,
  describeExerciseTarget,
  describeSetRow,
  describeSetRowValues,
  setRowFallback,
  type SetRowFallback,
} from '@/domain/session-summary';
import {
  SET_TIMER_STEP_SECONDS,
  clampSetTimerSeconds,
  resolveSetTimerSeconds,
} from '@/domain/set-timer';
import {
  supportsBand,
  supportsHeight,
  supportsReps,
  supportsSeconds,
  supportsWeight,
} from '@/domain/tracking';
import { formatSideLabel, formatTimer } from '@/lib/format';
import { parseNumberInput, toInputValue } from '@/lib/number-input';
import { cn } from '@/lib/utils';

/** Pause zwischen Tastendruck und Autosave - siehe ActiveSetEditor. */
const AUTOSAVE_DELAY_MS = 600;

/**
 * Schrittweite der Knöpfe neben der Wertebox.
 *
 * 2,5 kg, weil die kleinste Scheibe 1,25 wiegt und die Stange zwei davon
 * bekommt. Für Sekunden gilt der Schritt des Satz-Timers - dort verschieben
 * dieselben Knöpfe die Zielzeit, nicht einen eingetragenen Wert. 5 cm für die
 * Höhe, weil Stufen, Boxen und Hantelscheiben-Stapel in dieser Teilung
 * kommen: 20, 25, 30.
 */
const STEP_BY_FIELD = {
  reps: 1,
  seconds: SET_TIMER_STEP_SECONDS,
  weight: 2.5,
  heightCm: 5,
} as const;

/** Die Zahlenfelder eines Satzes - das Band ist eine Auswahl, kein Wert. */
type SetLogFieldKey = 'reps' | 'seconds' | 'weight' | 'heightCm';

interface SetLogDraft {
  reps: string;
  seconds: string;
  weight: string;
  heightCm: string;
  /** Leerstring heißt "kein Band gewählt" - `undefined` gibt es im Draft nicht. */
  bandId: string;
}

function createSetLogDraft(log: WorkoutSetLog): SetLogDraft {
  return {
    reps: toInputValue(log.reps),
    seconds: toInputValue(log.seconds),
    weight: toInputValue(log.weight),
    heightCm: toInputValue(log.heightCm),
    bandId: log.bandId ?? '',
  };
}

/**
 * Die Zahlenfelder eines Satzes.
 *
 * Das Band steht bewusst nicht in dieser Liste: es ist eine Auswahl, kann
 * daher nicht "ungültig" sein und braucht weder Parser noch Autosave-Pause.
 */
const SET_LOG_FIELDS: ReadonlyArray<{
  key: SetLogFieldKey;
  supported: (trackingMode: TrackingMode, loadKind?: LoadKind, tracksHeight?: boolean) => boolean;
}> = [
  { key: 'reps', supported: (trackingMode) => supportsReps(trackingMode) },
  {
    key: 'seconds',
    supported: (trackingMode) => supportsSeconds(trackingMode),
  },
  { key: 'weight', supported: supportsWeight },
  // Die Höhe hängt allein am Schalter der Übung: sie steht neben Kilo oder
  // Band, nicht an deren Stelle.
  {
    key: 'heightCm',
    supported: (_trackingMode, _loadKind, tracksHeight) => supportsHeight(tracksHeight),
  },
];

/**
 * Einheit in der Wertebox.
 *
 * Kurz gehalten, weil sie neben der Zahl steht: auf 320px bricht schon "Wdh
 * links" um und schiebt die Box in die Höhe. Die Seite steht ohnehin über der
 * Box und auf der Seitenkarte; im zugänglichen Namen des Feldes kommt sie
 * trotzdem vor.
 */
const SET_LOG_FIELD_UNITS = {
  reps: 'Wdh',
  seconds: 'Sek.',
  weight: 'kg',
  heightCm: 'cm',
} as const;

/** Zugänglicher Name des Feldes - "kg" allein sagt in einer Vorleseliste nichts. */
const SET_LOG_FIELD_LABELS = {
  reps: 'Wdh',
  seconds: 'Sekunden',
  weight: 'Gewicht in kg',
  heightCm: 'Höhe in cm',
} as const;

/**
 * Sammelt die Felder, die tatsächlich geschrieben werden sollen.
 *
 * Ungültige Eingaben werden ausgelassen statt als `undefined` gesendet -
 * sonst würde eine Fehleingabe den gespeicherten Wert löschen. Ein bewusst
 * geleertes Feld wird dagegen als `undefined` übernommen.
 */
function collectSetLogChanges(
  draft: SetLogDraft,
  log: WorkoutSetLog,
  trackingMode: TrackingMode,
  loadKind?: LoadKind,
  tracksHeight?: boolean,
) {
  const changes: SetLogValuesInput = {};
  let hasChange = false;

  for (const { key, supported } of SET_LOG_FIELDS) {
    if (!supported(trackingMode, loadKind, tracksHeight)) {
      continue;
    }

    const parsed = parseNumberInput(draft[key]);

    if (parsed.status === 'invalid') {
      continue;
    }

    const nextValue = parsed.status === 'valid' ? parsed.value : undefined;

    if (nextValue !== log[key]) {
      changes[key] = nextValue;
      hasChange = true;
    }
  }

  if (supportsBand(trackingMode, loadKind)) {
    const nextBandId = draft.bandId.trim() || undefined;

    if (nextBandId !== log.bandId) {
      changes.bandId = nextBandId;
      hasChange = true;
    }
  }

  return hasChange ? changes : null;
}

function findInvalidSetLogFields(
  draft: SetLogDraft,
  trackingMode: TrackingMode,
  loadKind?: LoadKind,
  tracksHeight?: boolean,
) {
  return SET_LOG_FIELDS.filter(
    ({ key, supported }) =>
      supported(trackingMode, loadKind, tracksHeight) &&
      parseNumberInput(draft[key]).status === 'invalid',
  ).map(({ key }) => key);
}

/**
 * Übernimmt die Werte der letzten Woche in leer gelassene Felder.
 *
 * Der häufigste Fall im Training ist "genau wie letzte Woche". Dafür soll ein
 * Tap auf den großen Knopf genügen, ohne dieselben Zahlen erneut zu tippen -
 * der Platzhalter wird damit zum echten, gespeicherten Wert.
 */
function adoptPlaceholders(
  draft: SetLogDraft,
  lastValues: SetValues,
  trackingMode: TrackingMode,
  loadKind?: LoadKind,
  tracksHeight?: boolean,
) {
  let next = draft;

  for (const { key, supported } of SET_LOG_FIELDS) {
    if (!supported(trackingMode, loadKind, tracksHeight) || draft[key].trim()) {
      continue;
    }

    const placeholder = toInputValue(lastValues[key]);

    if (!placeholder) {
      continue;
    }

    next = { ...next, [key]: placeholder };
  }

  // Auch das Band der letzten Woche zählt als Vorgabe: sonst wäre es das
  // einzige Feld, das man bei "genau wie letztes Mal" doch antippen müsste.
  if (supportsBand(trackingMode, loadKind) && !draft.bandId.trim() && lastValues.bandId) {
    next = { ...next, bandId: lastValues.bandId };
  }

  return next;
}

/**
 * Der große Knopf im Fuß des Sheets, gemeldet von dem Satz, der gerade offen
 * liegt.
 *
 * Er steht dort und nicht an der Satzzeile, weil der Fuß am
 * `visualViewport` hängt und damit über der Tastatur stehen bleibt. Die
 * Beschriftung kommt trotzdem von hier: nur der Editor kennt den Draft, und
 * ein Knopf, der "62,5 kg × 5" verspricht, während im Feld 65 steht, wäre eine
 * Lüge.
 */
export interface ActiveSetAction {
  label: string;
  disabled: boolean;
  run: () => Promise<void>;
}

interface ActiveSetEditorProps {
  log: WorkoutSetLog;
  exercise: WorkoutSessionExercise;
  /** Band-Katalog für die Satzauswahl - nur bei Band-Übungen im Einsatz. */
  bandLevels?: BandLevel[];
  /** Werte derselben Satzzeile aus der letzten abgeschlossenen Ausführung. */
  lastValues?: SetValues;
  /** Gesetzt, solange der Satz-Timer genau zu dieser Zeile läuft. */
  setTimer?: SetTimerState;
  timerRemainingSeconds: number;
  onStartTimer: (setLogId: string, seconds: number) => void;
  /** Stoppt den laufenden Timer und liefert die gehaltene Zeit zurück. */
  onStopTimer: () => Promise<number | undefined>;
  onClearTimer: () => void;
  onCompleted: () => void;
  onRequestDelete: (log: WorkoutSetLog) => void;
  onActionChange: (action: ActiveSetAction | null) => void;
  disabled?: boolean;
}

/**
 * Der eine Satz, der gerade dran ist.
 *
 * Die Mechanik darin ist unverändert und war schon immer die heikelste Stelle
 * der App: der Draft gleicht sich feldweise mit der Live-Query ab, der
 * Autosave lässt ungültige Eingaben liegen statt sie als `undefined` zu
 * schreiben, und beim Abhaken zählen die Platzhalter der letzten Woche als
 * Eingabe. Neu ist nur die Form: eine Wertebox je Feld, groß genug zum Lesen
 * im Stehen, mit Knöpfen daneben, damit dafür keine Tastatur aufgehen muss.
 */
function ActiveSetEditor({
  log,
  exercise,
  bandLevels,
  lastValues,
  setTimer,
  timerRemainingSeconds,
  onStartTimer,
  onStopTimer,
  onClearTimer,
  onCompleted,
  onRequestDelete,
  onActionChange,
  disabled,
}: ActiveSetEditorProps) {
  const [draft, setDraft] = useState<SetLogDraft>(() => createSetLogDraft(log));
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const syncedRef = useRef<SetLogDraft>(createSetLogDraft(log));
  const { trackingMode, loadKind, tracksHeight } = exercise;

  /*
   * Übernimmt Änderungen aus der Datenbank, ohne gerade Getipptes zu
   * zerstören.
   *
   * Ein naives `setDraft(createSetLogDraft(log))` wäre fatal: speichert das
   * Autosave ein Feld, feuert die Live-Query, und der Effekt würde die
   * Eingabe im Nachbarfeld überschreiben, während der Nutzer noch tippt.
   * Deshalb wird ein Feld nur übernommen, wenn es seit dem letzten Abgleich
   * unverändert ist.
   */
  useEffect(() => {
    const incoming = createSetLogDraft(log);

    setDraft((current) => ({
      reps: current.reps === syncedRef.current.reps ? incoming.reps : current.reps,
      seconds: current.seconds === syncedRef.current.seconds ? incoming.seconds : current.seconds,
      weight: current.weight === syncedRef.current.weight ? incoming.weight : current.weight,
      heightCm:
        current.heightCm === syncedRef.current.heightCm ? incoming.heightCm : current.heightCm,
      bandId: current.bandId === syncedRef.current.bandId ? incoming.bandId : current.bandId,
    }));

    syncedRef.current = incoming;
    // Bewusst an den Primitiven statt am `log`-Objekt: useLiveQuery liefert bei
    // jedem Emit eine neue Objektidentität, der Effekt würde sonst ständig
    // laufen und den Draft ausbremsen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log.completed, log.id, log.reps, log.seconds, log.weight, log.heightCm, log.bandId]);

  const invalidFields = findInvalidSetLogFields(draft, trackingMode, loadKind, tracksHeight);
  const hasInvalidInput = invalidFields.length > 0;
  const pendingChanges = disabled
    ? null
    : collectSetLogChanges(draft, log, trackingMode, loadKind, tracksHeight);
  const dirty = pendingChanges !== null;

  const persist = useCallback(
    async (nextDraft?: SetLogDraft) => {
      const changes = collectSetLogChanges(
        nextDraft ?? draft,
        log,
        trackingMode,
        loadKind,
        tracksHeight,
      );

      if (!changes || disabled) {
        return;
      }

      setIsSaving(true);

      try {
        await updateSetLogValues(log.id, changes);
        setSaveError(null);
      } catch (error) {
        setSaveError(
          error instanceof Error ? error.message : 'Werte konnten nicht gespeichert werden.',
        );
      } finally {
        setIsSaving(false);
      }
    },
    [disabled, draft, loadKind, log, trackingMode, tracksHeight],
  );

  // Autosave: getippte Werte müssen einen Reload mitten im Training überleben.
  useEffect(() => {
    if (!dirty || hasInvalidInput || disabled) {
      return undefined;
    }

    const handle = window.setTimeout(() => {
      void persist();
    }, AUTOSAVE_DELAY_MS);

    return () => window.clearTimeout(handle);
  }, [dirty, hasInvalidInput, disabled, persist]);

  const isTimerRunning = Boolean(setTimer);
  const parsedSeconds = parseNumberInput(draft.seconds);
  const timerSeconds = resolveSetTimerSeconds(
    parsedSeconds.status === 'valid' ? parsedSeconds.value : undefined,
    exercise.targetSeconds,
  );

  /**
   * Verschiebt einen Wert in Schritten, damit dafür keine Tastatur aufgeht.
   *
   * Ist das Feld leer, zählt die Vorgabe als Ausgangspunkt - der Platzhalter
   * der letzten Woche, sonst das Ziel der Übung. Ein "+" auf einem leeren Feld
   * soll bei dem landen, was ohnehin geplant war, und nicht bei 2,5 kg.
   */
  function adjustField(key: SetLogFieldKey, delta: number) {
    setDraft((current) => {
      const parsed = parseNumberInput(current[key]);
      const fallback =
        key === 'reps'
          ? (lastValues?.reps ?? exercise.targetReps)
          : key === 'seconds'
            ? (lastValues?.seconds ?? exercise.targetSeconds)
            : key === 'heightCm'
              ? (lastValues?.heightCm ?? exercise.targetHeightCm)
              : (lastValues?.weight ?? exercise.targetWeight);
      const base = parsed.status === 'valid' ? parsed.value : (fallback ?? 0);
      const next =
        key === 'seconds'
          ? clampSetTimerSeconds(base + delta)
          : // Auf zwei Nachkommastellen runden: 62,5 + 2,5 ergibt in Gleitkomma
            // sonst gelegentlich 65.00000000000001.
            Math.max(0, Math.round((base + delta) * 100) / 100);

      return { ...current, [key]: toInputValue(next) };
    });
  }

  const handleToggleCompletion = useCallback(async () => {
    if (disabled || hasInvalidInput) {
      return;
    }

    const willComplete = !log.completed;
    /*
     * Beim Abhaken zählt der Platzhalter als Eingabe: wer dasselbe geschafft
     * hat wie letzte Woche, tippt nichts und tappt nur auf den großen Knopf.
     * Beim Zurücknehmen bleibt der Draft unangetastet.
     */
    let effectiveDraft =
      willComplete && lastValues
        ? adoptPlaceholders(draft, lastValues, trackingMode, loadKind, tracksHeight)
        : draft;

    /*
     * Ein noch laufender Timer wird durch das Abhaken beendet - der Satz ist
     * ja vorbei. Seine gehaltene Zeit sticht Platzhalter und Zielzeit: sie ist
     * gemessen, nicht geschätzt.
     */
    if (willComplete && isTimerRunning) {
      const achievedSeconds = await onStopTimer();

      if (typeof achievedSeconds === 'number') {
        effectiveDraft = {
          ...effectiveDraft,
          seconds: toInputValue(achievedSeconds),
        };
      }
    }

    if (effectiveDraft !== draft) {
      setDraft(effectiveDraft);
    }

    await persist(effectiveDraft);
    await toggleSetCompletion(log.id);

    if (willComplete) {
      onCompleted();
    }
  }, [
    disabled,
    draft,
    hasInvalidInput,
    isTimerRunning,
    lastValues,
    loadKind,
    log.completed,
    log.id,
    onCompleted,
    onStopTimer,
    persist,
    trackingMode,
    tracksHeight,
  ]);

  /*
   * Der große Knopf steht im Fuß des Sheets, seine Beschriftung entsteht aber
   * hier - aus dem Draft, nicht aus dem gespeicherten Satz. Die Funktion liegt
   * in einem Ref, damit die Meldung nach oben nur an den *Primitiven* hängt:
   * ein Objekt mit neuer Identität bei jedem Tastendruck würde den Effekt in
   * eine Schleife schicken.
   */
  const runRef = useRef(handleToggleCompletion);
  const draftValue = (key: SetLogFieldKey) => {
    const parsed = parseNumberInput(draft[key]);
    return parsed.status === 'valid' ? parsed.value : log[key];
  };
  const previewValues = describeSetRowValues(
    {
      ...log,
      // Bewusst als offen behandelt: die Beschriftung soll auch dann etwas
      // sagen, wenn nichts eingetragen ist - dann steht dort die Vorgabe, und
      // genau die wird beim Abhaken übernommen.
      completed: false,
      reps: draftValue('reps'),
      seconds: draftValue('seconds'),
      weight: draftValue('weight'),
      heightCm: draftValue('heightCm'),
      bandNameSnapshot:
        bandLevels?.find((band) => band.id === draft.bandId)?.name ?? log.bandNameSnapshot,
    },
    setRowFallback(exercise, lastValues),
  );
  const sideLabel = formatSideLabel(log.side);
  const actionLabel = log.completed
    ? `${describeSetRow(log)} zurücknehmen`
    : `${[previewValues, sideLabel].filter(Boolean).join(' ') || describeSetRow(log)} abhaken`;

  useEffect(() => {
    runRef.current = handleToggleCompletion;
  });

  useEffect(() => {
    if (disabled) {
      onActionChange(null);
      return undefined;
    }

    onActionChange({
      label: actionLabel,
      disabled: hasInvalidInput,
      run: () => runRef.current(),
    });

    // Abmelden beim Verschwinden: sonst bliebe im Fuß der Knopf eines Satzes
    // stehen, den es nicht mehr gibt. Beim bloßen Wechsel der Beschriftung
    // laufen Aufräumen und Melden im selben Commit - es flackert nichts.
    return () => onActionChange(null);
  }, [actionLabel, disabled, hasInvalidInput, onActionChange]);

  const showBandField = supportsBand(trackingMode, loadKind);
  const activeFields = SET_LOG_FIELDS.filter(({ supported }) =>
    supported(trackingMode, loadKind, tracksHeight),
  );
  // Das Band der letzten Woche steht in der leeren Option, analog zum
  // Platzhalter der Zahlenfelder.
  const lastBandName = lastValues?.bandNameSnapshot;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-content-muted">
          {describeSetRow(log)}
          {log.completed ? ' · erledigt' : ''}
        </p>
        {/*
          Leise, obwohl es löscht: die Rückfrage davor trägt die Warnung, und
          ein roter Knopf neben dem Satznamen wäre auf der Bühne das Lauteste
          nach der Überschrift - für etwas, das man im Training fast nie tut.
        */}
        {!disabled ? (
          <IconButton
            label={`${describeSetRow(log)} entfernen`}
            className="h-9 w-9 border-transparent bg-transparent text-content-muted"
            onClick={() => onRequestDelete(log)}
          >
            <Trash2 size={16} />
          </IconButton>
        ) : null}
      </div>

      {/*
        Läuft die Zeit, tritt sie an die Stelle der Werteboxen: wer im Plank
        liegt, sieht genau eine Zahl. Sie trägt dann auch das `role="timer"` -
        die Leiste im Fuß gibt es in diesem Moment nicht als zweite Uhr.
      */}
      {isTimerRunning && setTimer ? (
        <StageSetTimer
          remainingSeconds={timerRemainingSeconds}
          durationSeconds={setTimer.durationSeconds}
          onStop={() => void onStopTimer()}
          onDiscard={onClearTimer}
        />
      ) : (
        <div className="space-y-2">
          {activeFields.map(({ key }) => {
            const isInvalid = invalidFields.includes(key);
            const fieldId = `${log.id}-${key}`;
            // Zeigt, was beim letzten Mal in genau diesem Satz stand.
            const placeholder = toInputValue(lastValues?.[key]);
            const step = STEP_BY_FIELD[key];

            return (
              <div key={key} className="grid grid-cols-[3.25rem_minmax(0,1fr)_3.25rem] gap-2">
                <StepButton
                  label={`${SET_LOG_FIELD_LABELS[key]} um ${step} verringern`}
                  onClick={() => adjustField(key, -step)}
                  disabled={disabled}
                >
                  <Minus size={20} />
                </StepButton>
                {/*
                  Der eingetragene Wert ist das, was im Training aus einem Meter
                  Entfernung lesbar sein muss - er trägt deshalb das Gewicht der
                  Zeile, nicht seine Beschriftung. Die Einheit steht als echtes
                  `<label>` daneben, damit das Feld einen Namen behält.
                */}
                <div
                  className={cn(
                    // Weiß, nicht die versenkte Fläche: die Bühne liegt selbst
                    // auf einem hellen Grau, und ein Feld, das sich davon kaum
                    // abhebt, sieht im Studio nicht mehr wie ein Feld aus.
                    'flex min-h-[3.25rem] items-baseline justify-center gap-1.5 rounded-panel bg-surface px-2',
                    isInvalid && 'ring-2 ring-inset ring-danger-border',
                  )}
                >
                  <input
                    id={fieldId}
                    value={draft[key]}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        [key]: event.target.value,
                      }))
                    }
                    onBlur={() => {
                      if (!hasInvalidInput) {
                        void persist();
                      }
                    }}
                    inputMode={key === 'reps' ? 'numeric' : 'decimal'}
                    placeholder={placeholder || '–'}
                    aria-invalid={isInvalid}
                    aria-label={
                      sideLabel
                        ? `${SET_LOG_FIELD_LABELS[key]} ${sideLabel}`
                        : SET_LOG_FIELD_LABELS[key]
                    }
                    disabled={disabled}
                    size={4}
                    className={cn(
                      'min-w-0 max-w-[6rem] bg-transparent py-2 text-right font-display text-[28px] font-extrabold tabular-nums tracking-tight text-content',
                      'outline-none transition placeholder:font-semibold placeholder:text-content-muted',
                      'focus-visible:ring-2 focus-visible:ring-accent',
                      'disabled:cursor-not-allowed disabled:opacity-60',
                    )}
                  />
                  <label
                    htmlFor={fieldId}
                    className="shrink-0 whitespace-nowrap text-xs font-bold text-content-muted"
                  >
                    {SET_LOG_FIELD_UNITS[key]}
                  </label>
                </div>
                <StepButton
                  label={`${SET_LOG_FIELD_LABELS[key]} um ${step} erhöhen`}
                  onClick={() => adjustField(key, step)}
                  disabled={disabled}
                >
                  <Plus size={20} />
                </StepButton>
              </div>
            );
          })}

          {/*
            Bandauswahl statt Kilo-Feld. Sie schreibt sofort statt über den
            Autosave-Timer: eine Auswahl ist mit einem Tap fertig, da gibt es
            nichts abzuwarten wie bei einer halb getippten Zahl.
          */}
          {showBandField ? (
            <div className="flex items-center gap-2 rounded-panel bg-surface px-3 py-2">
              <label
                htmlFor={`${log.id}-bandId`}
                className="shrink-0 text-[10px] font-bold uppercase tracking-[0.16em] text-content-muted"
              >
                Band
              </label>
              <select
                id={`${log.id}-bandId`}
                value={draft.bandId}
                onChange={(event) => {
                  const nextDraft = { ...draft, bandId: event.target.value };
                  setDraft(nextDraft);
                  void persist(nextDraft);
                }}
                disabled={disabled}
                className={cn(
                  // Ohne eigenes `pr-*`: `.select-control` bringt Höhe und
                  // Platz für den Pfeil selbst mit - unter WebKit ist genau
                  // das die Stelle, an der ein Auswahlfeld schon einmal auf
                  // 22px zusammengefallen ist.
                  'min-w-0 flex-1 rounded-control bg-transparent font-display text-xl font-bold text-content',
                  'select-control outline-none transition',
                  'focus-visible:ring-2 focus-visible:ring-accent',
                  'disabled:cursor-not-allowed disabled:opacity-60',
                )}
              >
                <option value="">
                  {lastBandName
                    ? `– (zuletzt: ${lastBandName})`
                    : bandLevels?.length
                      ? '–'
                      : 'Keine Bänder angelegt'}
                </option>
                {bandLevels?.map((band) => (
                  <option key={band.id} value={band.id}>
                    {band.name}
                  </option>
                ))}
                {/*
                  Das gewählte Band kann inzwischen aus dem Katalog gelöscht
                  sein. Ohne diese Option zeigte das Feld dann einen leeren
                  Wert - und der nächste Tap woanders hätte den Satz stillschweigend
                  umgeschrieben.
                */}
                {draft.bandId && !bandLevels?.some((band) => band.id === draft.bandId) ? (
                  <option value={draft.bandId}>
                    {log.bandNameSnapshot ?? 'Gelöschtes Band'} (nicht mehr im Katalog)
                  </option>
                ) : null}
              </select>
            </div>
          ) : null}

          {/*
            Timer für Sätze auf Zeit: ein Plank über zwei Minuten soll nicht die
            Uhr einer anderen App brauchen. Verschoben wird die Zielzeit über
            dieselben Knöpfe, die sonst den Wert verschieben - im Sekundenfeld
            steht anschließend, was der Timer gemessen hat.
          */}
          {supportsSeconds(trackingMode) && !disabled ? (
            <Button
              variant="secondary"
              size="lg"
              className="w-full justify-center"
              onClick={() => onStartTimer(log.id, timerSeconds)}
              disabled={hasInvalidInput}
            >
              <Play size={16} />
              <span className="tabular-nums">{formatTimer(timerSeconds)}</span>
              starten
            </Button>
          ) : null}
        </div>
      )}

      {hasInvalidInput ? (
        <p role="alert" className="text-sm text-danger">
          Bitte eine Zahl eintragen (Komma erlaubt, z. B. 52,5). Bisherige Werte bleiben
          gespeichert.
        </p>
      ) : null}

      {saveError ? (
        <p role="alert" className="text-sm text-danger">
          {saveError}
        </p>
      ) : null}

      {isSaving ? <p className="text-xs text-content-muted">Wird gespeichert...</p> : null}
    </div>
  );
}

function StepButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'flex min-h-[3.25rem] items-center justify-center rounded-panel bg-surface text-content transition',
        'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        'disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      {children}
    </button>
  );
}

/**
 * Die laufende Satzzeit als Fläche.
 *
 * Sie trägt das einzige `role="timer"` im Dokument, solange sie steht - die
 * Leiste am unteren Rand wird währenddessen nicht gerendert.
 */
function StageSetTimer({
  remainingSeconds,
  durationSeconds,
  onStop,
  onDiscard,
}: {
  remainingSeconds: number;
  durationSeconds: number;
  onStop: () => void;
  onDiscard: () => void;
}) {
  const elapsedPercent =
    durationSeconds > 0
      ? Math.min(100, Math.max(0, ((durationSeconds - remainingSeconds) / durationSeconds) * 100))
      : 0;

  return (
    <div className="space-y-3 rounded-panel bg-success p-4 text-success-contrast">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-bold uppercase tracking-[0.16em] opacity-75">
          Satz läuft
        </span>
        <span className="text-xs font-bold tabular-nums opacity-75">
          von {formatTimer(durationSeconds)}
        </span>
      </div>
      <p
        role="timer"
        aria-live="off"
        className="font-display text-[44px] font-extrabold leading-none tabular-nums tracking-tight"
      >
        {formatTimer(remainingSeconds)}
      </p>
      <div className="h-1.5 overflow-hidden rounded-full bg-black/20">
        <div className="h-full rounded-full bg-highlight" style={{ width: `${elapsedPercent}%` }} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {/*
          Die zugänglichen Namen sind dieselben wie an der Leiste am unteren
          Rand: es ist dieselbe Handlung, nur an dem Ort, an dem die Uhr gerade
          steht. Zwei Namen für eine Sache wären in einer Vorlesereihe nicht
          auseinanderzuhalten - und die Tests griffen ins Leere.
        */}
        <button
          type="button"
          onClick={onDiscard}
          aria-label="Satz-Timer verwerfen, ohne die Zeit zu übernehmen"
          className="flex min-h-touch items-center justify-center rounded-control bg-white/10 text-sm font-bold transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight"
        >
          Verwerfen
        </button>
        <button
          type="button"
          onClick={onStop}
          aria-label="Zeit stoppen und in den Satz übernehmen"
          className="flex min-h-touch items-center justify-center rounded-control bg-highlight text-sm font-bold text-highlight-contrast transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight"
        >
          Stoppen
        </button>
      </div>
    </div>
  );
}

interface SessionExerciseStageProps {
  exercise: WorkoutSessionExercise;
  /** Die Sätze dieser Übung, bereits sortiert. */
  exerciseLogs: WorkoutSetLog[];
  mediaAsset?: MediaAsset;
  bandLevels?: BandLevel[];
  lastSetValues?: LastSetValues;
  /** Der Satz, der gerade groß liegt - siehe SessionPage. */
  activeSetLog?: WorkoutSetLog;
  onSelectSetLog: (setLogId: string) => void;
  isBusy: boolean;
  isReadOnly: boolean;
  isFirst: boolean;
  isLast: boolean;
  /** Ob die Übung zu einem Supersatz gehört. */
  isSupersetMember: boolean;
  /** Ob es eine Vorgängerin gibt, mit der sich verbinden lässt. */
  canGroupWithPrevious: boolean;
  setTimer?: SetTimerState;
  timerRemainingSeconds: number;
  /** Laufende Pausen dieser Übung - eine je Seite. */
  restTracks?: RestTimerTrack[];
  now: number;
  onActionChange: (action: ActiveSetAction | null) => void;
  onMove: (sessionExerciseId: string, direction: -1 | 1) => void;
  onGroupWithPrevious: (sessionExerciseId: string) => void;
  onUngroup: (sessionExerciseId: string) => void;
  onSetCompleted: (sessionExerciseId: string, completedSetLog: WorkoutSetLog) => void;
  onStartSetTimer: (setLogId: string, seconds: number) => void;
  onStopSetTimer: () => Promise<number | undefined>;
  onClearSetTimer: () => void;
  onRequestDeleteSetLog: (log: WorkoutSetLog, exerciseName: string) => void;
  onOpenMedia: (mediaAsset: MediaAsset, alt: string) => void;
}

/**
 * Die Übung, die gerade läuft - die Bühne im Fokus-Sheet.
 *
 * Genau ein Satz liegt groß und bedienbar; die übrigen stehen als schmale
 * Zeilen darunter und werden mit einem Tipp zum aktiven Satz. Vorher stand
 * hier jeder Satz als voller Editor untereinander: bei fünf Sätzen mit Kilo
 * und Wiederholungen zehn Felder, alle gleich laut, und die Zahl, um die es
 * gerade ging, musste man suchen.
 */
export function SessionExerciseStage({
  exercise,
  exerciseLogs,
  mediaAsset,
  bandLevels,
  lastSetValues,
  activeSetLog,
  onSelectSetLog,
  isBusy,
  isReadOnly,
  isFirst,
  isLast,
  isSupersetMember,
  canGroupWithPrevious,
  setTimer,
  timerRemainingSeconds,
  restTracks,
  now,
  onActionChange,
  onMove,
  onGroupWithPrevious,
  onUngroup,
  onSetCompleted,
  onStartSetTimer,
  onStopSetTimer,
  onClearSetTimer,
  onRequestDeleteSetLog,
  onOpenMedia,
}: SessionExerciseStageProps) {
  const rounds = buildSetRounds(exerciseLogs);
  const restBadges = buildRestBadges(exerciseLogs, restTracks, now);
  const activeRound = rounds.find((round) => round.rows.some((row) => row.id === activeSetLog?.id));
  /*
   * Innerhalb einer Gruppe sortieren die Pfeile nur die Gruppe um - der Block
   * als Ganzes wandert über die Pfeile seiner Karte in der Liste. Die
   * Beschriftung muss das sagen, sonst führen zwei Pfeilpaare dieselbe
   * Handlung im Namen.
   */
  const moveScopeLabel = isSupersetMember ? ' im Supersatz' : '';

  return (
    <section
      aria-label={exercise.exerciseNameSnapshot}
      data-stage-exercise={exercise.id}
      className="space-y-3 rounded-card bg-surface-raised p-4"
    >
      <div className="flex items-start gap-3">
        {mediaAsset ? (
          <button
            type="button"
            onClick={() => onOpenMedia(mediaAsset, exercise.exerciseNameSnapshot)}
            aria-label={`Bild von ${exercise.exerciseNameSnapshot} vergrößern`}
            className="shrink-0 overflow-hidden rounded-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ExerciseMedia
              mediaAsset={mediaAsset}
              alt={exercise.exerciseNameSnapshot}
              className="h-14 w-14"
              imageClassName="h-full w-full"
            />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-[23px] font-extrabold leading-[1.06] tracking-[-0.04em]">
            {exercise.exerciseNameSnapshot}
          </h3>
          <p className="mt-0.5 text-xs font-semibold text-content-muted">
            {exercise.wasSkipped ? 'Ausgelassen · ' : ''}
            {describeExerciseTarget(exercise)}
            {exercise.restSeconds ? ` · Pause ${exercise.restSeconds}s` : ''}
          </p>
        </div>
        {/*
          Was der *Übung* gilt, steht bei ihrem Namen: verbinden, lösen und im
          Supersatz die Reihenfolge der beiden Mitglieder. Als Icons, weil man
          sie im Training höchstens einmal braucht - eine Knopfreihe über die
          volle Breite stand vorher zwischen den Sätzen und der Fußzeile und
          war das Erste, was beim Scrollen ins Bild kam.
        */}
        {!isReadOnly ? (
          <div className="flex shrink-0 items-center gap-0.5">
            {isSupersetMember ? (
              <>
                <IconButton
                  label={`${exercise.exerciseNameSnapshot}${moveScopeLabel} nach oben`}
                  disabled={isBusy || isFirst}
                  onClick={() => onMove(exercise.id, -1)}
                  className="h-9 w-9 border-transparent bg-transparent"
                >
                  <ChevronUp size={16} />
                </IconButton>
                <IconButton
                  label={`${exercise.exerciseNameSnapshot}${moveScopeLabel} nach unten`}
                  disabled={isBusy || isLast}
                  onClick={() => onMove(exercise.id, 1)}
                  className="h-9 w-9 border-transparent bg-transparent"
                >
                  <ChevronDown size={16} />
                </IconButton>
                <IconButton
                  label={`${exercise.exerciseNameSnapshot} aus dem Supersatz lösen`}
                  onClick={() => onUngroup(exercise.id)}
                  className="h-9 w-9 border-transparent bg-transparent"
                >
                  <Unlink size={16} />
                </IconButton>
              </>
            ) : (
              <IconButton
                label={`${exercise.exerciseNameSnapshot} mit voriger Übung verbinden`}
                onClick={() => onGroupWithPrevious(exercise.id)}
                disabled={!canGroupWithPrevious}
                className="h-9 w-9 border-transparent bg-transparent"
              >
                <Link2 size={16} />
              </IconButton>
            )}
          </div>
        ) : null}
      </div>

      {/*
        Beide Seiten der laufenden Runde nebeneinander: bei einer einbeinigen
        Übung ist "12" ohne die Angabe, welche Seite, keine Auskunft - und der
        Vergleich der beiden ist der Grund, warum die App die Seiten überhaupt
        getrennt führt.
      */}
      {exercise.unilateral && activeRound && activeRound.rows.length > 1 ? (
        <div className="grid grid-cols-2 gap-2">
          {activeRound.rows.map((row) => (
            <SideCard
              key={row.id}
              log={row}
              fallback={setRowFallback(exercise, lastSetValues?.resolve(row))}
              isActive={row.id === activeSetLog?.id}
              onSelect={() => onSelectSetLog(row.id)}
            />
          ))}
        </div>
      ) : null}

      {activeSetLog ? (
        <ActiveSetEditor
          key={activeSetLog.id}
          log={activeSetLog}
          exercise={exercise}
          bandLevels={bandLevels}
          lastValues={lastSetValues?.resolve(activeSetLog)}
          setTimer={setTimer?.setLogId === activeSetLog.id ? setTimer : undefined}
          timerRemainingSeconds={timerRemainingSeconds}
          onStartTimer={onStartSetTimer}
          onStopTimer={onStopSetTimer}
          onClearTimer={onClearSetTimer}
          onCompleted={() => onSetCompleted(exercise.id, activeSetLog)}
          onRequestDelete={(item) => onRequestDeleteSetLog(item, exercise.exerciseNameSnapshot)}
          onActionChange={onActionChange}
          disabled={isReadOnly}
        />
      ) : (
        <p className="rounded-panel bg-surface-sunken px-3 py-3 text-sm text-content-muted">
          In dieser Übung steht keine Satzzeile mehr.
        </p>
      )}

      {/*
        Die übrigen Sätze als schmale Zeilen: erledigt waldgrün, der aktive
        limette, offen grau. Ein Tipp holt eine Zeile nach oben - so kommt man
        an einen Aufwärmsatz, den man korrigieren oder entfernen will.
      */}
      {rounds.length > 0 ? (
        <div className="space-y-1">
          {rounds.map((round) =>
            round.rows.map((row) => (
              <SetRowButton
                key={row.id}
                log={row}
                fallback={setRowFallback(exercise, lastSetValues?.resolve(row))}
                isActive={row.id === activeSetLog?.id}
                restBadge={restBadges[row.id]}
                onSelect={() => onSelectSetLog(row.id)}
              />
            )),
          )}
        </div>
      ) : null}

      {/*
        Hier stand eine Fußzeile mit Volumen und den Werten der letzten
        Einheit. Sie ist ersatzlos weg: was beim letzten Mal in *diesem* Satz
        stand, trägt die offene Satzzeile ohnehin (siehe `setRowFallback`), und
        eine zweite, abgeschnittene Aufzählung derselben Zahlen beantwortet
        keine Frage. Die Asymmetrie steht in der Liste an der fertigen Übung.
      */}
    </section>
  );
}

/** Eine Seite der laufenden Runde. */
function SideCard({
  log,
  fallback,
  isActive,
  onSelect,
}: {
  log: WorkoutSetLog;
  fallback: SetRowFallback;
  isActive: boolean;
  onSelect: () => void;
}) {
  const values = describeSetRowValues(log, fallback);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`${describeSetRow(log)} auswählen`}
      aria-current={isActive}
      className={cn(
        'rounded-panel px-3 py-2 text-left transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        log.completed
          ? 'bg-success text-success-contrast'
          : isActive
            ? 'bg-highlight text-highlight-contrast'
            : 'bg-surface-sunken text-content',
      )}
    >
      <span className="block truncate text-[11px] font-bold uppercase tracking-[0.16em] opacity-75">
        {formatSideLabel(log.side) || 'beidseitig'}
      </span>
      {/* Auf 320px bleibt für "23,75 kg × 7" keine zweite Zeile - lieber kürzen. */}
      <span className="block truncate font-display text-base font-extrabold tabular-nums tracking-tight">
        {values || '–'}
      </span>
    </button>
  );
}

/** Eine schmale Satzzeile in der Liste unter dem aktiven Satz. */
function SetRowButton({
  log,
  fallback,
  isActive,
  restBadge,
  onSelect,
}: {
  log: WorkoutSetLog;
  fallback: SetRowFallback;
  isActive: boolean;
  restBadge?: RestBadge;
  onSelect: () => void;
}) {
  const values = describeSetRowValues(log, fallback);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`${describeSetRow(log)} auswählen`}
      aria-current={isActive}
      data-set-row={log.id}
      className={cn(
        'flex w-full items-center gap-2 rounded-control px-3 py-1.5 text-left text-[13px] transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        log.completed
          ? 'bg-success text-success-contrast'
          : isActive
            ? 'bg-highlight text-highlight-contrast'
            : 'bg-surface-sunken text-content-secondary hover:bg-surface-hover',
      )}
    >
      <span
        className={cn(
          // Breit genug für "Satz 1 · links": abgeschnitten benennt die Zeile
          // den Satz nicht mehr eindeutig.
          'w-[6.5rem] shrink-0 truncate text-[11px] font-bold uppercase tracking-[0.06em]',
          log.completed || isActive ? 'opacity-75' : 'text-content-muted',
        )}
      >
        {describeSetRow(log)}
      </span>
      <span className="min-w-0 flex-1 truncate font-display font-bold tabular-nums">{values}</span>
      {/*
        Die Pause steht an der Zeile, die auf sie wartet. Genau hier entsteht
        die Frage "kann ich rechts schon wieder?" - und im Supersatz wie bei
        zwei Seiten gibt es darauf mehr als eine Antwort.
      */}
      {restBadge ? (
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[12px] font-bold tabular-nums',
            // Laufend ist neutral - dieselbe Papierfläche wie der Chip auf der
            // Blockkarte. Sie hebt sich von jeder Zeile ab, auf der das Abzeichen
            // sitzen kann: gesenkt, limette oder grün. Bedeutung trägt erst
            // "bereit".
            restBadge.isReady ? 'bg-success text-success-contrast' : 'bg-surface text-content',
          )}
        >
          {restBadge.isReady ? 'bereit' : formatTimer(restBadge.remainingSeconds)}
        </span>
      ) : null}
      {log.completed ? <Check size={14} strokeWidth={3} className="shrink-0" /> : null}
      {isActive && !log.completed ? (
        <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.1em]">jetzt</span>
      ) : null}
    </button>
  );
}

interface SessionPartnerRowProps {
  exercise: WorkoutSessionExercise;
  completedCount: number;
  totalCount: number;
  restTracks?: RestTimerTrack[];
  now: number;
  onSelect: (sessionExerciseId: string) => void;
}

/**
 * Das Mitglied des Supersatzes, das gerade nicht dran ist.
 *
 * Es schrumpft auf Name, Stand und Uhr - mehr braucht man von ihm nicht,
 * solange man die andere Übung ausführt. Der Name bleibt eine Überschrift,
 * damit die Gliederung des Sheets erhalten bleibt; der Knopf daneben holt die
 * Übung auf die Bühne, weil eine Überschrift *im* Knopf kein gültiges HTML
 * wäre.
 */
export function SessionPartnerRow({
  exercise,
  completedCount,
  totalCount,
  restTracks,
  now,
  onSelect,
}: SessionPartnerRowProps) {
  return (
    <div className="flex items-center gap-2 rounded-card bg-surface-raised px-3 py-2">
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-display text-sm font-bold tracking-tight">
          {exercise.exerciseNameSnapshot}
        </h3>
        <p className="text-[12px] font-semibold text-content-muted tabular-nums">
          {completedCount} von {totalCount} Sätzen
        </p>
      </div>
      {restTracks?.map((track) => {
        const isReady = isRestTrackReady(track, now);
        const sideLabel = formatSideLabel(track.side);

        return (
          <span
            key={`${track.sessionExerciseId}-${track.side}`}
            className={cn(
              'shrink-0 rounded-full px-2 py-1 text-[12px] font-bold tabular-nums',
              isReady ? 'bg-success text-success-contrast' : 'bg-surface text-content-secondary',
            )}
          >
            {sideLabel ? `${sideLabel.charAt(0).toUpperCase()} ` : ''}
            {isReady ? 'bereit' : formatTimer(remainingRestSeconds(track, now))}
          </span>
        );
      })}
      <Button
        variant="ghost"
        size="md"
        aria-label={`Zu ${exercise.exerciseNameSnapshot} wechseln`}
        onClick={() => onSelect(exercise.id)}
      >
        Wechseln
      </Button>
    </div>
  );
}
