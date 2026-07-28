import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { ExerciseMedia } from '@/components/ExerciseMedia';
import { SectionCard } from '@/components/SectionCard';
import { db } from '@/db/appDb';
import type { WorkoutSetLog, WorkoutSession } from '@/domain/models';
import { formatDateTime, formatLoadLabel } from '@/lib/format';

function formatSessionWeekContext(session: WorkoutSession) {
  const parts = [
    `Woche ${session.resolvedProgramWeek}`,
    session.programWeekLabelSnapshot,
    session.programNameSnapshot,
    session.usedWeekOverride ? 'Override' : 'Programm',
  ].filter(Boolean);

  return parts.join(' · ');
}

function formatSetLabel(setLog: WorkoutSetLog) {
  if (setLog.setKind === 'warmup') {
    return 'Warmup';
  }

  const sideLabel = setLog.side === 'left' ? 'links' : setLog.side === 'right' ? 'rechts' : '';
  return `Satz ${setLog.setNumber}${sideLabel ? ` · ${sideLabel}` : ''}`;
}

export function HistorySessionPage() {
  const { sessionId = '' } = useParams();
  const session = useLiveQuery(() => db.workoutSessions.get(sessionId), [sessionId]);
  const sessionExercises = useLiveQuery(
    () => db.workoutSessionExercises.where('sessionId').equals(sessionId).sortBy('orderIndex'),
    [sessionId],
  );
  const exercises = useLiveQuery(() => db.exercises.toArray(), []);
  const mediaAssets = useLiveQuery(() => db.mediaAssets.toArray(), []);
  const setLogs = useLiveQuery(async () => {
    const exercises = await db.workoutSessionExercises.where('sessionId').equals(sessionId).toArray();

    if (exercises.length === 0) {
      return [];
    }

    return db.workoutSetLogs.where('sessionExerciseId').anyOf(exercises.map((item) => item.id)).toArray();
  }, [sessionId]);

  const logsBySessionExerciseId = useMemo(() => {
    return (setLogs ?? []).reduce<Record<string, WorkoutSetLog[]>>((groups, log) => {
      const bucket = groups[log.sessionExerciseId] ?? [];
      bucket.push(log);
      groups[log.sessionExerciseId] = bucket;
      return groups;
    }, {});
  }, [setLogs]);
  const exerciseById = Object.fromEntries((exercises ?? []).map((exercise) => [exercise.id, exercise]));
  const mediaAssetById = Object.fromEntries((mediaAssets ?? []).map((asset) => [asset.id, asset]));

  if (!session) {
    return (
      <AppShell title="Session" eyebrow="Historie">
        <SectionCard
          title="Session nicht gefunden"
          action={
            <Link
              to="/history"
              className="flex items-center gap-2 rounded-2xl border border-white/10 px-3 py-2 text-sm text-zinc-300 transition hover:bg-white/5"
            >
              <ArrowLeft size={16} />
              Zurueck
            </Link>
          }
        >
          <p className="text-sm text-zinc-400">Die Session existiert nicht mehr oder wurde noch nicht exportiert.</p>
        </SectionCard>
      </AppShell>
    );
  }

  const weekContext = formatSessionWeekContext(session);

  return (
    <AppShell title={session.templateNameSnapshot} eyebrow="Historie">
      <div className="space-y-4">
        <SectionCard
          title="Session-Snapshot"
          subtitle={`${formatDateTime(session.completedAt ?? session.startedAt)} · ${weekContext}`}
          action={
            <Link
              to="/history"
              className="flex items-center gap-2 rounded-2xl border border-white/10 px-3 py-2 text-sm text-zinc-300 transition hover:bg-white/5"
            >
              <ArrowLeft size={16} />
              Zurueck
            </Link>
          }
        >
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-3xl bg-zinc-950/45 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Gestartet</p>
              <p className="mt-2 font-semibold text-zinc-50">{formatDateTime(session.startedAt)}</p>
            </div>
            <div className="rounded-3xl bg-zinc-950/45 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Status</p>
              <p className="mt-2 font-semibold text-zinc-50">
                {session.status === 'completed' ? 'Abgeschlossen' : session.status === 'active' ? 'Aktiv' : 'Abgebrochen'}
              </p>
            </div>
          </div>
        </SectionCard>

        {(sessionExercises ?? []).map((exercise) => {
          const exerciseRecord = exerciseById[exercise.exerciseId];
          const mediaAsset =
            exerciseRecord?.mediaAssetId ? mediaAssetById[exerciseRecord.mediaAssetId] : undefined;
          const logs = [...(logsBySessionExerciseId[exercise.id] ?? [])].sort((left, right) => {
            if (left.setKind !== right.setKind) {
              return left.setKind === 'warmup' ? -1 : 1;
            }

            if (left.setNumber !== right.setNumber) {
              return left.setNumber - right.setNumber;
            }

            const sideOrder = { both: 0, left: 1, right: 2 } as const;
            return sideOrder[left.side] - sideOrder[right.side];
          });

          const targetParts = [
            typeof exercise.targetReps === 'number' ? `${exercise.targetReps} Wdh` : null,
            typeof exercise.targetSeconds === 'number' ? `${exercise.targetSeconds}s` : null,
            typeof exercise.targetWeight === 'number' ? `${exercise.targetWeight} kg` : null,
          ].filter(Boolean);

          return (
            <SectionCard
              key={exercise.id}
              title={`${exercise.orderIndex}. ${exercise.exerciseNameSnapshot}`}
              subtitle={[
                exercise.wasSkipped ? 'Skipped' : null,
                exercise.addedInSession ? 'In Session hinzugefuegt' : null,
                targetParts.length > 0 ? `Ziel: ${targetParts.join(' · ')}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            >
              <div className="space-y-3">
                <ExerciseMedia
                  mediaAsset={mediaAsset}
                  alt={exercise.exerciseNameSnapshot}
                  className="h-40 w-full"
                  imageClassName="h-full w-full"
                />
                {logs.length > 0 ? (
                  logs.map((log) => (
                    <div
                      key={log.id}
                      className="rounded-3xl border border-white/10 bg-zinc-950/45 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-zinc-50">{formatSetLabel(log)}</p>
                          <p className="mt-1 text-sm text-zinc-400">{formatLoadLabel(log)}</p>
                        </div>
                        <span
                          className={`rounded-2xl px-3 py-2 text-xs font-medium ${
                            log.completed ? 'bg-lime-300/10 text-lime-200' : 'bg-white/5 text-zinc-300'
                          }`}
                        >
                          {log.completed ? 'Fertig' : 'Offen'}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-3xl border border-dashed border-white/10 bg-zinc-950/35 px-4 py-5 text-sm text-zinc-400">
                    Keine Set-Logs vorhanden.
                  </div>
                )}
              </div>
            </SectionCard>
          );
        })}
      </div>
    </AppShell>
  );
}
