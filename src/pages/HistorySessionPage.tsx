import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { ExerciseMedia } from '@/components/ExerciseMedia';
import { SectionCard } from '@/components/SectionCard';
import { SupersetBlock } from '@/components/SupersetBlock';
import { db } from '@/db/appDb';
import { sortSetLogs } from '@/domain/history';
import type { WorkoutSessionExercise, WorkoutSetLog } from '@/domain/models';
import { buildSupersetBlocks } from '@/domain/superset';
import { formatDateTime, formatLoadLabel, formatSessionWeekContext } from '@/lib/format';

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
      <AppShell title="Session" eyebrow="Verlauf">
        <SectionCard
          title="Session nicht gefunden"
          action={
            <Link
              to="/history"
              className="min-h-touch inline-flex items-center justify-center flex items-center gap-2 rounded-control border border-line px-3 py-2 text-sm text-content-secondary transition hover:bg-surface-raised"
            >
              <ArrowLeft size={16} />
              Zurück
            </Link>
          }
        >
          <p className="text-sm text-content-muted">Die Session existiert nicht mehr oder wurde noch nicht exportiert.</p>
        </SectionCard>
      </AppShell>
    );
  }

  const weekContext = formatSessionWeekContext(session);

  return (
    <AppShell title={session.templateNameSnapshot} eyebrow="Verlauf">
      <div className="space-y-4">
        <SectionCard
          title="Session-Snapshot"
          subtitle={`${formatDateTime(session.completedAt ?? session.startedAt)} · ${weekContext}`}
          action={
            <Link
              to="/history"
              className="min-h-touch inline-flex items-center justify-center flex items-center gap-2 rounded-control border border-line px-3 py-2 text-sm text-content-secondary transition hover:bg-surface-raised"
            >
              <ArrowLeft size={16} />
              Zurück
            </Link>
          }
        >
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-panel bg-surface p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-content-muted">Gestartet</p>
              <p className="mt-2 font-semibold text-content">{formatDateTime(session.startedAt)}</p>
            </div>
            <div className="rounded-panel bg-surface p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-content-muted">Status</p>
              <p className="mt-2 font-semibold text-content">
                {session.status === 'completed' ? 'Abgeschlossen' : session.status === 'active' ? 'Aktiv' : 'Abgebrochen'}
              </p>
            </div>
          </div>
        </SectionCard>

        {/*
          Die Gruppierung kommt aus dem Snapshot der Session, nicht aus dem
          Template: ein Training soll später so aussehen, wie es ausgeführt
          wurde - auch wenn der Plan sich seither geändert hat.
        */}
        {buildSupersetBlocks(sessionExercises ?? []).map((block) =>
          block.kind === 'single' ? (
            renderExercise(block.exercise)
          ) : (
            <SupersetBlock
              key={block.groupId}
              exerciseNames={block.exercises.map((exercise) => exercise.exerciseNameSnapshot)}
            >
              {block.exercises.map((exercise) => renderExercise(exercise))}
            </SupersetBlock>
          ),
        )}
      </div>
    </AppShell>
  );

  function renderExercise(exercise: WorkoutSessionExercise) {
    const exerciseRecord = exerciseById[exercise.exerciseId];
    const mediaAsset = exerciseRecord?.mediaAssetId
      ? mediaAssetById[exerciseRecord.mediaAssetId]
      : undefined;
    const logs = sortSetLogs(logsBySessionExerciseId[exercise.id] ?? []);

    const targetParts = [
      typeof exercise.targetReps === 'number' ? `${exercise.targetReps} Wdh` : null,
      typeof exercise.targetSeconds === 'number' ? `${exercise.targetSeconds}s` : null,
      typeof exercise.targetWeight === 'number' ? `${exercise.targetWeight} kg` : null,
      exercise.targetBandNameSnapshot ?? null,
    ].filter(Boolean);

    return (
      <SectionCard
        key={exercise.id}
        title={`${exercise.orderIndex}. ${exercise.exerciseNameSnapshot}`}
        subtitle={[
          exercise.wasSkipped ? 'Skipped' : null,
          exercise.addedInSession ? 'In Session hinzugefügt' : null,
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
              <div key={log.id} className="rounded-panel border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-content">{formatSetLabel(log)}</p>
                    <p className="mt-1 text-sm text-content-muted">{formatLoadLabel(log)}</p>
                  </div>
                  <span
                    className={`rounded-control px-3 py-2 text-xs font-medium ${
                      log.completed
                        ? 'bg-accent-soft text-accent'
                        : 'bg-surface-raised text-content-secondary'
                    }`}
                  >
                    {log.completed ? 'Fertig' : 'Offen'}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-panel border border-dashed border-line bg-surface px-4 py-5 text-sm text-content-muted">
              Keine Set-Logs vorhanden.
            </div>
          )}
        </div>
      </SectionCard>
    );
  }
}
