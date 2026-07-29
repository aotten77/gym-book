import { useCallback, useEffect, useRef, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, GripVertical, Save, SkipForward } from 'lucide-react';
import { SectionCard } from '@/components/SectionCard';
import { toggleSetCompletion, updateSetLogValues, type SetLogValuesInput } from '@/db/session-actions';
import type { TrackingMode, WorkoutSessionExercise, WorkoutSetLog } from '@/domain/models';
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
 * Sammelt die Felder, die tatsaechlich geschrieben werden sollen.
 *
 * Ungueltige Eingaben werden ausgelassen statt als `undefined` gesendet -
 * sonst wuerde eine Fehleingabe den gespeicherten Wert loeschen. Ein bewusst
 * geleertes Feld wird dagegen als `undefined` uebernommen.
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

interface SetLogEditorProps {
  log: WorkoutSetLog;
  trackingMode: TrackingMode;
  onCompleted: () => void;
  disabled?: boolean;
}

function SetLogEditor({ log, trackingMode, onCompleted, disabled }: SetLogEditorProps) {
  const [draft, setDraft] = useState<SetLogDraft>(() => createSetLogDraft(log));
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const syncedRef = useRef<SetLogDraft>(createSetLogDraft(log));

  /*
   * Uebernimmt Aenderungen aus der Datenbank, ohne gerade Getipptes zu
   * zerstoeren.
   *
   * Ein naives `setDraft(createSetLogDraft(log))` waere fatal: speichert das
   * Autosave ein Feld, feuert die Live-Query, und der Effekt wuerde die
   * Eingabe im Nachbarfeld ueberschreiben, waehrend der Nutzer noch tippt.
   * Deshalb wird ein Feld nur uebernommen, wenn es seit dem letzten Abgleich
   * unveraendert ist.
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
    // jedem Emit eine neue Objektidentitaet, der Effekt wuerde sonst staendig
    // laufen und den Draft ausbremsen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log.completed, log.id, log.reps, log.seconds, log.weight]);

  const invalidFields = findInvalidSetLogFields(draft, trackingMode);
  const hasInvalidInput = invalidFields.length > 0;
  const pendingChanges = disabled ? null : collectSetLogChanges(draft, log, trackingMode);
  const dirty = pendingChanges !== null;

  const persist = useCallback(async () => {
    const changes = collectSetLogChanges(draft, log, trackingMode);

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
  }, [disabled, draft, log, trackingMode]);

  // Autosave: getippte Werte muessen einen Reload mitten im Training ueberleben.
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

    if (dirty) {
      await persist();
    }

    await toggleSetCompletion(log.id);

    if (!log.completed) {
      onCompleted();
    }
  }

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

      <div className={cn('mt-4 grid gap-3', fieldCount === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
        {SET_LOG_FIELDS.filter(({ supported }) => supported(trackingMode)).map(({ key }) => {
          const isInvalid = invalidFields.includes(key);
          const fieldId = `${log.id}-${key}`;

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
                aria-invalid={isInvalid}
                disabled={disabled}
                className={cn(
                  'w-full rounded-panel border bg-surface px-4 py-4 text-sm text-content outline-none transition focus-visible:ring-2 focus-visible:ring-lime-300/70 disabled:cursor-not-allowed disabled:opacity-60',
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

      {dirty && !hasInvalidInput ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-content-muted">
          <Save size={13} />
          {isSaving ? 'Wird gespeichert...' : 'Wird automatisch gespeichert'}
        </p>
      ) : null}
    </div>
  );
}

function formatSessionExerciseSubtitle(exercise: WorkoutSessionExercise) {
  if (exercise.wasSkipped) {
    return 'Aktuell uebersprungen';
  }

  if (exercise.addedInSession) {
    return 'Waehrend der Session hinzugefuegt';
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

interface SortableSessionExerciseCardProps {
  exercise: WorkoutSessionExercise;
  exerciseLogs: WorkoutSetLog[];
  isFocused: boolean;
  isBusy: boolean;
  isReadOnly: boolean;
  onFocus: (sessionExerciseId: string) => void;
  onToggleSkip: (sessionExerciseId: string) => void;
  onSetCompleted: (restSeconds?: number) => void;
}

export function SortableSessionExerciseCard({
  exercise,
  exerciseLogs,
  isFocused,
  isBusy,
  isReadOnly,
  onFocus,
  onToggleSkip,
  onSetCompleted,
}: SortableSessionExerciseCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: exercise.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <SectionCard
        title={exercise.exerciseNameSnapshot}
        subtitle={formatSessionExerciseSubtitle(exercise)}
        className={cn(
          isFocused && 'border-lime-300/40 bg-accent/[0.06]',
          isDragging
            ? 'border-accent-border opacity-35 shadow-soft ring-2 ring-lime-300/20'
            : 'transition hover:border-accent-border hover:bg-surface-raised',
        )}
        action={
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label={`${exercise.exerciseNameSnapshot} ziehen und umsortieren`}
              disabled={isBusy || isReadOnly}
              className={cn(
                'touch-none rounded-control border p-2 transition disabled:cursor-not-allowed disabled:opacity-35',
                isDragging
                  ? 'cursor-grabbing border-accent-border bg-accent-soft text-accent'
                  : 'cursor-grab border-line text-content-secondary hover:bg-surface-raised active:cursor-grabbing',
              )}
              {...attributes}
              {...listeners}
            >
              <GripVertical size={16} />
            </button>
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
        <div className="mb-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => onToggleSkip(exercise.id)}
            disabled={isReadOnly}
            className="min-h-touch inline-flex items-center justify-center rounded-control border border-line px-3 py-2 text-sm text-content-secondary transition hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
          >
            <div className="flex items-center gap-2">
              <SkipForward size={14} />
              {exercise.wasSkipped ? 'Zurueckholen' : 'Skip'}
            </div>
          </button>
        </div>

        <div className="space-y-3">
          {exerciseLogs.map((log) => (
            <SetLogEditor
              key={log.id}
              log={log}
              trackingMode={exercise.trackingMode}
              onCompleted={() => onSetCompleted(exercise.restSeconds)}
              disabled={isReadOnly}
            />
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
