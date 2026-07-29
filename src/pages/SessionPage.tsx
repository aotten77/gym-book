import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, Clock3, GripVertical, Save, SkipForward, X } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { ExerciseMedia } from '@/components/ExerciseMedia';
import { SectionCard } from '@/components/SectionCard';
import { db } from '@/db/appDb';
import {
  abortSession,
  addSessionExercise,
  clearRestTimer,
  completeSession,
  extendRestTimer,
  reorderSessionExercises,
  startRestTimer,
  toggleSetCompletion,
  toggleSkipSessionExercise,
  updateSetLogValues,
  type SetLogValuesInput,
} from '@/db/session-actions';
import { loadLastValuesForExercises } from '@/db/history-queries';
import { sortSetLogs } from '@/domain/history';
import type { TrackingMode, WorkoutSessionExercise, WorkoutSetLog } from '@/domain/models';
import { supportsReps, supportsSeconds, supportsWeight } from '@/domain/tracking';
import { formatDateTime, formatLoadLabel, formatSessionWeekContext, formatTimer } from '@/lib/format';
import { optionalNumberInput, parseNumberInput, toInputValue } from '@/lib/number-input';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/store/ui-store';

const AUTOSAVE_DELAY_MS = 600;

/** Pause fuer Uebungen, bei denen im Template nichts hinterlegt ist. */
const DEFAULT_REST_SECONDS = 90;

interface SetLogDraft {
  reps: string;
  seconds: string;
  weight: string;
}

interface SessionExerciseFormState {
  exerciseId: string;
  workSetCount: string;
  targetReps: string;
  targetSeconds: string;
  targetWeight: string;
  restSeconds: string;
  notes: string;
}

const defaultSessionExerciseFormState: SessionExerciseFormState = {
  exerciseId: '',
  workSetCount: '3',
  targetReps: '',
  targetSeconds: '',
  targetWeight: '',
  restSeconds: '',
  notes: '',
};

