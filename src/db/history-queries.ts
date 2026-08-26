import { db } from '@/db/appDb';
import {
  buildLastSetValues,
  pickLastCompletedExecution,
  sortSetLogs,
  type ExerciseExecution,
  type LastSetValues,
} from '@/domain/history';
import type { WorkoutSetLog } from '@/domain/models';
import { sumWorkVolume } from '@/domain/volume';

/**
 * Alle abgeschlossenen Ausführungen einer Übung, älteste zuerst.
 *
 * Basis für das Verlaufsdiagramm. Nutzt den `exerciseId`-Index statt eines
 * Tabellenscans und holt die Sätze in einem einzigen Query.
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
        /*
         * Der Snapshot der Ausführung, nicht der heutige Modus der Übung:
         * wird eine Übung später umgestellt, ist das hier die einzige Stelle,
         * an der noch steht, womit damals gemessen wurde. Ohne diesen Wert
         * fielen die alten Sätze stumm aus der Fortschrittskurve.
         */
        trackingMode: item.trackingMode,
        workLogs: sortSetLogs(workLogsBySessionExerciseId.get(item.id) ?? []),
      };
    })
    .sort((left, right) => left.completedAt.localeCompare(right.completedAt));
}

/**
 * Letzter Abschluss je Workout: `templateId` → `completedAt`.
 *
 * Grundlage für `pickNextTemplate`. Workouts, die noch nie trainiert wurden,
 * fehlen hier schlicht - genau das ist der Fall, den die Heuristik zuerst
 * bedient.
 */
export async function loadTemplateRecency(): Promise<Record<string, string>> {
  // Über den `completedAt`-Index, aufsteigend: Sessions ohne Abschlusszeit
  // stehen gar nicht erst darin (IndexedDB indiziert `undefined` nicht), und
  // der letzte Treffer je Template gewinnt.
  const sessions = await db.workoutSessions.orderBy('completedAt').toArray();
  const recency: Record<string, string> = {};

  for (const session of sessions) {
    // Auch eine abgebrochene Einheit trägt ein `completedAt` - `closeSession`
    // setzt es für beide Ausgänge. Abgebrochen heißt aber nicht trainiert.
    if (session.status !== 'completed' || !session.completedAt) {
      continue;
    }

    recency[session.templateId] = session.completedAt;
  }

  return recency;
}

export interface WeekSummarySession {
  id: string;
  templateId: string;
  templateName: string;
  completedAt: string;
}

export interface WeekSummary {
  sessionCount: number;
  /** Summe aus Last mal Wiederholungen über alle abgehakten Arbeitssätze. */
  volume: number;
  /**
   * Die Einheiten selbst, **neueste zuerst**.
   *
   * Es gibt kein zusätzliches `lastSession`: das wäre derselbe Datensatz unter
   * einem zweiten Namen, und zwei Namen für eine Sache driften auseinander.
   * Die letzte Einheit ist `sessions[0]`.
   */
  sessions: WeekSummarySession[];
}

/**
 * Was seit `sinceIso` trainiert wurde - Einheiten, Volumen, letzte Einheit.
 *
 * Läuft über den `completedAt`-Index statt über einen Tabellenscan: die Zahl
 * steht auf der Startseite bei jedem Aufruf, und die Session-Tabelle wächst
 * mit jedem Training.
 */
export async function loadWeekSummary(sinceIso: string): Promise<WeekSummary> {
  const sessions = (
    await db.workoutSessions.where('completedAt').aboveOrEqual(sinceIso).toArray()
  ).filter((session) => session.status === 'completed' && session.completedAt);

  if (sessions.length === 0) {
    return { sessionCount: 0, volume: 0, sessions: [] };
  }

  const sessionExercises = await db.workoutSessionExercises
    .where('sessionId')
    .anyOf(sessions.map((session) => session.id))
    .toArray();

  const logs =
    sessionExercises.length === 0
      ? []
      : await db.workoutSetLogs
          .where('sessionExerciseId')
          .anyOf(sessionExercises.map((item) => item.id))
          .toArray();

  return {
    sessionCount: sessions.length,
    volume: sumWorkVolume(logs.filter((log) => log.setKind === 'work' && log.completed)),
    sessions: sessions
      .map((session) => ({
        id: session.id,
        templateId: session.templateId,
        templateName: session.templateNameSnapshot,
        completedAt: session.completedAt!,
      }))
      .sort((left, right) => right.completedAt.localeCompare(left.completedAt)),
  };
}

/**
 * Welche Übungen seit `sinceIso` trainiert wurden.
 *
 * Ausgelassene Übungen zählen nicht: das waldgrüne Abzeichen behauptet
 * "erledigt", und eine übersprungene Übung ist das Gegenteil davon.
 */
export async function loadExercisesTrainedSince(sinceIso: string): Promise<Set<string>> {
  const sessions = (
    await db.workoutSessions.where('completedAt').aboveOrEqual(sinceIso).toArray()
  ).filter((session) => session.status === 'completed');

  if (sessions.length === 0) {
    return new Set();
  }

  const sessionExercises = await db.workoutSessionExercises
    .where('sessionId')
    .anyOf(sessions.map((session) => session.id))
    .toArray();

  return new Set(
    sessionExercises.filter((item) => !item.wasSkipped).map((item) => item.exerciseId),
  );
}

export interface LastValues {
  /** Nur Arbeitssätze - Grundlage der "Letzte Werte"-Anzeige. */
  logs: WorkoutSetLog[];
  /**
   * Satzgenaue Werte inklusive Warmup, für die Platzhalter im Satz-Editor.
   */
  setValues: LastSetValues;
  completedAt: string;
  templateName?: string;
}

/**
 * Liefert die zuletzt geloggten Werte je Übung - definiert als die letzte
 * *abgeschlossene* Ausführung derselben Exercise, unabhängig vom Template.
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

  // Ein Query für alle Kandidaten statt einer Abfrage je Übung.
  const allLogs = await db.workoutSetLogs
    .where('sessionExerciseId')
    .anyOf(candidates.map((item) => item.id))
    .toArray();

  const workLogsBySessionExerciseId = new Map<string, WorkoutSetLog[]>();
  // Zweiter Eimer inklusive Warmup: der Platzhalter im Satz-Editor soll auch
  // für den Aufwärmsatz zeigen, was zuletzt dort stand.
  const completedLogsBySessionExerciseId = new Map<string, WorkoutSetLog[]>();

  for (const log of allLogs) {
    if (!log.completed) {
      continue;
    }

    const completedBucket = completedLogsBySessionExerciseId.get(log.sessionExerciseId);

    if (completedBucket) {
      completedBucket.push(log);
    } else {
      completedLogsBySessionExerciseId.set(log.sessionExerciseId, [log]);
    }

    if (log.setKind !== 'work') {
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
      setValues: buildLastSetValues(
        completedLogsBySessionExerciseId.get(latest.sessionExerciseId) ?? [],
      ),
      completedAt: latest.completedAt,
      templateName: latest.templateNameSnapshot,
    };
  }

  return result;
}
