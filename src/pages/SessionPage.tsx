import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDown, ArrowUp, Check, Clock3, Save, SkipForward } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { SectionCard } from '@/components/SectionCard';
import { db } from '@/db/appDb';
import {
  addSessionExercise,
  completeSession,
  moveSessionExercise,
  toggleSetCompletion,
  toggleSkipSessionExercise,
  updateSetLogValues,
} from '@/db/session-actions';
import type { TrackingMode, WorkoutSessionExercise, WorkoutSetLog } from '@/domain/models';
import { formatDateTime, formatLoadLabel, formatTimer } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/store/ui-store';

interface SetLogDraft {
  reps: string;
  seconds: string;
  weight: string;
}

type ExerciseSource = 'existing' | 'new';

interface SessionExerciseFormState {
  exerciseSource: ExerciseSource;
  exerciseId: string;
  exerciseName: string;
  instructions: string;
  tempo: string;
  trackingMode: TrackingMode;
  unilateral: boolean;
  workSetCount: string;
  targetReps: string;
  targetSeconds: string;
  targetWeight: string;
  restSeconds: string;
  notes: string;
}

const defaultSessionExerciseFormState: SessionExerciseFormState = {
  exerciseSource: 'existing',
  exerciseId: '',
  exerciseName: '',
  instructions: '',
  tempo: '',
  trackingMode: 'reps_weight',
  unilateral: false,
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

function toInputValue(value?: number) {
  return typeof value === 'number' ? String(value) : '';
}

function parseOptionalNumber(value: string) {
  if (!value.trim()) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function createSetLogDraft(log: WorkoutSetLog): SetLogDraft {
  return {
    reps: toInputValue(log.reps),
    seconds: toInputValue(log.seconds),
    weight: toInputValue(log.weight),
  };
}

function supportsReps(trackingMode: TrackingMode) {
  return trackingMode === 'reps_weight';
}

function supportsSeconds(trackingMode: TrackingMode) {
  return trackingMode === 'time' || trackingMode === 'time_weight';
}

function supportsWeight(trackingMode: TrackingMode) {
  return trackingMode === 'reps_weight' || trackingMode === 'time_weight';
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

interface SetLogEditorProps {
  log: WorkoutSetLog;
  trackingMode: TrackingMode;
  restSeconds?: number;
  onCompleted: () => void;
}

function SetLogEditor({ log, trackingMode, restSeconds, onCompleted }: SetLogEditorProps) {
  const [draft, setDraft] = useState<SetLogDraft>(() => createSetLogDraft(log));
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setDraft({
      reps: toInputValue(log.reps),
      seconds: toInputValue(log.seconds),
      weight: toInputValue(log.weight),
    });
  }, [log.completed, log.id, log.reps, log.seconds, log.weight]);

  const dirty =
    draft.reps !== toInputValue(log.reps) ||
    draft.seconds !== toInputValue(log.seconds) ||
    draft.weight !== toInputValue(log.weight);

  async function handleSave() {
    setIsSaving(true);

    try {
      await updateSetLogValues(log.id, {
        reps: supportsReps(trackingMode) ? parseOptionalNumber(draft.reps) : undefined,
        seconds: supportsSeconds(trackingMode) ? parseOptionalNumber(draft.seconds) : undefined,
        weight: supportsWeight(trackingMode) ? parseOptionalNumber(draft.weight) : undefined,
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleToggleCompletion() {
    if (dirty) {
      await handleSave();
    }

    await toggleSetCompletion(log.id);

    if (!log.completed && restSeconds) {
      onCompleted();
    }
  }

  const fieldCount = Number(supportsReps(trackingMode)) + Number(supportsSeconds(trackingMode)) + Number(supportsWeight(trackingMode));

  return (
    <div
      className={cn(
        'rounded-3xl border px-4 py-4 transition',
        log.completed ? 'border-lime-300/20 bg-lime-300/10' : 'border-white/10 bg-zinc-950/40',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-zinc-100">
            {log.setKind === 'warmup' ? 'Warmup' : `Satz ${log.setNumber}`}
            {log.side !== 'both' ? ` · ${formatSideLabel(log.side)}` : ''}
          </p>
          <p className="mt-1 text-sm text-zinc-400">{formatLoadLabel(log)}</p>
        </div>
        <button
          type="button"
          onClick={handleToggleCompletion}
          className={cn(
            'flex h-10 min-w-10 items-center justify-center rounded-2xl px-3 text-sm font-medium transition',
            log.completed
              ? 'bg-lime-300 text-zinc-950'
              : 'bg-white/5 text-zinc-300 hover:bg-white/10',
          )}
        >
          {log.completed ? <Check size={16} /> : 'Fertig'}
        </button>
      </div>

      <div className={cn('mt-4 grid gap-3', fieldCount === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
        {supportsReps(trackingMode) ? (
          <input
            value={draft.reps}
            onChange={(event) => setDraft((current) => ({ ...current, reps: event.target.value }))}
            inputMode="numeric"
            placeholder="Wdh"
            className="rounded-3xl border border-white/10 bg-zinc-950/50 px-4 py-4 text-sm text-zinc-50 outline-none transition placeholder:text-zinc-500 focus:border-lime-300/40"
          />
        ) : null}

        {supportsSeconds(trackingMode) ? (
          <input
            value={draft.seconds}
            onChange={(event) => setDraft((current) => ({ ...current, seconds: event.target.value }))}
            inputMode="decimal"
            placeholder="Sekunden"
            className="rounded-3xl border border-white/10 bg-zinc-950/50 px-4 py-4 text-sm text-zinc-50 outline-none transition placeholder:text-zinc-500 focus:border-lime-300/40"
          />
        ) : null}

        {supportsWeight(trackingMode) ? (
          <input
            value={draft.weight}
            onChange={(event) => setDraft((current) => ({ ...current, weight: event.target.value }))}
            inputMode="decimal"
            placeholder="Gewicht in kg"
            className="rounded-3xl border border-white/10 bg-zinc-950/50 px-4 py-4 text-sm text-zinc-50 outline-none transition placeholder:text-zinc-500 focus:border-lime-300/40"
          />
        ) : null}
      </div>

      {dirty ? (
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-3xl bg-white/5 px-4 py-4 text-sm font-medium text-zinc-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save size={15} />
          Werte speichern
        </button>
      ) : null}
    </div>
  );
}

export function SessionPage() {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const { activeSessionExerciseId, setActiveSessionExerciseId, restTimerEndsAt, startRestTimer, clearRestTimer } =
    useUiStore();
  const [now, setNow] = useState(Date.now());
  const [showAddExerciseForm, setShowAddExerciseForm] = useState(false);
  const [isSavingExercise, setIsSavingExercise] = useState(false);
  const [exerciseForm, setExerciseForm] = useState<SessionExerciseFormState>(
    defaultSessionExerciseFormState,
  );

  const session = useLiveQuery(() => db.workoutSessions.get(sessionId), [sessionId]);
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
    const currentExercises = await db.workoutSessionExercises.where('sessionId').equals(sessionId).toArray();

    if (currentExercises.length === 0) {
      return {} as Record<string, string>;
    }

    const completedSessions = await db.workoutSessions.where('status').equals('completed').toArray();
    const completedSessionById = Object.fromEntries(completedSessions.map((item) => [item.id, item]));
    const exerciseIds = [...new Set(currentExercises.map((item) => item.exerciseId))];
    const historicExercises = await db.workoutSessionExercises.where('exerciseId').anyOf(exerciseIds).toArray();
    const latestByExerciseId = new Map<string, WorkoutSessionExercise>();

    for (const item of historicExercises) {
      if (item.sessionId === sessionId || !completedSessionById[item.sessionId]) {
        continue;
      }

      const existing = latestByExerciseId.get(item.exerciseId);

      if (!existing) {
        latestByExerciseId.set(item.exerciseId, item);
        continue;
      }

      const currentDate = completedSessionById[item.sessionId]?.completedAt ?? '';
      const existingDate = completedSessionById[existing.sessionId]?.completedAt ?? '';

      if (currentDate > existingDate) {
        latestByExerciseId.set(item.exerciseId, item);
      }
    }

    const logLookup: Record<string, string> = {};

    for (const [exerciseId, sessionExercise] of latestByExerciseId.entries()) {
      const historicLogs = await db.workoutSetLogs
        .where('sessionExerciseId')
        .equals(sessionExercise.id)
        .filter((item) => item.setKind === 'work' && item.completed)
        .toArray();

      logLookup[exerciseId] = historicLogs.slice(0, 2).map(formatLoadLabel).join(' | ') || 'Noch keine Werte';
    }

    return logLookup;
  }, [sessionId]);

  useEffect(() => {
    if (sessionExercises?.length && !activeSessionExerciseId) {
      setActiveSessionExerciseId(sessionExercises[0].id);
    }
  }, [activeSessionExerciseId, sessionExercises, setActiveSessionExerciseId]);

  useEffect(() => {
    if (!sessionExercises?.length) {
      return;
    }

    if (!sessionExercises.some((item) => item.id === activeSessionExerciseId)) {
      setActiveSessionExerciseId(sessionExercises[0].id);
    }
  }, [activeSessionExerciseId, sessionExercises, setActiveSessionExerciseId]);

  useEffect(() => {
    if (!restTimerEndsAt) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, [restTimerEndsAt]);

  useEffect(() => {
    if (restTimerEndsAt && restTimerEndsAt <= now) {
      clearRestTimer();
    }
  }, [clearRestTimer, now, restTimerEndsAt]);

  useEffect(() => {
    if (!availableExercises?.length) {
      return;
    }

    setExerciseForm((current) => {
      if (current.exerciseSource !== 'existing') {
        return current;
      }

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
  const focusedExercise =
    (sessionExercises ?? []).find((item) => item.id === activeSessionExerciseId) ?? sessionExercises?.[0];
  const remainingSeconds = restTimerEndsAt ? Math.max(0, Math.ceil((restTimerEndsAt - now) / 1000)) : 0;
  const selectedExistingExercise = (availableExercises ?? []).find(
    (exercise) => exercise.id === exerciseForm.exerciseId,
  );
  const effectiveTrackingMode =
    exerciseForm.exerciseSource === 'new'
      ? exerciseForm.trackingMode
      : selectedExistingExercise?.trackingMode ?? 'reps_weight';
  const effectiveUnilateral =
    exerciseForm.exerciseSource === 'new'
      ? exerciseForm.unilateral
      : selectedExistingExercise?.unilateral ?? false;

  async function handleAddExercise() {
    if (!session || session.status !== 'active') {
      return;
    }

    if (exerciseForm.exerciseSource === 'existing' && !exerciseForm.exerciseId) {
      return;
    }

    if (exerciseForm.exerciseSource === 'new' && !exerciseForm.exerciseName.trim()) {
      return;
    }

    setIsSavingExercise(true);

    try {
      const sessionExerciseId = await addSessionExercise({
        sessionId: session.id,
        workSetCount: Number(exerciseForm.workSetCount) || 1,
        targetReps: supportsReps(effectiveTrackingMode)
          ? parseOptionalNumber(exerciseForm.targetReps)
          : undefined,
        targetSeconds: supportsSeconds(effectiveTrackingMode)
          ? parseOptionalNumber(exerciseForm.targetSeconds)
          : undefined,
        targetWeight: supportsWeight(effectiveTrackingMode)
          ? parseOptionalNumber(exerciseForm.targetWeight)
          : undefined,
        restSeconds: parseOptionalNumber(exerciseForm.restSeconds),
        notes: exerciseForm.notes,
        exerciseId:
          exerciseForm.exerciseSource === 'existing' ? exerciseForm.exerciseId : undefined,
        exerciseName:
          exerciseForm.exerciseSource === 'new' ? exerciseForm.exerciseName : undefined,
        instructions:
          exerciseForm.exerciseSource === 'new' ? exerciseForm.instructions : undefined,
        tempo: exerciseForm.exerciseSource === 'new' ? exerciseForm.tempo : undefined,
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

  if (!session) {
    return (
      <AppShell title="Session" eyebrow="Execution">
        <SectionCard title="Session nicht gefunden">
          <p className="text-sm text-zinc-400">
            Entweder wurde sie noch nicht angelegt oder bereits geloescht.
          </p>
        </SectionCard>
      </AppShell>
    );
  }

  return (
    <AppShell title={session.templateNameSnapshot} eyebrow="Session">
      <div className="space-y-4">
        <SectionCard
            title={focusedExercise?.exerciseNameSnapshot ?? 'Session Uebersicht'}
          subtitle={`Gestartet ${formatDateTime(session.startedAt)} · Woche ${session.resolvedProgramWeek}`}
          action={
            remainingSeconds > 0 ? (
              <div className="rounded-2xl bg-amber-300/15 px-3 py-2 text-sm font-medium text-amber-200">
                <div className="flex items-center gap-2">
                  <Clock3 size={14} />
                  {formatTimer(remainingSeconds)}
                </div>
              </div>
            ) : undefined
          }
        >
            <div className="space-y-4">
              {focusedExercise ? (
              <div className="rounded-3xl bg-zinc-950/50 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Letzte Werte</p>
                <p className="mt-2 text-sm text-zinc-200">
                  {lastValues?.[focusedExercise.exerciseId] ?? 'Noch keine Historie vorhanden'}
                </p>
                <p className="mt-3 text-sm text-zinc-400">
                  Ziel: {focusedExercise.targetReps ? `${focusedExercise.targetReps} Wdh` : null}
                  {focusedExercise.targetReps && focusedExercise.targetSeconds ? ' · ' : null}
                  {focusedExercise.targetSeconds ? `${focusedExercise.targetSeconds}s` : null}
                  {focusedExercise.targetWeight ? ` · ${focusedExercise.targetWeight} kg` : ''}
                </p>
              </div>
              ) : (
                <div className="rounded-3xl bg-zinc-950/50 p-4 text-sm text-zinc-400">
                  Noch keine Uebung in dieser Session. Du kannst direkt eine hinzufuegen.
                </div>
              )}

              {session.status === 'active' ? (
                <div className="space-y-3">
                <button
                  type="button"
                    onClick={() => setShowAddExerciseForm((current) => !current)}
                    className="w-full rounded-3xl bg-white/5 px-4 py-4 text-sm font-medium text-zinc-200 transition hover:bg-white/10"
                >
                    {showAddExerciseForm ? 'Hinzufuegen schliessen' : 'Uebung hinzufuegen'}
                </button>

                  {showAddExerciseForm ? (
                    <div className="space-y-4 rounded-3xl border border-white/10 bg-zinc-950/40 p-4">
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            setExerciseForm((current) => ({
                              ...current,
                              exerciseSource: 'existing',
                              exerciseId:
                                current.exerciseId || availableExercises?.[0]?.id || '',
                            }))
                          }
                          className={cn(
                            'rounded-3xl px-4 py-3 text-sm font-medium transition',
                            exerciseForm.exerciseSource === 'existing'
                              ? 'bg-lime-300 text-zinc-950'
                              : 'bg-white/5 text-zinc-200 hover:bg-white/10',
                          )}
                        >
                          Bestehend
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setExerciseForm((current) => ({
                              ...current,
                              exerciseSource: 'new',
                            }))
                          }
                          className={cn(
                            'rounded-3xl px-4 py-3 text-sm font-medium transition',
                            exerciseForm.exerciseSource === 'new'
                              ? 'bg-lime-300 text-zinc-950'
                              : 'bg-white/5 text-zinc-200 hover:bg-white/10',
                          )}
                        >
                          Neu
                        </button>
                      </div>

                      {exerciseForm.exerciseSource === 'existing' ? (
                        <div className="space-y-3">
                          {(availableExercises?.length ?? 0) > 0 ? (
                            <>
                              <select
                                value={exerciseForm.exerciseId}
                                onChange={(event) =>
                                  setExerciseForm((current) => ({
                                    ...current,
                                    exerciseId: event.target.value,
                                  }))
                                }
                                className="w-full rounded-3xl border border-white/10 bg-zinc-950/50 px-4 py-4 text-sm text-zinc-50 outline-none transition focus:border-lime-300/40"
                              >
                                {(availableExercises ?? []).map((exercise) => (
                                  <option key={exercise.id} value={exercise.id}>
                                    {exercise.name}
                                  </option>
                                ))}
                              </select>

                              <p className="text-sm text-zinc-400">
                                Modus: {effectiveTrackingMode} ·{' '}
                                {effectiveUnilateral ? 'links/rechts getrennt' : 'beidseitig'}
                              </p>
                            </>
                          ) : (
                            <div className="rounded-3xl bg-white/5 px-4 py-4 text-sm text-zinc-400">
                              Noch keine gespeicherten Uebungen vorhanden. Lege die Uebung direkt
                              hier unter &quot;Neu&quot; an.
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <input
                            value={exerciseForm.exerciseName}
                            onChange={(event) =>
                              setExerciseForm((current) => ({
                                ...current,
                                exerciseName: event.target.value,
                              }))
                            }
                            placeholder="Neue Uebung"
                            className="w-full rounded-3xl border border-white/10 bg-zinc-950/50 px-4 py-4 text-sm text-zinc-50 outline-none transition placeholder:text-zinc-500 focus:border-lime-300/40"
                          />
                          <div className="grid grid-cols-2 gap-3">
                            <select
                              value={exerciseForm.trackingMode}
                              onChange={(event) =>
                                setExerciseForm((current) => ({
                                  ...current,
                                  trackingMode: event.target.value as TrackingMode,
                                }))
                              }
                              className="rounded-3xl border border-white/10 bg-zinc-950/50 px-4 py-4 text-sm text-zinc-50 outline-none transition focus:border-lime-300/40"
                            >
                              <option value="reps_weight">Wdh + Gewicht</option>
                              <option value="time">Zeit</option>
                              <option value="time_weight">Zeit + Gewicht</option>
                            </select>
                            <button
                              type="button"
                              onClick={() =>
                                setExerciseForm((current) => ({
                                  ...current,
                                  unilateral: !current.unilateral,
                                }))
                              }
                              className={cn(
                                'rounded-3xl px-4 py-4 text-sm font-medium transition',
                                exerciseForm.unilateral
                                  ? 'bg-lime-300 text-zinc-950'
                                  : 'bg-white/5 text-zinc-200 hover:bg-white/10',
                              )}
                            >
                              {exerciseForm.unilateral ? 'Unilateral' : 'Beidseitig'}
                            </button>
                          </div>
                          <input
                            value={exerciseForm.tempo}
                            onChange={(event) =>
                              setExerciseForm((current) => ({
                                ...current,
                                tempo: event.target.value,
                              }))
                            }
                            placeholder="Tempo, optional"
                            className="w-full rounded-3xl border border-white/10 bg-zinc-950/50 px-4 py-4 text-sm text-zinc-50 outline-none transition placeholder:text-zinc-500 focus:border-lime-300/40"
                          />
                          <textarea
                            value={exerciseForm.instructions}
                            onChange={(event) =>
                              setExerciseForm((current) => ({
                                ...current,
                                instructions: event.target.value,
                              }))
                            }
                            rows={3}
                            placeholder="Hinweise zur Ausfuehrung, optional"
                            className="w-full rounded-3xl border border-white/10 bg-zinc-950/50 px-4 py-4 text-sm text-zinc-50 outline-none transition placeholder:text-zinc-500 focus:border-lime-300/40"
                          />
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
                          placeholder="Arbeitssaetze"
                          className="rounded-3xl border border-white/10 bg-zinc-950/50 px-4 py-4 text-sm text-zinc-50 outline-none transition placeholder:text-zinc-500 focus:border-lime-300/40"
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
                          placeholder="Pause in s"
                          className="rounded-3xl border border-white/10 bg-zinc-950/50 px-4 py-4 text-sm text-zinc-50 outline-none transition placeholder:text-zinc-500 focus:border-lime-300/40"
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
                            placeholder="Ziel-Wdh"
                            className="rounded-3xl border border-white/10 bg-zinc-950/50 px-4 py-4 text-sm text-zinc-50 outline-none transition placeholder:text-zinc-500 focus:border-lime-300/40"
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
                            placeholder="Ziel-Sekunden"
                            className="rounded-3xl border border-white/10 bg-zinc-950/50 px-4 py-4 text-sm text-zinc-50 outline-none transition placeholder:text-zinc-500 focus:border-lime-300/40"
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
                            placeholder="Ziel-Gewicht"
                            className="rounded-3xl border border-white/10 bg-zinc-950/50 px-4 py-4 text-sm text-zinc-50 outline-none transition placeholder:text-zinc-500 focus:border-lime-300/40"
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
                        placeholder="Notizen fuer diese Session-Uebung, optional"
                        className="w-full rounded-3xl border border-white/10 bg-zinc-950/50 px-4 py-4 text-sm text-zinc-50 outline-none transition placeholder:text-zinc-500 focus:border-lime-300/40"
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
                          className="rounded-3xl bg-white/5 px-4 py-4 text-sm font-medium text-zinc-200 transition hover:bg-white/10"
                        >
                          Abbrechen
                        </button>
                        <button
                          type="button"
                          onClick={handleAddExercise}
                          disabled={
                            isSavingExercise ||
                            (exerciseForm.exerciseSource === 'existing' &&
                              !exerciseForm.exerciseId &&
                              (availableExercises?.length ?? 0) === 0) ||
                            (exerciseForm.exerciseSource === 'new' &&
                              !exerciseForm.exerciseName.trim())
                          }
                          className="rounded-3xl bg-lime-300 px-4 py-4 text-sm font-semibold text-zinc-950 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isSavingExercise ? 'Speichert...' : 'Zur Session hinzufuegen'}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-3">
                {focusedExercise ? (
                  <button
                    type="button"
                    onClick={() => toggleSkipSessionExercise(focusedExercise.id)}
                    className={cn(
                      'rounded-3xl px-4 py-4 text-sm font-medium transition',
                      focusedExercise.wasSkipped
                        ? 'bg-rose-400/15 text-rose-200'
                        : 'bg-white/5 text-zinc-200 hover:bg-white/10',
                    )}
                  >
                    {focusedExercise.wasSkipped ? 'Uebung wieder aktivieren' : 'Uebung ueberspringen'}
                  </button>
                ) : (
                  <div className="rounded-3xl bg-white/5 px-4 py-4 text-sm text-zinc-400">
                    Noch keine aktive Uebung im Fokus.
                  </div>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    await completeSession(session.id);
                    navigate('/');
                  }}
                  className="rounded-3xl bg-lime-300 px-4 py-4 text-sm font-semibold text-zinc-950 transition hover:brightness-105"
                >
                  Session abschliessen
                </button>
              </div>
            </div>
        </SectionCard>

        {(sessionExercises ?? []).map((exercise) => {
          const exerciseLogs = (groupedLogs[exercise.id] ?? []).sort((left, right) => {
            if (left.setNumber === right.setNumber) {
              return left.side.localeCompare(right.side);
            }

            return left.setNumber - right.setNumber;
          });

          return (
            <SectionCard
              key={exercise.id}
              title={exercise.exerciseNameSnapshot}
                subtitle={
                  exercise.wasSkipped
                    ? 'Aktuell uebersprungen'
                    : exercise.addedInSession
                      ? 'Waehrend der Session hinzugefuegt'
                      : 'Teil der laufenden Session'
                }
              className={cn(
                activeSessionExerciseId === exercise.id && 'border-lime-300/40 bg-lime-300/[0.06]',
              )}
              action={
                <button
                  type="button"
                  onClick={() => setActiveSessionExerciseId(exercise.id)}
                  className="rounded-2xl border border-white/10 px-3 py-2 text-sm text-zinc-300 transition hover:bg-white/5"
                >
                  Fokus
                </button>
              }
            >
              <div className="mb-4 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => moveSessionExercise(exercise.id, -1)}
                  className="rounded-2xl border border-white/10 p-2 text-zinc-300 transition hover:bg-white/5"
                >
                  <ArrowUp size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => moveSessionExercise(exercise.id, 1)}
                  className="rounded-2xl border border-white/10 p-2 text-zinc-300 transition hover:bg-white/5"
                >
                  <ArrowDown size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => toggleSkipSessionExercise(exercise.id)}
                  className="rounded-2xl border border-white/10 px-3 py-2 text-sm text-zinc-300 transition hover:bg-white/5"
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
                    restSeconds={exercise.restSeconds}
                    onCompleted={() => {
                      if (exercise.restSeconds) {
                        startRestTimer(exercise.restSeconds);
                      }
                    }}
                  />
                ))}
              </div>
            </SectionCard>
          );
        })}
      </div>
    </AppShell>
  );
}