function groupLogsByExercise(setLogs: WorkoutSetLog[]) {
  return setLogs.reduce<Record<string, WorkoutSetLog[]>>((groups, item) => {
    if (!groups[item.sessionExerciseId]) {
      groups[item.sessionExerciseId] = [];
    }

    groups[item.sessionExerciseId].push(item);
    return groups;
  }, {});
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

function formatSideLabel(side: WorkoutSetLog['side']) {
  if (side === 'left') {
    return 'links';
  }

  if (side === 'right') {
    return 'rechts';
  }

  return '';
}

/**
 * Bei unilateralen Uebungen ist die Zahl ohne Seitenangabe wertlos - man
 * weiss sonst nicht, ob "50 kg | 45 kg" zwei Saetze oder zwei Seiten sind.
 */
function formatSetLogWithSide(log: WorkoutSetLog) {
  const sideLabel = formatSideLabel(log.side);
  return sideLabel ? `${formatLoadLabel(log)} (${sideLabel})` : formatLoadLabel(log);
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

function SessionExerciseMeta({
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

function SortableSessionExerciseCard({
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

export function SessionPage() {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  // Selektoren statt des ganzen Stores: sonst rendert jede Netzwerk- oder
  // Update-Statusaenderung diese Seite komplett neu.
  const activeSessionExerciseId = useUiStore((state) => state.activeSessionExerciseId);
  const setActiveSessionExerciseId = useUiStore((state) => state.setActiveSessionExerciseId);
  const [now, setNow] = useState(Date.now());
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [showAddExerciseForm, setShowAddExerciseForm] = useState(false);
  const [isSavingExercise, setIsSavingExercise] = useState(false);
  const [isReorderingExercises, setIsReorderingExercises] = useState(false);
  const [isClosingSession, setIsClosingSession] = useState(false);
  const [draggedSessionExerciseId, setDraggedSessionExerciseId] = useState<string | null>(null);
  const [sessionExerciseOrder, setSessionExerciseOrder] = useState<string[]>([]);
  const [exerciseForm, setExerciseForm] = useState<SessionExerciseFormState>(
    defaultSessionExerciseFormState,
  );

  const session = useLiveQuery(() => db.workoutSessions.get(sessionId), [sessionId]);
  const restTimerEndsAt = session?.restTimerEndsAt ?? null;
  const availableExercises = useLiveQuery(() => db.exercises.orderBy('name').toArray(), []);
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
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

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
  const activeDraggedSessionExercise = useMemo(
    () => orderedSessionExercises.find((item) => item.id === draggedSessionExerciseId),
    [draggedSessionExerciseId, orderedSessionExercises],
  );

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
    if (!restTimerEndsAt) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    // Nach dem Zurueckwechseln aus dem Hintergrund sofort neu rechnen, statt
    // auf den naechsten - vom Browser gedrosselten - Intervall zu warten.
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
  }, [restTimerEndsAt]);

  useEffect(() => {
    if (!restTimerEndsAt || restTimerEndsAt > now) {
      return;
    }

    // Beim Ablauf spuerbar melden - im Gym liegt das Telefon in der Tasche.
    if (typeof navigator.vibrate === 'function') {
      navigator.vibrate([180, 90, 180]);
    }

    void clearRestTimer(sessionId);
  }, [now, restTimerEndsAt, sessionId]);

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
  const focusedExerciseRecord = focusedExercise ? availableExerciseById[focusedExercise.exerciseId] : undefined;

  // Gezielt nur das Bild der fokussierten Uebung laden. Ein `toArray()` ueber
  // alle MediaAssets zoege saemtliche Blobs in den Speicher, um eines zu zeigen.
  const focusedExerciseMedia = useLiveQuery(
    async () =>
      focusedExerciseRecord?.mediaAssetId
        ? db.mediaAssets.get(focusedExerciseRecord.mediaAssetId)
        : undefined,
    [focusedExerciseRecord?.mediaAssetId],
  );

  const focusedLastValues = focusedExercise ? lastValues?.[focusedExercise.exerciseId] : undefined;
  const remainingSeconds = restTimerEndsAt ? Math.max(0, Math.ceil((restTimerEndsAt - now) / 1000)) : 0;
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
  const effectiveUnilateral = selectedExistingExercise?.unilateral ?? false;

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
        targetReps: supportsReps(effectiveTrackingMode)
          ? optionalNumberInput(exerciseForm.targetReps)
          : undefined,
        targetSeconds: supportsSeconds(effectiveTrackingMode)
          ? optionalNumberInput(exerciseForm.targetSeconds)
          : undefined,
        targetWeight: supportsWeight(effectiveTrackingMode)
          ? optionalNumberInput(exerciseForm.targetWeight)
          : undefined,
        restSeconds: optionalNumberInput(exerciseForm.restSeconds),
        notes: exerciseForm.notes,
        exerciseId: exerciseForm.exerciseId,
        trackingMode: effectiveTrackingMode,
        unilateral: effectiveUnilateral,
      });

      setActiveSessionExerciseId(sessionExerciseId);
      setShowAddExerciseForm(false);
      setExerciseForm({
        ...defaultSessionExerciseFormState,
        exerciseId: availableExercises?.[0]?.id ?? '',
      });
    } finally {
      setIsSavingExercise(false);
    }
  }

  async function handleSessionExerciseDragEnd(event: DragEndEvent) {
    setDraggedSessionExerciseId(null);

    if (isReadOnly || !event.over || event.active.id === event.over.id) {
      return;
    }

    const currentIndex = sessionExerciseOrder.indexOf(String(event.active.id));
    const targetIndex = sessionExerciseOrder.indexOf(String(event.over.id));

    if (currentIndex === -1 || targetIndex === -1) {
      return;
    }

    const previousOrder = sessionExerciseOrder;
    const nextOrder = arrayMove(sessionExerciseOrder, currentIndex, targetIndex);
    setSessionExerciseOrder(nextOrder);
    setIsReorderingExercises(true);

    try {
      await reorderSessionExercises(session.id, nextOrder);
      setSessionError(null);
    } catch (error) {
      // Optimistische Reihenfolge zuruecknehmen, sonst zeigt die Liste eine
      // Sortierung, die nie gespeichert wurde.
      setSessionExerciseOrder(previousOrder);
      setSessionError(
        error instanceof Error ? error.message : 'Reihenfolge konnte nicht gespeichert werden.',
      );
    } finally {
      setIsReorderingExercises(false);
    }
  }

  async function handleToggleSkip(sessionExerciseId: string) {
    try {
      await toggleSkipSessionExercise(sessionExerciseId);
      setSessionError(null);
    } catch (error) {
      setSessionError(
        error instanceof Error ? error.message : 'Uebung konnte nicht uebersprungen werden.',
      );
    }
  }

  async function handleSetCompleted(restSeconds?: number) {
    try {
      await startRestTimer(sessionId, restSeconds ?? DEFAULT_REST_SECONDS);
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

  function handleSessionExerciseDragStart(event: DragStartEvent) {
    if (isReadOnly) {
      return;
    }

    setDraggedSessionExerciseId(String(event.active.id));
  }

  function handleSessionExerciseDragCancel() {
    setDraggedSessionExerciseId(null);
  }

  if (!session) {
    return (
      <AppShell title="Session" eyebrow="Execution">
        <SectionCard title="Session nicht gefunden">
          <p className="text-sm text-content-muted">
            Entweder wurde sie noch nicht angelegt oder bereits geloescht.
          </p>
        </SectionCard>
      </AppShell>
    );
  }

  const sessionWeekContext = formatSessionWeekContext(session);

  return (
    <AppShell title={session.templateNameSnapshot} eyebrow="Session">
      <div className="space-y-4">
        <SectionCard
            title={focusedExercise?.exerciseNameSnapshot ?? 'Session Uebersicht'}
          subtitle={`Gestartet ${formatDateTime(session.startedAt)} · ${sessionWeekContext}`}
        >
          {sessionError ? (
            <p role="alert" className="mb-4 rounded-panel border border-rose-300/20 bg-rose-300/10 px-4 py-4 text-sm text-rose-100">
              {sessionError}
            </p>
          ) : null}

            <div className="space-y-4">
              {focusedExercise ? (
              <div className="rounded-panel bg-surface p-4">
                <ExerciseMedia
                  mediaAsset={focusedExerciseMedia}
                  alt={focusedExercise.exerciseNameSnapshot}
                  className="mb-4 h-40 w-full"
                  imageClassName="h-full w-full"
                />
                <p className="text-xs uppercase tracking-[0.18em] text-content-muted">Letzte Werte</p>
                {focusedLastValues ? (
                  <>
                    <p className="mt-2 text-sm text-content-secondary">
                      {focusedLastValues.logs.map(formatSetLogWithSide).join(' · ')}
                    </p>
                    <p className="mt-1 text-xs text-content-muted">
                      {formatDateTime(focusedLastValues.completedAt)}
                      {focusedLastValues.templateName ? ` · ${focusedLastValues.templateName}` : ''}
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-content-secondary">Noch keine Historie vorhanden</p>
                )}
                <p className="mt-3 text-sm text-content-muted">
                  Ziel: {focusedExercise.targetReps ? `${focusedExercise.targetReps} Wdh` : null}
                  {focusedExercise.targetReps && focusedExercise.targetSeconds ? ' · ' : null}
                  {focusedExercise.targetSeconds ? `${focusedExercise.targetSeconds}s` : null}
                  {focusedExercise.targetWeight ? ` · ${focusedExercise.targetWeight} kg` : ''}
                </p>
              </div>
              ) : (
                <div className="rounded-panel bg-surface p-4 text-sm text-content-muted">
                  Noch keine Uebung in dieser Session. Du kannst direkt eine hinzufuegen.
                </div>
              )}

              {session.status === 'active' ? (
                <div className="space-y-3">
                <button
                  type="button"
                    onClick={() => setShowAddExerciseForm((current) => !current)}
                    className="w-full rounded-panel bg-surface-raised px-4 py-4 text-sm font-medium text-content-secondary transition hover:bg-surface-hover"
                >
                    {showAddExerciseForm ? 'Hinzufuegen schliessen' : 'Uebung hinzufuegen'}
                </button>

                  {showAddExerciseForm ? (
                    <div className="space-y-4 rounded-panel border border-line bg-surface p-4">
                      {(availableExercises?.length ?? 0) > 0 ? (
                        <div className="space-y-3">
                          <select
                            value={exerciseForm.exerciseId}
                            onChange={(event) =>
                              setExerciseForm((current) => ({
                                ...current,
                                exerciseId: event.target.value,
                              }))
                            }
                            className="select-control w-full rounded-panel border border-line bg-surface px-4 py-4 text-sm text-content outline-none transition focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
                          >
                            {(availableExercises ?? []).map((exercise) => (
                              <option key={exercise.id} value={exercise.id}>
                                {exercise.name}
                              </option>
                            ))}
                          </select>

                          <p className="text-sm text-content-muted">
                            Modus: {effectiveTrackingMode} ·{' '}
                            {effectiveUnilateral ? 'links/rechts getrennt' : 'beidseitig'}
                          </p>
                          <ExerciseMedia
                            mediaAsset={selectedExerciseMedia}
                            alt={selectedExistingExercise?.name ?? 'Uebung'}
                            className="h-32 w-full"
                            imageClassName="h-full w-full"
                          />
                        </div>
                      ) : (
                        <div className="rounded-panel bg-surface-raised px-4 py-4 text-sm text-content-muted">
                          Noch keine Uebung in der Bibliothek.{' '}
                          <Link to="/exercises" className="text-accent underline underline-offset-2">
                            Jetzt anlegen
                          </Link>
                          .
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-3">
                        <input
                          value={exerciseForm.workSetCount}
                          onChange={(event) =>
                            setExerciseForm((current) => ({
                              ...current,
                              workSetCount: event.target.value,
                            }))
                          }
                          inputMode="numeric"
                          aria-label="Arbeitssaetze" placeholder="Arbeitssaetze"
                          className="rounded-panel border border-line bg-surface px-4 py-4 text-sm text-content outline-none transition placeholder:text-content-muted focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
                        />
                        <input
                          value={exerciseForm.restSeconds}
                          onChange={(event) =>
                            setExerciseForm((current) => ({
                              ...current,
                              restSeconds: event.target.value,
                            }))
                          }
                          inputMode="decimal"
                          aria-label="Pause in s" placeholder="Pause in s"
                          className="rounded-panel border border-line bg-surface px-4 py-4 text-sm text-content outline-none transition placeholder:text-content-muted focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
                        />
                        {supportsReps(effectiveTrackingMode) ? (
                          <input
                            value={exerciseForm.targetReps}
                            onChange={(event) =>
                              setExerciseForm((current) => ({
                                ...current,
                                targetReps: event.target.value,
                              }))
                            }
                            inputMode="numeric"
                            aria-label="Ziel-Wdh" placeholder="Ziel-Wdh"
                            className="rounded-panel border border-line bg-surface px-4 py-4 text-sm text-content outline-none transition placeholder:text-content-muted focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
                          />
                        ) : null}
                        {supportsSeconds(effectiveTrackingMode) ? (
                          <input
                            value={exerciseForm.targetSeconds}
                            onChange={(event) =>
                              setExerciseForm((current) => ({
                                ...current,
                                targetSeconds: event.target.value,
                              }))
                            }
                            inputMode="decimal"
                            aria-label="Ziel-Sekunden" placeholder="Ziel-Sekunden"
                            className="rounded-panel border border-line bg-surface px-4 py-4 text-sm text-content outline-none transition placeholder:text-content-muted focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
                          />
                        ) : null}
                        {supportsWeight(effectiveTrackingMode) ? (
                          <input
                            value={exerciseForm.targetWeight}
                            onChange={(event) =>
                              setExerciseForm((current) => ({
                                ...current,
                                targetWeight: event.target.value,
                              }))
                            }
                            inputMode="decimal"
                            aria-label="Ziel-Gewicht" placeholder="Ziel-Gewicht"
                            className="rounded-panel border border-line bg-surface px-4 py-4 text-sm text-content outline-none transition placeholder:text-content-muted focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
                          />
                        ) : null}
                      </div>

                      <textarea
                        value={exerciseForm.notes}
                        onChange={(event) =>
                          setExerciseForm((current) => ({
                            ...current,
                            notes: event.target.value,
                          }))
                        }
                        rows={3}
                        aria-label="Notizen fuer diese Session-Uebung, optional" placeholder="Notizen fuer diese Session-Uebung, optional"
                        className="w-full rounded-panel border border-line bg-surface px-4 py-4 text-sm text-content outline-none transition placeholder:text-content-muted focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
                      />

                      <div className="grid grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setShowAddExerciseForm(false);
                            setExerciseForm({
                              ...defaultSessionExerciseFormState,
                              exerciseId: availableExercises?.[0]?.id ?? '',
                            });
                          }}
                          className="rounded-panel bg-surface-raised px-4 py-4 text-sm font-medium text-content-secondary transition hover:bg-surface-hover"
                        >
                          Abbrechen
                        </button>
                        <button
                          type="button"
                          onClick={handleAddExercise}
                          disabled={isSavingExercise || !exerciseForm.exerciseId}
                          className="rounded-panel bg-accent px-4 py-4 text-sm font-semibold text-accent-contrast transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isSavingExercise ? 'Speichert...' : 'Zur Session hinzufuegen'}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {session.status === 'active' ? (
                <div className="space-y-3">
                  {focusedExercise ? (
                    <button
                      type="button"
                      onClick={() => void handleToggleSkip(focusedExercise.id)}
                      className={cn(
                        'w-full rounded-panel px-4 py-4 text-sm font-medium transition',
                        focusedExercise.wasSkipped
                          ? 'bg-rose-400/15 text-rose-200'
                          : 'bg-surface-raised text-content-secondary hover:bg-surface-hover',
                      )}
                    >
                      {focusedExercise.wasSkipped ? 'Uebung wieder aktivieren' : 'Uebung ueberspringen'}
                    </button>
                  ) : (
                    <div className="rounded-panel bg-surface-raised px-4 py-4 text-sm text-content-muted">
                      Noch keine aktive Uebung im Fokus.
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => void handleCloseSession('abort')}
                      disabled={isClosingSession}
                      className="rounded-panel border border-rose-400/20 px-4 py-4 text-sm font-medium text-rose-200 transition hover:bg-rose-400/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Session abbrechen
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCloseSession('complete')}
                      disabled={isClosingSession}
                      className="rounded-panel bg-accent px-4 py-4 text-sm font-semibold text-accent-contrast transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isClosingSession ? 'Wird beendet...' : 'Session abschliessen'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-panel bg-surface-raised px-4 py-4 text-sm text-content-muted">
                  Session ist abgeschlossen und schreibgeschuetzt.
                </div>
              )}
            </div>
        </SectionCard>

        {orderedSessionExercises.length > 0 ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleSessionExerciseDragStart}
            onDragCancel={handleSessionExerciseDragCancel}
            onDragEnd={handleSessionExerciseDragEnd}
          >
            <SortableContext items={sessionExerciseOrder} strategy={verticalListSortingStrategy}>
              <div
                className={cn(
                  'space-y-4 rounded-card transition',
                  draggedSessionExerciseId && 'bg-accent/[0.03] p-1 ring-1 ring-lime-300/15',
                )}
              >
                {orderedSessionExercises.map((exercise) => {
                  const exerciseLogs = sortSetLogs(groupedLogs[exercise.id] ?? []);

                  return (
                    <SortableSessionExerciseCard
                      key={exercise.id}
                      exercise={exercise}
                      exerciseLogs={exerciseLogs}
                      isFocused={activeSessionExerciseId === exercise.id}
                      isBusy={isReorderingExercises}
                      isReadOnly={isReadOnly}
                      onFocus={setActiveSessionExerciseId}
                      onToggleSkip={handleToggleSkip}
                      onSetCompleted={handleSetCompleted}
                    />
                  );
                })}
              </div>
            </SortableContext>
            <DragOverlay>
              {activeDraggedSessionExercise ? (
                <div className="w-[min(100vw-40px,32rem)] rounded-panel border border-lime-300/35 bg-zinc-950/95 p-4 shadow-soft ring-2 ring-lime-300/20 backdrop-blur">
                  <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-accent/90">
                    <GripVertical size={14} />
                    <span>Loslassen zum Ablegen</span>
                  </div>
                  <div className="flex min-w-0 gap-3">
                    <div className="rounded-control border border-accent-border bg-accent-soft p-2 text-accent">
                      <GripVertical size={16} />
                    </div>
                    <SessionExerciseMeta exercise={activeDraggedSessionExercise} />
                  </div>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        ) : null}
      </div>

      {/*
        Der Timer gehoert dorthin, wo der Daumen liegt, und muss waehrend der
        Pause sichtbar bleiben - als Karten-Badge scrollt er nach zwei Wischern
        aus dem Bild.
      */}
      {session.status === 'active' ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-card border border-line bg-zinc-950/90 p-2 shadow-soft backdrop-blur-xl">
            {remainingSeconds > 0 ? (
              <>
                <div
                  role="timer"
                  aria-live="off"
                  className="flex flex-1 items-center justify-center gap-2 rounded-control bg-amber-300/15 px-3 py-3 text-base font-semibold tabular-nums text-amber-200"
                >
                  <Clock3 size={16} />
                  {formatTimer(remainingSeconds)}
                </div>
                <button
                  type="button"
                  onClick={() => void extendRestTimer(sessionId, 30)}
                  className="h-11 min-w-11 rounded-control border border-line px-3 text-sm font-medium text-content-secondary transition hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-lime-300/70"
                >
                  +30s
                </button>
                <button
                  type="button"
                  onClick={() => void clearRestTimer(sessionId)}
                  aria-label="Pausentimer abbrechen"
                  className="flex h-11 w-11 items-center justify-center rounded-control border border-line text-content-secondary transition hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-lime-300/70"
                >
                  <X size={16} />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => void handleSetCompleted(focusedExercise?.restSeconds)}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-control bg-surface-raised px-3 text-sm font-medium text-content-secondary transition hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-lime-300/70"
              >
                <Clock3 size={16} />
                Pause starten ({focusedExercise?.restSeconds ?? DEFAULT_REST_SECONDS}s)
              </button>
            )}
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
