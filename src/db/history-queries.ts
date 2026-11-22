import { db } from '@/db/appDb';
import { isGuidedTemplate, resolveGuidedSections, sumGuidedSeconds } from '@/domain/guided-steps';
import {
  buildLastSetValues,
  pickLastCompletedExecution,
  sortSetLogs,
  type ExerciseExecution,
  type LastSetValues,
} from '@/domain/history';
import type { RunLog, WorkoutSetLog } from '@/domain/models';
import type { CalendarSession, CalendarTest } from '@/domain/training-calendar';
import { startOfCalendarWeek } from '@/domain/calendar-week';
import { toDateInputValue } from '@/domain/program';
import { summarizeSessionProgress } from '@/domain/session-summary';
import { sumWorkVolume } from '@/domain/volume';
import { estimateTemplateMinutes } from '@/domain/today-units';
import { buildWeeklyVolume, sessionExerciseVolume, type WeekVolume } from '@/domain/weekly-volume';

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

/**
 * Grobe Dauer je Workout in Minuten (siehe `estimateTemplateMinutes`) -
 * die Quelle der Kurz-Kacheln im Jetzt-Sheet. Ein Workout ohne Übungen fehlt
 * im Ergebnis.
 */
export async function loadTemplateMinutes(): Promise<Record<string, number>> {
  const [rows, exercises, templates] = await Promise.all([
    db.workoutTemplateExercises.toArray(),
    db.exercises.toArray(),
    db.workoutTemplates.toArray(),
  ]);
  const unilateralById = new Map(exercises.map((exercise) => [exercise.id, exercise.unilateral]));
  const byTemplate = new Map<string, typeof rows>();

  for (const row of rows) {
    const bucket = byTemplate.get(row.templateId) ?? [];
    bucket.push(row);
    byTemplate.set(row.templateId, bucket);
  }

  const minutes: Record<string, number> = {};

  for (const [templateId, items] of byTemplate) {
    minutes[templateId] = estimateTemplateMinutes(
      [...items]
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((item) => ({
          workSetCount: item.workSetCount,
          targetReps: item.targetReps,
          targetSeconds: item.targetSeconds,
          restSeconds: item.restSeconds,
          includeWarmup: item.includeWarmup,
          unilateral: unilateralById.get(item.exerciseId) ?? false,
        })),
    );
  }

  // Eine geführte Vorlage hat keine Zeilen: ihre Dauer ist die der Abschnitte,
  // Wechsel eingerechnet - dieselbe Rechnung wie die Kennzahlen des Start-Screens.
  for (const template of templates) {
    if (isGuidedTemplate(template)) {
      minutes[template.id] = Math.ceil(
        sumGuidedSeconds(resolveGuidedSections(template.steps ?? [])) / 60,
      );
    }
  }

  return minutes;
}

/**
 * Übungen je Workout - für die Kacheln „8 min · 5 Übungen“. Bei einer
 * geführten Vorlage die Schritte: aus Sicht dessen, der sie macht, ist jeder
 * eine Übung, und „0 Übungen“ stimmte nicht.
 */
