import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, ChevronUp, ImageOff, SkipForward, X } from 'lucide-react';
import { ExerciseMedia } from '@/components/ExerciseMedia';
import { SectionCard } from '@/components/SectionCard';
import { IconButton } from '@/components/ui/Button';
import { toggleSetCompletion, updateSetLogValues, type SetLogValuesInput } from '@/db/session-actions';
import type { LastSetValues, SetValues } from '@/domain/history';
import type { MediaAsset, TrackingMode, WorkoutSessionExercise, WorkoutSetLog } from '@/domain/models';
import { supportsReps, supportsSeconds, supportsWeight } from '@/domain/tracking';
import { formatLoadLabel, formatSideLabel } from '@/lib/format';
import { parseNumberInput, toInputValue } from '@/lib/number-input';
import { cn } from '@/lib/utils';

/** Pause zwischen Tastendruck und Autosave - siehe SetLogEditor. */
const AUTOSAVE_DELAY_MS = 600;

interface SetLogDraft {
  reps: string;
  seconds: string;
  weight: string;
}

function createSetLogDraft(log: WorkoutSetLog): SetLogDraft {
  return {
    reps: toInputValue(log.reps),
    seconds: toInputValue(log.seconds),
    weight: toInputValue(log.weight),
  };
}

const SET_LOG_FIELDS = [
  { key: 'reps', supported: supportsReps },
  { key: 'seconds', supported: supportsSeconds },
  { key: 'weight', supported: supportsWeight },
] as const;

const SET_LOG_FIELD_LABELS = {
  reps: 'Wdh',
  seconds: 'Sekunden',
  weight: 'Gewicht in kg',
} as const;

/**
 * Sammelt die Felder, die tatsächlich geschrieben werden sollen.
 *
 * Ungültige Eingaben werden ausgelassen statt als `undefined` gesendet -
 * sonst würde eine Fehleingabe den gespeicherten Wert löschen. Ein bewusst
 * geleertes Feld wird dagegen als `undefined` übernommen.
 */
