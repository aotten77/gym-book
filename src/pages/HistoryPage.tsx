import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AppShell } from '@/components/AppShell';
import { SectionCard } from '@/components/SectionCard';
import { db } from '@/db/appDb';
import type { WorkoutSessionExercise, WorkoutSetLog } from '@/domain/models';
import { formatDateTime, formatLoadLabel } from '@/lib/format';

interface HistoryEntry {
  exerciseName: string;
  completedAt?: string;
  preview: string[];
}

function buildExerciseHistory(
  sessionExercises: WorkoutSessionExercise[],
  setLogs: WorkoutSetLog[],
  completedAtBySessionId: Record<string, string | undefined>,
) {
  const logsBySessionExerciseId = setLogs.reduce<Record<string, WorkoutSetLog[]>>((groups, item) => {
    if (!groups[item.sessionExerciseId]) {
      groups[item.sessionExerciseId] = [];
    }

    groups[item.sessionExerciseId].push(item);
    return groups;
  }, {});

  return sessionExercises.reduce<Record<string, HistoryEntry[]>>((groups, item) => {
    const preview = (logsBySessionExerciseId[item.id] ?? [])
      .filter((log) => log.setKind === 'work' && log.completed)
      .slice(0, 3)
      .map(formatLoadLabel);

    if (!groups[item.exerciseId]) {
      groups[item.exerciseId] = [];
    }

    groups[item.exerciseId].push({
      exerciseName: item.exerciseNameSnapshot,
      completedAt: completedAtBySessionId[item.sessionId],
      preview,
    });

    groups[item.exerciseId].sort((left, right) => (right.completedAt ?? '').localeCompare(left.completedAt ?? ''));

    return groups;
  }, {});
}

export function HistoryPage() {
  const completedSessions = useLiveQuery(() => db.workoutSessions.where('status').equals('completed').toArray(), []);
  const completedSessionExercises = useLiveQuery(async () => {
    const sessions = await db.workoutSessions.where('status').equals('completed').toArray();

    if (sessions.length === 0) {
      return [];
    }

    return db.workoutSessionExercises.where('sessionId').anyOf(sessions.map((item) => item.id)).toArray();
  }, []);
  const completedSetLogs = useLiveQuery(async () => {
    const sessionExercises = await db.workoutSessionExercises.toArray();

    if (sessionExercises.length === 0) {
      return [];
    }

    return db.workoutSetLogs.where('sessionExerciseId').anyOf(sessionExercises.map((item) => item.id)).toArray();
  }, []);

  const historyByExercise = useMemo(() => {
    const completedAtBySessionId = Object.fromEntries(
      (completedSessions ?? []).map((item) => [item.id, item.completedAt]),
    );

    return buildExerciseHistory(
      completedSessionExercises ?? [],
      completedSetLogs ?? [],
      completedAtBySessionId,
    );
  }, [completedSessionExercises, completedSessions, completedSetLogs]);

  return (
    <AppShell title="Historie" eyebrow="Rueckblick">
      <div className="space-y-4">
        {Object.entries(historyByExercise).map(([exerciseId, entries]) => (
          <SectionCard
            key={exerciseId}
            title={entries[0]?.exerciseName ?? 'Uebung'}
            subtitle={`${entries.length} abgeschlossene Einheiten`}
          >
            <div className="space-y-3">
              {entries.map((entry) => (
                <div key={`${exerciseId}-${entry.completedAt}`} className="rounded-3xl bg-zinc-950/45 p-4">
                  <p className="text-sm font-semibold text-zinc-50">{formatDateTime(entry.completedAt)}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {entry.preview.length > 0 ? (
                      entry.preview.map((value) => (
                        <span
                          key={`${exerciseId}-${entry.completedAt}-${value}`}
                          className="rounded-full bg-white/5 px-3 py-1 text-xs text-zinc-300"
                        >
                          {value}
                        </span>
                      ))
                    ) : (
                      <span className="text-sm text-zinc-400">Noch keine abgeschlossenen Arbeitssaetze.</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        ))}

        <SectionCard
          title="Was schon steht"
          subtitle="Historie liest bereits aus den persistierten Session-Snapshots."
        >
          <p className="text-sm text-zinc-400">
            Als naechstes koennen wir hier sparklines oder echte Verlaufsdiagramme pro Uebung andocken, ohne die
            Datenbasis nochmal umzuwerfen.
          </p>
        </SectionCard>
      </div>
    </AppShell>
  );
}
