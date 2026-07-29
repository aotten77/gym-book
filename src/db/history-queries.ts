import { db } from '@/db/appDb';
import { pickLastCompletedExecution, sortSetLogs, type ExerciseExecution } from '@/domain/history';
import type { WorkoutSetLog } from '@/domain/models';

/**
 * Alle abgeschlossenen Ausfuehrungen einer Uebung, aelteste zuerst.
 *
 * Basis fuer das Verlaufsdiagramm. Nutzt den `exerciseId`-Index statt eines
 * Tabellenscans und holt die Saetze in einem einzigen Query.
 */
export async function loadExerciseExecutions(exerciseId: string) {
  const sessionExercises = await db.workoutSessionExercises
    .where('exerciseId')
    .equals(exerciseId)
    .toArray();

  if (sessionExercises.length === 0) {
    return [];
  }

  const sessions = await db.workoutSessions.bulkGet([
    ...new Set(sessionExercises.map((item) => item.sessionId)),
  ]);
  const completedById = new Map(
    sessions
      .filter((session) => session?.status === 'completed' && session.completedAt)
      .map((session) => [session!.id, session!]),
  );

  const relevant = sessionExercises.filter((item) => completedById.has(item.sessionId));

  if (relevant.length === 0) {
    return [];
  }

  const logs = await db.workoutSetLogs
    .where('sessionExerciseId')
    .anyOf(relevant.map((item) => item.id))
    .toArray();

  const workLogsBySessionExerciseId = new Map<string, WorkoutSetLog[]>();

  for (const log of logs) {
    if (log.setKind !== 'work' || !log.completed) {
      continue;
    }

    const bucket = workLogsBySessionExerciseId.get(log.sessionExerciseId);

    if (bucket) {
      bucket.push(log);
    } else {
      workLogsBySessionExerciseId.set(log.sessionExerciseId, [log]);
    }
  }

  return relevant
    .map((item) => {
      const session = completedById.get(item.sessionId)!;

      return {
        sessionId: item.sessionId,
        sessionExerciseId: item.id,
        completedAt: session.completedAt!,
        templateName: session.templateNameSnapshot,
        workLogs: sortSetLogs(workLogsBySessionExerciseId.get(item.id) ?? []),
      };
    })
    .sort((left, right) => left.completedAt.localeCompare(right.completedAt));
}

export interface LastValues {
  logs: WorkoutSetLog[];
  completedAt: string;
  templateName?: string;
}

/**
 * Liefert die zuletzt geloggten Werte je Uebung - definiert als die letzte
 * *abgeschlossene* Ausfuehrung derselben Exercise, unabhaengig vom Template.
 *
 * `excludeSessionId` blendet die laufende Session aus, damit die Anzeige nicht
 * auf die eigenen, gerade eingetragenen Werte zeigt.
 */
export async function loadLastValuesForExercises(
  exerciseIds: string[],
  excludeSessionId?: string,
): Promise<Record<string, LastValues>> {
  if (exerciseIds.length === 0) {
    return {};
  }

  const historicExercises = await db.workoutSessionExercises
    .where('exerciseId')
    .anyOf(exerciseIds)
    .toArray();

  const relevantExercises = historicExercises.filter((item) => item.sessionId !== excludeSessionId);

  if (relevantExercises.length === 0) {
    return {};
  }

  const sessions = await db.workoutSessions.bulkGet([
    ...new Set(relevantExercises.map((item) => item.sessionId)),
  ]);
  const completedSessionById = new Map(
    sessions
      .filter((session) => session?.status === 'completed' && session.completedAt)
      .map((session) => [session!.id, session!]),
  );

  const candidates = relevantExercises.filter((item) => completedSessionById.has(item.sessionId));

  if (candidates.length === 0) {
    return {};
  }

  // Ein Query fuer alle Kandidaten statt einer Abfrage je Uebung.
  const allLogs = await db.workoutSetLogs
    .where('sessionExerciseId')
    .anyOf(candidates.map((item) => item.id))
    .toArray();

  const workLogsBySessionExerciseId = new Map<string, WorkoutSetLog[]>();

  for (const log of allLogs) {
    if (log.setKind !== 'work' || !log.completed) {
      continue;
    }

    const bucket = workLogsBySessionExerciseId.get(log.sessionExerciseId);

    if (bucket) {
      bucket.push(log);
    } else {
      workLogsBySessionExerciseId.set(log.sessionExerciseId, [log]);
    }
  }

  const executionsByExerciseId = new Map<string, ExerciseExecution[]>();

  for (const item of candidates) {
    const session = completedSessionById.get(item.sessionId)!;
    const execution: ExerciseExecution = {
      sessionExerciseId: item.id,
      exerciseId: item.exerciseId,
      sessionId: item.sessionId,
      completedAt: session.completedAt!,
      templateNameSnapshot: session.templateNameSnapshot,
      workLogs: workLogsBySessionExerciseId.get(item.id) ?? [],
    };

    const bucket = executionsByExerciseId.get(item.exerciseId);

    if (bucket) {
      bucket.push(execution);
    } else {
      executionsByExerciseId.set(item.exerciseId, [execution]);
    }
  }

  const result: Record<string, LastValues> = {};

  for (const [exerciseId, executions] of executionsByExerciseId) {
    const latest = pickLastCompletedExecution(executions);

    if (!latest) {
      continue;
    }

    result[exerciseId] = {
      logs: sortSetLogs(latest.workLogs),
      completedAt: latest.completedAt,
      templateName: latest.templateNameSnapshot,
    };
  }

  return result;
}