export async function loadTemplateExerciseCounts(): Promise<Record<string, number>> {
  const [rows, templates] = await Promise.all([
    db.workoutTemplateExercises.toArray(),
    db.workoutTemplates.toArray(),
  ]);
  const counts = rows.reduce<Record<string, number>>((result, row) => {
    result[row.templateId] = (result[row.templateId] ?? 0) + 1;
    return result;
  }, {});

  for (const template of templates) {
    if (isGuidedTemplate(template)) {
      counts[template.id] = template.steps?.length ?? 0;
    }
  }

  return counts;
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
 * steht auf der Workouts-Seite bei jedem Aufruf, und die Session-Tabelle wächst
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
 * Die abgeschlossenen Einheiten eines Zeitraums, älteste zuerst.
 *
 * Für den Zeitstrahl: er braucht je Tag nur, *was* abgeschlossen wurde,
 * kein Volumen - das der gewählten Woche kommt aus `loadSessionVolumes`.
 * `loadWeekSummary` zöge dafür alle Satzzeilen des Fensters, und das wäre teuer
 * und ungenutzt.
 *
 * Läuft über den `completedAt`-Index und filtert `status === 'completed'`: eine
 * **abgebrochene** Einheit trägt ebenfalls ein `completedAt`, weil
 * `closeSession` es für beide Ausgänge setzt - abgebrochen heißt aber nicht
 * trainiert, und ein waldgrüner Tag behauptete genau das.
 */
export async function loadCompletedSessionsBetween(
  fromIso: string,
  toIso: string,
): Promise<CalendarSession[]> {
  const sessions = await db.workoutSessions.where('completedAt').between(fromIso, toIso, true, true).toArray();

  return sessions
    .filter((session) => session.status === 'completed' && session.completedAt)
    .map((session) => ({
      id: session.id,
      templateId: session.templateId,
      templateName: session.templateNameSnapshot,
      startedAt: session.startedAt,
      completedAt: session.completedAt!,
      ...(session.templateCategorySnapshot ? { templateCategorySnapshot: session.templateCategorySnapshot } : {}),
      ...(session.planEntryId ? { planEntryId: session.planEntryId } : {}),
    }))
    .sort((left, right) => left.completedAt.localeCompare(right.completedAt));
}

/** Die Läufe zwischen zwei Tagen (`YYYY-MM-DD`, beide eingeschlossen), aufsteigend nach Tag. */
export async function loadRunsBetween(from: string, to: string): Promise<RunLog[]> {
  return db.runLogs.where('date').between(from, to, true, true).sortBy('date');
}

/**
 * Kraftvolumen (kg) je Session - für die *gewählte* Woche des Kalenders.
 *
 * Bewusst getrennt von `loadCompletedSessionsBetween`: die zieht das ganze
 * Fenster und braucht kein Volumen; hier werden nur die Sätze der gefragten
 * Sessions gelesen. Gefiltert wird nach der Art nicht - Mobility-Sessions
 * kommen mit, die Liste zeigt für sie nur kein Volumen. Zählt abgehakte
 * Arbeitssätze, über dieselbe Regel wie die Wochenrechnung
 * (`sessionExerciseVolume`).
 */
export async function loadSessionVolumes(sessionIds: string[]): Promise<Record<string, number>> {
  if (sessionIds.length === 0) {
    return {};
  }

  const exercises = await db.workoutSessionExercises.where('sessionId').anyOf(sessionIds).toArray();
  const logs =
    exercises.length === 0
      ? []
      : await db.workoutSetLogs.where('sessionExerciseId').anyOf(exercises.map((exercise) => exercise.id)).toArray();

  const logsByExercise = new Map<string, WorkoutSetLog[]>();

  for (const log of logs) {
    if (log.setKind !== 'work' || !log.completed) {
      continue;
    }

    const list = logsByExercise.get(log.sessionExerciseId) ?? [];
    list.push(log);
    logsByExercise.set(log.sessionExerciseId, list);
  }

  const volumes: Record<string, number> = Object.fromEntries(sessionIds.map((id) => [id, 0]));

  for (const exercise of exercises) {
    volumes[exercise.sessionId] += sessionExerciseVolume(exercise, logsByExercise.get(exercise.id) ?? []);
  }

  return volumes;
}

/**
 * Wann in einem Zeitraum Seitenvergleiche gemessen wurden.
 *
 * Der Kalender zeigt jeden Seitenvergleich als erledigte Einheit und leitet
 * daraus auch ab, ob die Testwoche erledigt ist. Über den `recordedAt`-Index.
 */
export async function loadTestsBetween(fromIso: string, toIso: string): Promise<CalendarTest[]> {
  const tests = await db.exerciseTests.where('recordedAt').between(fromIso, toIso, true, true).toArray();

  return tests.map(({ id, recordedAt, exerciseNameSnapshot, asymmetryPercent }) => ({
    id,
    recordedAt,
    exerciseNameSnapshot,
    asymmetryPercent,
  }));
}

/**
 * Der früheste lokale Tag, an dem der Zeitstrahl etwas zu zeigen hätte: über
 * abgeschlossene Sessions (`completedAt`), Läufe (`date`), Seitenvergleiche
 * (`recordedAt`) und Termine (`date`), je über den Index. Leer, wenn es nichts
 * davon gibt. Eine abgebrochene Session trägt auch ein `completedAt`, zählt
 * aber nicht - sie steht nirgends im Zeitstrahl.
 */
export async function loadEarliestTimelineDate(): Promise<string | undefined> {
  const [session, run, test, entry] = await Promise.all([
    db.workoutSessions
      .orderBy('completedAt')
      .filter((item) => item.status === 'completed')
      .first(),
    db.runLogs.orderBy('date').first(),
    db.exerciseTests.orderBy('recordedAt').first(),
    db.planEntries.orderBy('date').first(),
  ]);
  const days = [
    session?.completedAt ? toDateInputValue(new Date(session.completedAt)) : undefined,
    run?.date,
    test?.recordedAt ? toDateInputValue(new Date(test.recordedAt)) : undefined,
    entry?.date,
  ].filter((day): day is string => Boolean(day));

  return days.length > 0 ? days.reduce((earliest, day) => (day < earliest ? day : earliest)) : undefined;
}

/**
 * Wie weit die laufende Session ist - die Detailzeile „läuft · Satz 7 von 18"
 * im Zeitstrahl. Gezählt wird wie im Streifen (`summarizeSessionProgress`).
 * Leer, wenn keine Session läuft.
 */
export async function loadActiveSessionProgress(): Promise<
  { sessionId: string; completedCount: number; totalCount: number } | undefined
> {
  const session = await db.workoutSessions.where('status').equals('active').first();

  if (!session) {
    return undefined;
  }

  const exercises = await db.workoutSessionExercises.where('sessionId').equals(session.id).toArray();
  const logs =
    exercises.length === 0
      ? []
      : await db.workoutSetLogs.where('sessionExerciseId').anyOf(exercises.map((exercise) => exercise.id)).toArray();
  const { completedCount, totalCount } = summarizeSessionProgress(logs);

  return { sessionId: session.id, completedCount, totalCount };
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

/**
 * Die Wochenrechnung über einen Zeitraum, älteste Woche zuerst.
 *
 * Liest nur, was die Wochen berühren: Sessions über den `completedAt`-Index
 * zwischen dem Montag von `from` und dem Montag nach der Woche von `to`,
 * deren Übungen und Sätze per `anyOf`, Läufe über den `date`-Index. Die Regeln
 * selbst stehen in `buildWeeklyVolume`.
 */
export async function loadWeeklyVolume(from: Date, to: Date): Promise<WeekVolume[]> {
  const rangeStart = startOfCalendarWeek(from);
  const rangeEnd = startOfCalendarWeek(to);

  rangeEnd.setDate(rangeEnd.getDate() + 7);

  const lastDay = new Date(rangeEnd);

  lastDay.setDate(lastDay.getDate() - 1);

  const sessions = (
    await db.workoutSessions
      .where('completedAt')
      .between(rangeStart.toISOString(), rangeEnd.toISOString(), true, false)
      .toArray()
  ).filter((session) => session.status === 'completed' && session.completedAt);

  const sessionExercises =
    sessions.length > 0
      ? await db.workoutSessionExercises
          .where('sessionId')
          .anyOf(sessions.map((session) => session.id))
          .toArray()
      : [];
  const setLogs =
    sessionExercises.length > 0
      ? await db.workoutSetLogs
          .where('sessionExerciseId')
          .anyOf(sessionExercises.map((item) => item.id))
          .toArray()
      : [];
  const runs = await db.runLogs
    .where('date')
    .between(toDateInputValue(rangeStart), toDateInputValue(lastDay), true, true)
    .toArray();

  return buildWeeklyVolume({ sessions, sessionExercises, setLogs, runs, from, to });
}

/**
 * Was seit dem letzten Senden an Claude dazugekommen sein kann, als Rohlisten.
 *
 * Die Feinregel (Läufe zählen am Senden-Tag mit, Einheiten und Tests nur
 * danach) liegt in `describeSyncStatus`; hier wird nur grob vorgefiltert.
 * Abgeschlossen heißt `status === 'completed'`: eine abgebrochene Einheit
 * trägt auch ein `completedAt` und ist nichts, was Claude wissen müsste. Der
 * Lauf-Filter geht über den lokalen Tag von `since`, weil `date` ein lokaler
 * Kalendertag ist und kein Zeitstempel.
 */
export async function loadSyncActivitySince(since?: string): Promise<{
  sessionsCompletedAt: string[];
  runDates: string[];
  testRecordedAt: string[];
}> {
  const sessions = since
    ? await db.workoutSessions.where('completedAt').aboveOrEqual(since).toArray()
    : await db.workoutSessions.toArray();
  const runs = since
    ? await db.runLogs.where('date').aboveOrEqual(toDateInputValue(new Date(since))).toArray()
    : await db.runLogs.toArray();
  const tests = since
    ? await db.exerciseTests.where('recordedAt').aboveOrEqual(since).toArray()
    : await db.exerciseTests.toArray();

  return {
    sessionsCompletedAt: sessions.flatMap((session) =>
      session.status === 'completed' && session.completedAt ? [session.completedAt] : [],
    ),
    runDates: runs.map((run) => run.date),
    testRecordedAt: tests.map((test) => test.recordedAt),
  };
}