function collectSetLogChanges(draft: SetLogDraft, log: WorkoutSetLog, trackingMode: TrackingMode) {
  const changes: SetLogValuesInput = {};
  let hasChange = false;

  for (const { key, supported } of SET_LOG_FIELDS) {
    if (!supported(trackingMode)) {
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

  return hasChange ? changes : null;
}

function findInvalidSetLogFields(draft: SetLogDraft, trackingMode: TrackingMode) {
  return SET_LOG_FIELDS.filter(
    ({ key, supported }) => supported(trackingMode) && parseNumberInput(draft[key]).status === 'invalid',
  ).map(({ key }) => key);
}

/**
 * Übernimmt die Werte der letzten Woche in leer gelassene Felder.
 *
 * Der häufigste Fall im Training ist "genau wie letzte Woche". Dafür soll ein
 * Tap auf Fertig genügen, ohne dieselben Zahlen erneut zu tippen - der
 * Platzhalter wird damit zum echten, gespeicherten Wert.
 */
function adoptPlaceholders(draft: SetLogDraft, lastValues: SetValues, trackingMode: TrackingMode) {
  let next = draft;

  for (const { key, supported } of SET_LOG_FIELDS) {
    if (!supported(trackingMode) || draft[key].trim()) {
      continue;
    }

    const placeholder = toInputValue(lastValues[key]);

    if (!placeholder) {
      continue;
    }

    next = { ...next, [key]: placeholder };
  }

  return next;
}

interface SetLogEditorProps {
  log: WorkoutSetLog;
  trackingMode: TrackingMode;
  /** Werte derselben Satzzeile aus der letzten abgeschlossenen Ausführung. */
  lastValues?: SetValues;
  onCompleted: () => void;
  onRequestDelete: (log: WorkoutSetLog) => void;
  disabled?: boolean;
}

function SetLogEditor({
  log,
  trackingMode,
  lastValues,
  onCompleted,
  onRequestDelete,
  disabled,
}: SetLogEditorProps) {
  const [draft, setDraft] = useState<SetLogDraft>(() => createSetLogDraft(log));
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const syncedRef = useRef<SetLogDraft>(createSetLogDraft(log));

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
    }));

    syncedRef.current = incoming;
    // Bewusst an den Primitiven statt am `log`-Objekt: useLiveQuery liefert bei
    // jedem Emit eine neue Objektidentität, der Effekt würde sonst ständig
    // laufen und den Draft ausbremsen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log.completed, log.id, log.reps, log.seconds, log.weight]);

  const invalidFields = findInvalidSetLogFields(draft, trackingMode);
  const hasInvalidInput = invalidFields.length > 0;
  const pendingChanges = disabled ? null : collectSetLogChanges(draft, log, trackingMode);
  const dirty = pendingChanges !== null;

  const persist = useCallback(
    async (nextDraft?: SetLogDraft) => {
      const changes = collectSetLogChanges(nextDraft ?? draft, log, trackingMode);

      if (!changes || disabled) {
        return;
      }

      setIsSaving(true);

      try {
        await updateSetLogValues(log.id, changes);
        setSaveError(null);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : 'Werte konnten nicht gespeichert werden.');
      } finally {
        setIsSaving(false);
      }
    },
    [disabled, draft, log, trackingMode],
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

  async function handleToggleCompletion() {
    if (disabled || hasInvalidInput) {
      return;
    }

    const willComplete = !log.completed;
    /*
     * Beim Abhaken zählt der Platzhalter als Eingabe: wer dasselbe geschafft
     * hat wie letzte Woche, tippt nichts und tappt nur auf Fertig. Beim
     * Zurücknehmen bleibt der Draft unangetastet.
     */
    const effectiveDraft =
      willComplete && lastValues ? adoptPlaceholders(draft, lastValues, trackingMode) : draft;

    if (effectiveDraft !== draft) {
      setDraft(effectiveDraft);
    }

    await persist(effectiveDraft);
    await toggleSetCompletion(log.id);

    if (willComplete) {
      onCompleted();
    }
  }

  const setLabel = `${log.setKind === 'warmup' ? 'Warmup' : `Satz ${log.setNumber}`}${
    log.side !== 'both' ? ` ${formatSideLabel(log.side)}` : ''
  }`;
  const fieldCount = Number(supportsReps(trackingMode)) + Number(supportsSeconds(trackingMode)) + Number(supportsWeight(trackingMode));

  return (
    <div
      className={cn(
        'rounded-panel border px-4 py-4 transition',
        log.completed ? 'border-accent-border bg-accent-soft' : 'border-line bg-surface',
        disabled && 'opacity-80',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-content">
            {log.setKind === 'warmup' ? 'Warmup' : `Satz ${log.setNumber}`}
            {log.side !== 'both' ? ` · ${formatSideLabel(log.side)}` : ''}
          </p>
          <p className="mt-1 text-sm text-content-muted">{formatLoadLabel(log)}</p>
        </div>
        <div className="flex items-center gap-2">
          {!disabled ? (
            <IconButton
              label={`${setLabel} entfernen`}
              variant="danger"
              onClick={() => onRequestDelete(log)}
            >
              <X size={16} />
            </IconButton>
          ) : null}
          <button
            type="button"
            onClick={handleToggleCompletion}
            disabled={disabled || hasInvalidInput}
            aria-label={log.completed ? 'Satz als offen markieren' : 'Satz als erledigt markieren'}
            className={cn(
              'flex h-11 min-w-11 items-center justify-center rounded-control px-3 text-sm font-medium transition',
              log.completed
                ? 'bg-accent text-accent-contrast'
                : 'bg-surface-raised text-content-secondary hover:bg-surface-hover',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            {log.completed ? <Check size={16} /> : 'Fertig'}
          </button>
        </div>
      </div>

      <div className={cn('mt-4 grid gap-3', fieldCount === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
        {SET_LOG_FIELDS.filter(({ supported }) => supported(trackingMode)).map(({ key }) => {
          const isInvalid = invalidFields.includes(key);
          const fieldId = `${log.id}-${key}`;
          // Zeigt, was beim letzten Mal in genau diesem Satz stand.
          const placeholder = toInputValue(lastValues?.[key]);

          return (
            <div key={key}>
              <label htmlFor={fieldId} className="mb-1 block text-xs text-content-muted">
                {SET_LOG_FIELD_LABELS[key]}
              </label>
              <input
                id={fieldId}
                value={draft[key]}
                onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
                onBlur={() => {
                  if (!hasInvalidInput) {
                    void persist();
                  }
                }}
                inputMode={key === 'reps' ? 'numeric' : 'decimal'}
                placeholder={placeholder}
                aria-invalid={isInvalid}
                disabled={disabled}
                className={cn(
                  'w-full rounded-panel border bg-surface px-4 py-4 text-base text-content outline-none transition focus-visible:ring-2 focus-visible:ring-lime-300/70 disabled:cursor-not-allowed disabled:opacity-60',
                  isInvalid ? 'border-rose-400/60' : 'border-line focus:border-lime-300/40',
                )}
              />
            </div>
          );
        })}
      </div>

      {hasInvalidInput ? (
        <p role="alert" className="mt-3 text-sm text-rose-200">
          Bitte eine Zahl eintragen (Komma erlaubt, z. B. 52,5). Bisherige Werte bleiben gespeichert.
        </p>
      ) : null}

      {saveError ? (
        <p role="alert" className="mt-3 text-sm text-rose-200">
          {saveError}
        </p>
      ) : null}

      {isSaving ? <p className="mt-3 text-xs text-content-muted">Wird gespeichert...</p> : null}
    </div>
  );
}

function formatSessionExerciseSubtitle(exercise: WorkoutSessionExercise) {
  if (exercise.wasSkipped) {
    return 'Aktuell übersprungen';
  }

  if (exercise.addedInSession) {
    return 'Während der Session hinzugefügt';
  }

  return 'Teil der laufenden Session';
}

export function SessionExerciseMeta({
  exercise,
  showOrder = true,
}: {
  exercise: WorkoutSessionExercise;
  showOrder?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-semibold text-content">
        {showOrder ? `${exercise.orderIndex}. ` : ''}
        {exercise.exerciseNameSnapshot}
      </p>
      <p className="mt-1 text-sm text-content-muted">{formatSessionExerciseSubtitle(exercise)}</p>
      <p className="mt-2 text-sm text-content-muted">
        Ziel: {exercise.targetReps ? `${exercise.targetReps} Wdh` : null}
        {exercise.targetReps && exercise.targetSeconds ? ' · ' : null}
        {exercise.targetSeconds ? `${exercise.targetSeconds}s` : null}
        {exercise.targetWeight ? ` · ${exercise.targetWeight} kg` : ''}
        {exercise.restSeconds ? ` · Pause ${exercise.restSeconds}s` : ''}
      </p>
    </div>
  );
}

interface SessionExerciseCardProps {
  exercise: WorkoutSessionExercise;
  exerciseLogs: WorkoutSetLog[];
  mediaAsset?: MediaAsset;
  lastSetValues?: LastSetValues;
  isFocused: boolean;
  isBusy: boolean;
  isReadOnly: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMove: (sessionExerciseId: string, direction: -1 | 1) => void;
  onFocus: (sessionExerciseId: string) => void;
  onToggleSkip: (sessionExerciseId: string) => void;
  onSetCompleted: (restSeconds?: number) => void;
  onRequestDeleteSetLog: (log: WorkoutSetLog, exerciseName: string) => void;
  onOpenMedia: (mediaAsset: MediaAsset, alt: string) => void;
}

export function SessionExerciseCard({
  exercise,
  exerciseLogs,
  mediaAsset,
  lastSetValues,
  isFocused,
  isBusy,
  isReadOnly,
  isFirst,
  isLast,
  onMove,
  onFocus,
  onToggleSkip,
  onSetCompleted,
  onRequestDeleteSetLog,
  onOpenMedia,
}: SessionExerciseCardProps) {
  return (
    <SectionCard
      title={exercise.exerciseNameSnapshot}
      subtitle={formatSessionExerciseSubtitle(exercise)}
      className={cn(
        isFocused && 'border-lime-300/40 bg-accent/[0.06]',
        'transition hover:border-accent-border hover:bg-surface-raised',
      )}
      action={
        <div className="flex items-center gap-2">
          {/*
            Pfeile statt Drag: die alte Geste sprang schon bei acht Pixeln an
            und sortierte beim Scrollen versehentlich um.
          */}
          <IconButton
            label={`${exercise.exerciseNameSnapshot} nach oben`}
            disabled={isBusy || isReadOnly || isFirst}
            onClick={() => onMove(exercise.id, -1)}
          >
            <ChevronUp size={16} />
          </IconButton>
          <IconButton
            label={`${exercise.exerciseNameSnapshot} nach unten`}
            disabled={isBusy || isReadOnly || isLast}
            onClick={() => onMove(exercise.id, 1)}
          >
            <ChevronDown size={16} />
          </IconButton>
          <button
            type="button"
            onClick={() => onFocus(exercise.id)}
            className="min-h-touch inline-flex items-center justify-center rounded-control border border-line px-3 py-2 text-sm text-content-secondary transition hover:bg-surface-raised"
          >
            Fokus
          </button>
        </div>
      }
    >
      {/*
        Das Bild gehört genau hierhin: der Ablauf muss beim Eintragen sichtbar
        sein, nicht nur ganz oben in der Übersicht.
      */}
      {mediaAsset ? (
        <button
          type="button"
          onClick={() => onOpenMedia(mediaAsset, exercise.exerciseNameSnapshot)}
          aria-label={`Bild von ${exercise.exerciseNameSnapshot} vergrößern`}
          className="mb-4 block w-full rounded-3xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ExerciseMedia
            mediaAsset={mediaAsset}
            alt={exercise.exerciseNameSnapshot}
            className="h-40 w-full"
            imageClassName="h-full w-full"
          />
        </button>
      ) : (
        <div className="mb-4 flex items-center gap-3 rounded-panel border border-dashed border-line bg-surface px-4 py-3 text-sm text-content-muted">
          <ImageOff size={16} className="shrink-0" />
          <span>
            Kein Bild hinterlegt.{' '}
            <Link to="/exercises" className="text-accent underline underline-offset-2">
              In der Bibliothek ergänzen
            </Link>
            .
          </span>
        </div>
      )}

      <div className="mb-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onToggleSkip(exercise.id)}
          disabled={isReadOnly}
          className="min-h-touch inline-flex items-center justify-center rounded-control border border-line px-3 py-2 text-sm text-content-secondary transition hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
        >
          <div className="flex items-center gap-2">
            <SkipForward size={14} />
            {exercise.wasSkipped ? 'Zurückholen' : 'Skip'}
          </div>
        </button>
      </div>

      <div className="space-y-3">
        {exerciseLogs.map((log) => (
          <SetLogEditor
            key={log.id}
            log={log}
            trackingMode={exercise.trackingMode}
            lastValues={lastSetValues?.resolve(log)}
            onCompleted={() => onSetCompleted(exercise.restSeconds)}
            onRequestDelete={(item) => onRequestDeleteSetLog(item, exercise.exerciseNameSnapshot)}
            disabled={isReadOnly}
          />
        ))}
      </div>
    </SectionCard>
  );
}
