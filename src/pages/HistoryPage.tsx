import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { Empty } from '@/components/Empty';
import { SectionCard } from '@/components/SectionCard';
import { DoneCard } from '@/components/ui/StatusCard';
import { db } from '@/db/appDb';
import type { WorkoutSession, WorkoutSessionExercise, WorkoutSetLog } from '@/domain/models';
import { sumWorkVolume } from '@/domain/volume';
import { formatDateTime, formatLoadLabel, formatNumber, formatSessionWeekContext } from '@/lib/format';

const RECENT_VOLUME_DAYS = 30;

interface HistoryEntry {
  sessionId: string;
  templateName: string;
  weekContext: string;
  exerciseName: string;
  completedAt?: string;
  preview: string[];
  /** Arbeitsvolumen dieser Ausführung - Grundlage des Balkens. */
  volume: number;
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
    const workLogs = (logsBySessionExerciseId[item.id] ?? []).filter(
      (log) => log.setKind === 'work' && log.completed,
    );
    const preview = workLogs.slice(0, 3).map(formatLoadLabel);

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
      // Dieselben Sätze, die schon geladen sind - der Balken kostet keine
      // zusätzliche Abfrage.
      volume: sumWorkVolume(workLogs),
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

  /*
   * Volumen der letzten 30 Tage, aus den ohnehin geladenen Sätzen. Bewusst
   * kein Rückgriff auf `loadWeekSummary`: das ist die Kalenderwoche, hier
   * geht es um einen gleitenden Zeitraum, und derselbe Name für zwei
   * Zeiträume wäre die nächste Verwechslung.
   */
  const recentVolume = useMemo(() => {
    const cutoff = new Date(Date.now() - RECENT_VOLUME_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const recentSessionIds = new Set(
      (completedSessions ?? [])
        .filter((session) => (session.completedAt ?? '') >= cutoff)
        .map((session) => session.id),
    );
    const recentExerciseIds = new Set(
      (completedSessionExercises ?? [])
        .filter((item) => recentSessionIds.has(item.sessionId))
        .map((item) => item.id),
    );

    return sumWorkVolume(
      (completedSetLogs ?? []).filter(
        (log) =>
          log.setKind === 'work' && log.completed && recentExerciseIds.has(log.sessionExerciseId),
      ),
    );
  }, [completedSessionExercises, completedSessions, completedSetLogs]);

  const sessionCount = completedSessions?.length ?? 0;

  return (
    <AppShell title="Verlauf">
      <div className="space-y-4">
        {/*
          Kein Limettenfeld auf dieser Seite, und das ist die Probe aufs
          Exempel: im Verlauf ist nichts "jetzt dran". Getragen wird sie von
          Waldgrün - jeder Eintrag hier *ist* erledigt, und das darf sich
          wiederholen.
        */}
        {sessionCount > 0 ? (
          <DoneCard
            eyebrow="Abgeschlossen"
            title={sessionCount === 1 ? '1 Einheit' : `${sessionCount} Einheiten`}
            subtitle={`${formatNumber(Math.round(recentVolume))} kg Volumen in den letzten ${RECENT_VOLUME_DAYS} Tagen`}
          />
        ) : null}

        {Object.keys(historyByExercise).length > 0 ? (
          Object.entries(historyByExercise).map(([exerciseId, entries]) => {
            /*
             * Der Balken vergleicht eine Übung mit sich selbst: 3.000 kg
             * Kniebeuge neben 300 kg Nackenzug sagen nichts über Fortschritt,
             * nur etwas über die Größe der Muskelgruppe.
             */
            const maxVolume = Math.max(...entries.map((entry) => entry.volume));

            return (
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
                      <p className="mt-1 text-sm text-content-muted">
                        {entry.weekContext}
                        {entry.volume > 0 ? ` · ${formatNumber(Math.round(entry.volume))} kg` : ''}
                      </p>

                      {/*
                        Der Balken ist Zierde: die Zahl steht als Text
                        daneben, damit er nichts trägt, was ohne ihn fehlte.
                        Bei Bändern gibt es kein Volumen in Kilo - dann bleibt
                        er weg, statt überall auf null zu stehen.
                      */}
                      {maxVolume > 0 ? (
                        <div
                          aria-hidden="true"
                          className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-raised"
                        >
                          <div
                            className="h-full rounded-full bg-success"
                            style={{ width: `${Math.max(2, (entry.volume / maxVolume) * 100)}%` }}
                          />
                        </div>
                      ) : null}

                      <div className="mt-3 flex flex-wrap gap-2">
                        {entry.preview.length > 0 ? (
                          entry.preview.map((value, index) => (
                            <span
                              /*
                               * Die Position gehört in den Schlüssel: zwei
                               * gleiche Sätze ("4 Wdh · 82,5 kg") ergeben
                               * denselben Text, und React verwarf dann eines
                               * der beiden Etiketten.
                               */
                              key={`${exerciseId}-${entry.completedAt}-${index}-${value}`}
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
            );
          })
        ) : (
          <Empty
            title="Noch kein Verlauf"
            description="Schließe deine erste Session ab, damit hier stabile Verlaufsdaten pro Übung auftauchen."
          />
        )}
      </div>
    </AppShell>
  );
}
