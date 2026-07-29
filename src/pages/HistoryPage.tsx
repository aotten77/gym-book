import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { Empty } from '@/components/Empty';
import { SectionCard } from '@/components/SectionCard';
import { db } from '@/db/appDb';
import type { WorkoutSession, WorkoutSessionExercise, WorkoutSetLog } from '@/domain/models';
import { formatDateTime, formatLoadLabel, formatSessionWeekContext } from '@/lib/format';

interface HistoryEntry {
  sessionId: string;
  templateName: string;
  weekContext: string;
  exerciseName: string;
  completedAt?: string;
  preview: string[];
}

function buildExerciseHistory(
  sessionsById: Record<string, WorkoutSession | undefined>,
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
    const session = sessionsById[item.sessionId];
    const weekContext = session ? formatSessionWeekContext(session) : 'Woche ?';
    const preview = (logsBySessionExerciseId[item.id] ?? [])
      .filter((log) => log.setKind === 'work' && log.completed)
      .slice(0, 3)
      .map(formatLoadLabel);

    if (!groups[item.exerciseId]) {
      groups[item.exerciseId] = [];
    }

    groups[item.exerciseId].push({
      sessionId: item.sessionId,
      templateName: session?.templateNameSnapshot ?? item.exerciseNameSnapshot,
      weekContext,
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
    const sessionsById = Object.fromEntries((completedSessions ?? []).map((item) => [item.id, item]));

    return buildExerciseHistory(
      sessionsById,
      completedSessionExercises ?? [],
      completedSetLogs ?? [],
      completedAtBySessionId,
    );
  }, [completedSessionExercises, completedSessions, completedSetLogs]);

  return (
    <AppShell title="Historie" eyebrow="Rückblick">
      <div className="space-y-4">
        {Object.keys(historyByExercise).length > 0 ? (
          Object.entries(historyByExercise).map(([exerciseId, entries]) => (
            <SectionCard
              key={exerciseId}
              title={entries[0]?.exerciseName ?? 'Übung'}
              subtitle={`${entries.length} abgeschlossene Einheiten`}
            >
              <div className="space-y-3">
                {entries.map((entry) => (
                  <Link
                    key={`${exerciseId}-${entry.sessionId}`}
                    to={`/history/session/${entry.sessionId}`}
                    className="block rounded-panel bg-surface p-4 transition hover:bg-surface-sunken"
                  >
                    <p className="text-sm font-semibold text-content">
                      {formatDateTime(entry.completedAt)} · {entry.templateName}
                    </p>
                    <p className="mt-1 text-sm text-content-muted">{entry.weekContext}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {entry.preview.length > 0 ? (
                        entry.preview.map((value) => (
                          <span
                            key={`${exerciseId}-${entry.completedAt}-${value}`}
                            className="rounded-full bg-surface-raised px-3 py-1 text-xs text-content-secondary"
                          >
                            {value}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-content-muted">Noch keine abgeschlossenen Arbeitssätze.</span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </SectionCard>
          ))
        ) : (
          <Empty
            title="Noch keine Historie"
            description="Schließe deine erste Session ab, damit hier stabile Verlaufsdaten pro Übung auftauchen."
          />
        )}

        <SectionCard
          title="Was schon steht"
          subtitle="Historie liest bereits aus den persistierten Session-Snapshots."
        >
          <p className="text-sm text-content-muted">
            Als nächstes können wir hier sparklines oder echte Verlaufsdiagramme pro Übung andocken, ohne die
            Datenbasis nochmal umzuwerfen.
          </p>
        </SectionCard>
      </div>
    </AppShell>
  );
}
