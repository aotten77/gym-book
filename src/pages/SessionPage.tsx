import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDown, ArrowUp, Check, Clock3, SkipForward } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { SectionCard } from '@/components/SectionCard';
import { db } from '@/db/appDb';
import {
  completeSession,
  moveSessionExercise,
  toggleSetCompletion,
  toggleSkipSessionExercise,
} from '@/db/session-actions';
import type { WorkoutSessionExercise, WorkoutSetLog } from '@/domain/models';
import { formatDateTime, formatLoadLabel, formatTimer } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/store/ui-store';

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
  const { activeSessionExerciseId, setActiveSessionExerciseId, restTimerEndsAt, startRestTimer, clearRestTimer } =
    useUiStore();
  const [now, setNow] = useState(Date.now());

  const session = useLiveQuery(() => db.workoutSessions.get(sessionId), [sessionId]);
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
      const logs = await db.workoutSetLogs
        .where('sessionExerciseId')
        .equals(sessionExercise.id)
        .filter((item) => item.setKind === 'work' && item.completed)
        .toArray();

      logLookup[exerciseId] = logs.slice(0, 2).map(formatLoadLabel).join(' | ') || 'Noch keine Werte';
    }

    return logLookup;
  }, [sessionId]);

  useEffect(() => {
    if (sessionExercises?.length && !activeSessionExerciseId) {
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

  const groupedLogs = useMemo(() => groupLogsByExercise(setLogs ?? []), [setLogs]);
  const focusedExercise =
    (sessionExercises ?? []).find((item) => item.id === activeSessionExerciseId) ?? sessionExercises?.[0];
  const remainingSeconds = restTimerEndsAt ? Math.max(0, Math.ceil((restTimerEndsAt - now) / 1000)) : 0;

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
          title={focusedExercise?.exerciseNameSnapshot ?? 'Lade Session'}
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
          {focusedExercise ? (
            <div className="space-y-4">
              <div className="rounded-3xl bg-zinc-950/50 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Letzte Werte</p>
                <p className="mt-2 text-sm text-zinc-200">
                  {lastValues?.[focusedExercise.exerciseId] ?? 'Noch keine Historie vorhanden'}
                </p>
                <p className="mt-3 text-sm text-zinc-400">
                  Ziel:{' '}
                  {focusedExercise.targetReps ? `${focusedExercise.targetReps} Wdh` : null}
                  {focusedExercise.targetReps && focusedExercise.targetSeconds ? ' · ' : null}
                  {focusedExercise.targetSeconds ? `${focusedExercise.targetSeconds}s` : null}
                  {focusedExercise.targetWeight ? ` · ${focusedExercise.targetWeight} kg` : ''}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
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
          ) : null}
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
              subtitle={exercise.wasSkipped ? 'Aktuell uebersprungen' : 'Teil der laufenden Session'}
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
                  <button
                    key={log.id}
                    type="button"
                    onClick={async () => {
                      await toggleSetCompletion(log.id);

                      if (!log.completed && exercise.restSeconds) {
                        startRestTimer(exercise.restSeconds);
                      }
                    }}
                    className={cn(
                      'flex w-full items-center justify-between rounded-3xl border px-4 py-4 text-left transition',
                      log.completed
                        ? 'border-lime-300/20 bg-lime-300/10'
                        : 'border-white/10 bg-zinc-950/40 hover:bg-zinc-950/60',
                    )}
                  >
                    <div>
                      <p className="text-sm font-semibold text-zinc-100">
                        {log.setKind === 'warmup' ? 'Warmup' : `Satz ${log.setNumber}`}
                        {log.side !== 'both' ? ` · ${log.side}` : ''}
                      </p>
                      <p className="mt-1 text-sm text-zinc-400">{formatLoadLabel(log)}</p>
                    </div>
                    <div
                      className={cn(
                        'flex h-10 w-10 items-center justify-center rounded-2xl',
                        log.completed ? 'bg-lime-300 text-zinc-950' : 'bg-white/5 text-zinc-500',
                      )}
                    >
                      <Check size={16} />
                    </div>
                  </button>
                ))}
              </div>
            </SectionCard>
          );
        })}
      </div>
    </AppShell>
  );
}
