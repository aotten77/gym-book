import { useEffect, useMemo, useState } from 'react';
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
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Clock3, GripVertical, X } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { ExerciseMedia } from '@/components/ExerciseMedia';
import { ExerciseTargetFields } from '@/components/ExerciseTargetFields';
import { SectionCard } from '@/components/SectionCard';
import { SessionExerciseMeta, SortableSessionExerciseCard } from '@/components/SessionExerciseCard';
import { db } from '@/db/appDb';
import {
  abortSession,
  addSessionExercise,
  clearRestTimer,
  completeSession,
  extendRestTimer,
  reorderSessionExercises,
  startRestTimer,
  toggleSkipSessionExercise,
} from '@/db/session-actions';
import { loadLastValuesForExercises } from '@/db/history-queries';
import { sortSetLogs } from '@/domain/history';
import type { WorkoutSessionExercise, WorkoutSetLog } from '@/domain/models';
import { supportsReps, supportsSeconds, supportsWeight } from '@/domain/tracking';
import { formatDateTime, formatSessionWeekContext, formatSetLogWithSide, formatTimer } from '@/lib/format';
import { optionalNumberInput } from '@/lib/number-input';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/store/ui-store';

/** Pause fuer Uebungen, bei denen im Template nichts hinterlegt ist. */
const DEFAULT_REST_SECONDS = 90;

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
                        <ExerciseTargetFields
                          trackingMode={effectiveTrackingMode}
                          values={exerciseForm}
                          onChange={(field, value) =>
                            setExerciseForm((current) => ({ ...current, [field]: value }))
                          }
                          layout="grid"
                        />
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
