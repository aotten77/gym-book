import { db } from '@/db/appDb';
import { normalizeOptionalNumber, normalizeOptionalText } from '@/db/normalize';
import { isSessionExerciseEditable, isSetLogEditable } from '@/db/session-guards';
import type {
  WorkoutSession,
  WorkoutSessionExercise,
  WorkoutSetLog,
} from '@/domain/models';
import { findRestTrack, removeRestTrack, removeRestTracksForExercise } from '@/domain/rest-timer';
import type { SetLogValuesInput } from '@/domain/history';
import { materializeSession } from '@/domain/session';
import {
  areGroupsContiguous,
  planGroupWithPrevious,
  planUngroup,
  type SupersetAssignment,
} from '@/domain/superset';
import { createId } from '@/lib/id';

// Weiterhin von hier aus zu haben: der Typ gehört zur Aktion, auch wenn er
// in `domain` liegen muss, damit reine Module ihn benutzen dürfen.
export type { SetLogValuesInput };

interface AddSessionExerciseInput {
  sessionId: string;
  /** Immer eine bestehende Übung - angelegt wird sie in `exercise-actions.ts`. */
  exerciseId: string;
  workSetCount: number;
  includeWarmup?: boolean;
  targetReps?: number;
  targetSeconds?: number;
  targetWeight?: number;
  targetBandId?: string;
  targetHeightCm?: number;
  restSeconds?: number;
  notes?: string;
}

function createSetLogs(
  sessionExerciseId: string,
  workSetCount: number,
  unilateral: boolean,
  includeWarmup = true,
) {
  const sides = unilateral ? (['left', 'right'] as const) : (['both'] as const);
  const setLogs: WorkoutSetLog[] = [];

  // Spiegelt die Regel aus `materializeSession`: höchstens eine Aufwärmrunde,
  // nur wenn sie nicht ausdrücklich abgewählt wurde, und einseitig gespiegelt
  // wie die Arbeitssätze.
  if (includeWarmup) {
    for (const side of sides) {
      setLogs.push({
        id: createId(),
        sessionExerciseId,
        setKind: 'warmup',
        side,
        setNumber: 0,
        completed: false,
      });
    }
  }

  for (let setNumber = 1; setNumber <= workSetCount; setNumber += 1) {
    for (const side of sides) {
      setLogs.push({
        id: createId(),
        sessionExerciseId,
        setKind: 'work',
        side,
        setNumber,
        completed: false,
      });
    }
  }

  return setLogs;
}

export async function findActiveSession() {
  return db.workoutSessions.where('status').equals('active').first();
}

export async function startSessionFromTemplate(templateId: string) {
  const template = await db.workoutTemplates.get(templateId);

  if (!template) {
    throw new Error('Template not found');
  }

  const templateExercises = await db.workoutTemplateExercises
    .where('templateId')
    .equals(templateId)
    .sortBy('orderIndex');

  const exercises = await db.exercises.bulkGet(templateExercises.map((item) => item.exerciseId));
  const settings = await db.appSettings.get('app-settings');
  const program = settings?.activeProgramId
    ? await db.programs.get(settings.activeProgramId)
    : undefined;
  const resolvedProgramWeek = settings?.weekOverride ?? program?.activeWeek ?? 1;
  const usedWeekOverride = typeof settings?.weekOverride === 'number';
  const programWeek =
    program && settings?.activeProgramId
      ? (
          await db.programWeeks
            .where('programId')
            .equals(settings.activeProgramId)
            .filter((week) => week.weekNumber === resolvedProgramWeek)
            .first()
        )
      : undefined;
  const progressionRules =
    programWeek && templateExercises.length > 0
      ? await db.progressionRules.where('programWeekId').equals(programWeek.id).toArray()
      : [];
  const progressionRulesByTemplateExerciseId = Object.fromEntries(
    progressionRules.map((rule) => [rule.templateExerciseId, rule]),
  );
  const bandLevels = await db.bandLevels.toArray();

  const bundle = materializeSession({
    template,
    templateExercises,
    exercisesById: Object.fromEntries(
      exercises.filter(Boolean).map((exercise) => [exercise.id, exercise]),
    ),
    progressionRulesByTemplateExerciseId,
    bandLevelsById: Object.fromEntries(bandLevels.map((band) => [band.id, band])),
    programNameSnapshot: program?.name,
    programWeekLabelSnapshot: programWeek?.label,
    usedWeekOverride,
    resolvedProgramWeek,
    startedAt: new Date().toISOString(),
  });

  return db.transaction(
    'rw',
    db.workoutSessions,
    db.workoutSessionExercises,
    db.workoutSetLogs,
    async () => {
      // Der Check gehört in dieselbe Transaktion wie das Insert, sonst
      // erzeugen zwei schnelle Taps zwei parallele aktive Sessions.
      const existingActiveSession = await findActiveSession();

      if (existingActiveSession) {
        return existingActiveSession.id;
      }

      await db.workoutSessions.add(bundle.session);
      await db.workoutSessionExercises.bulkAdd(bundle.sessionExercises);
      await db.workoutSetLogs.bulkAdd(bundle.setLogs);

      return bundle.session.id;
    },
  );
}

export async function toggleSetCompletion(setLogId: string) {
  await db.transaction(
    'rw',
    db.workoutSessions,
    db.workoutSessionExercises,
    db.workoutSetLogs,
    async () => {
      if (!(await isSetLogEditable(setLogId))) {
        return;
      }

      // Lesen und Schreiben in einem Zug: bei einem Doppeltipp würde ein
      // getrenntes get/update beide Male denselben Ausgangswert sehen.
      await db.workoutSetLogs.where('id').equals(setLogId).modify((log) => {
        const nextCompleted = !log.completed;
        log.completed = nextCompleted;

        if (nextCompleted) {
          log.completedAt = new Date().toISOString();
        } else {
          delete log.completedAt;
        }
      });
    },
  );
}

/**
 * Schreibt Satzwerte.
 *
 * Nur Felder, die im Input als eigene Property vorhanden sind, werden
 * angefasst. Ein fehlendes Feld bleibt unverändert; ein Feld mit `undefined`
 * wird bewusst geleert. Ohne diese Unterscheidung würde eine Fehleingabe
 * über Dexies `undefined = Property löschen` einen gespeicherten Wert
 * vernichten.
 */
export async function updateSetLogValues(setLogId: string, values: SetLogValuesInput) {
  /*
   * Geklammert wie die direkten Nachbarn `toggleSetCompletion` und
   * `deleteSetLog`: gelesen werden der Satz, seine Übung, deren Session und
   * der Band-Katalog, geschrieben wird danach - dazwischen darf sich nichts
   * ändern. Der Katalog gehört in den Scope, weil der Bandname aus ihm kommt
   * und zusammen mit der Id geschrieben wird; ein Löschen dazwischen ergäbe
   * einen Satz mit Id und ohne Namen.
   *
   * Alle `await` darin sind Dexies eigene - jedes andere schlösse die
   * Transaktion.
   */
  await db.transaction(
    'rw',
    db.workoutSessions,
    db.workoutSessionExercises,
    db.workoutSetLogs,
    db.bandLevels,
    async () => {
      if (!(await isSetLogEditable(setLogId))) {
        return;
      }

      const current = await db.workoutSetLogs.get(setLogId);

      if (!current) {
        return;
      }

      const changes: Partial<
        Pick<
          WorkoutSetLog,
          'reps' | 'seconds' | 'weight' | 'heightCm' | 'bandId' | 'bandNameSnapshot'
        >
      > = {};

      if ('reps' in values) {
        changes.reps = normalizeOptionalNumber(values.reps);
      }

      if ('seconds' in values) {
        changes.seconds = normalizeOptionalNumber(values.seconds);
      }

      if ('weight' in values) {
        changes.weight = normalizeOptionalNumber(values.weight);
      }

      if ('heightCm' in values) {
        changes.heightCm = normalizeOptionalNumber(values.heightCm);
      }

      if ('bandId' in values) {
        const bandId = normalizeOptionalText(values.bandId);
        const band = bandId ? await db.bandLevels.get(bandId) : undefined;

        // Eine Id ohne passendes Band im Katalog wird ignoriert statt geschrieben:
        // sonst stünde am Satz eine Auswahl, die niemand mehr benennen kann.
        if (!bandId || band) {
          changes.bandId = bandId;
          // Id und Name gehören zusammen - beide setzen oder beide leeren.
          changes.bandNameSnapshot = band?.name;
        }
      }

      if (Object.keys(changes).length === 0) {
        return;
      }

      await db.workoutSetLogs.update(setLogId, changes);
    },
  );
}

/**
 * Entfernt eine einzelne Satzzeile aus einer laufenden Session.
 *
 * Bewusst genau eine Zeile: bei unilateralen Übungen sind links und rechts
 * getrennte Datensätze, und wer nur eine Seite streichen will, soll die
 * andere behalten dürfen. `workSetCount` auf der Session-Übung bleibt
 * unangetastet - der Wert beschreibt die Materialisierung, nicht den
 * laufenden Stand.
 */
export async function deleteSetLog(setLogId: string) {
  await db.transaction(
    'rw',
    db.workoutSessions,
    db.workoutSessionExercises,
    db.workoutSetLogs,
    async () => {
      // Derselbe Guard wie beim Werteschreiben: abgeschlossene Sessions sind
      // unveränderlich.
      if (!(await isSetLogEditable(setLogId))) {
        return;
      }

      const setLog = await db.workoutSetLogs.get(setLogId);
      const sessionExercise = setLog
        ? await db.workoutSessionExercises.get(setLog.sessionExerciseId)
        : undefined;

      await db.workoutSetLogs.delete(setLogId);

      if (!setLog || !sessionExercise) {
        return;
      }

      const session = await db.workoutSessions.get(sessionExercise.sessionId);

      if (!session) {
        return;
      }

      const changes: Partial<WorkoutSession> = {};

      // Ein Timer ohne Satzzeile hätte kein Ziel mehr für sein Ergebnis und
      // liefe in der Leiste bis zum Ablauf weiter.
      if (session.setTimer?.setLogId === setLogId) {
        changes.setTimer = undefined;
      }

      // Dieselbe Überlegung für die Pause: sie gehört zu einer Übung *und*
      // einer Seite. Erst wenn die letzte Zeile dieser Seite weg ist, gibt es
      // nichts mehr, worauf sich das Warten bezöge.
      const remainingOnSide = await db.workoutSetLogs
        .where('sessionExerciseId')
        .equals(sessionExercise.id)
        .filter((log) => log.side === setLog.side)
        .count();

      if (remainingOnSide === 0 && findRestTrack(session.restTimers, sessionExercise.id, setLog.side)) {
        changes.restTimers = removeRestTrack(session.restTimers, sessionExercise.id, setLog.side);
      }

      if (Object.keys(changes).length > 0) {
        await db.workoutSessions.update(session.id, changes);
      }
    },
  );
}

export async function addSessionExercise(input: AddSessionExerciseInput) {
  const session = await db.workoutSessions.get(input.sessionId);

  if (!session || session.status !== 'active') {
    throw new Error('Active session not found');
  }

  const existingSessionExercises = await db.workoutSessionExercises
    .where('sessionId')
    .equals(input.sessionId)
    .sortBy('orderIndex');
  const nextOrderIndex =
    existingSessionExercises.length > 0
      ? Math.max(...existingSessionExercises.map((item) => item.orderIndex)) + 1
      : 1;
  const workSetCount = Math.max(1, input.workSetCount);
  const exercise = await db.exercises.get(input.exerciseId);

  if (!exercise) {
    throw new Error('Exercise not found');
  }

  const { trackingMode, loadKind, tracksHeight, unilateral } = exercise;
  const targetBandId = normalizeOptionalText(input.targetBandId);
  const targetBand = targetBandId ? await db.bandLevels.get(targetBandId) : undefined;
  const sessionExerciseId = createId();
  const setLogs = createSetLogs(
    sessionExerciseId,
    workSetCount,
    unilateral,
    input.includeWarmup !== false,
  );

  await db.transaction('rw', db.workoutSessionExercises, db.workoutSetLogs, async () => {
    await db.workoutSessionExercises.add({
      id: sessionExerciseId,
      sessionId: input.sessionId,
      exerciseId: exercise.id,
      exerciseNameSnapshot: exercise.name,
      trackingMode,
      loadKind,
      tracksHeight,
      unilateral,
      orderIndex: nextOrderIndex,
      wasSkipped: false,
      addedInSession: true,
      workSetCount,
      targetReps: normalizeOptionalNumber(input.targetReps),
      targetSeconds: normalizeOptionalNumber(input.targetSeconds),
      targetWeight: normalizeOptionalNumber(input.targetWeight),
      targetBandId,
      targetBandNameSnapshot: targetBand?.name,
      targetHeightCm: normalizeOptionalNumber(input.targetHeightCm),
      restSeconds: normalizeOptionalNumber(input.restSeconds),
      notes: normalizeOptionalText(input.notes),
    });

    await db.workoutSetLogs.bulkAdd(setLogs);
  });

  return sessionExerciseId;
}

export async function toggleSkipSessionExercise(sessionExerciseId: string) {
  await db.transaction('rw', db.workoutSessions, db.workoutSessionExercises, async () => {
    if (!(await isSessionExerciseEditable(sessionExerciseId))) {
      return;
    }

    let becameSkipped = false;

    // `modify` liest und schreibt in einem Zug, damit ein Doppeltipp den
    // Zustand nicht zweimal auf denselben Wert setzt.
    await db.workoutSessionExercises.where('id').equals(sessionExerciseId).modify((item) => {
      item.wasSkipped = !item.wasSkipped;
      becameSkipped = item.wasSkipped;
    });

    if (!becameSkipped) {
      return;
    }

    const sessionExercise = await db.workoutSessionExercises.get(sessionExerciseId);
    const session = sessionExercise
      ? await db.workoutSessions.get(sessionExercise.sessionId)
      : undefined;

    // Eine Pause für eine übersprungene Übung zählt auf nichts mehr hin.
    if (session?.restTimers?.length) {
      await db.workoutSessions.update(session.id, {
        restTimers: removeRestTracksForExercise(session.restTimers, sessionExerciseId),
      });
    }
  });
}

export async function reorderSessionExercises(sessionId: string, orderedSessionExerciseIds: string[]) {
  const session = await db.workoutSessions.get(sessionId);

  if (!session || session.status !== 'active') {
    return;
  }

  const currentExercises = await db.workoutSessionExercises
    .where('sessionId')
    .equals(sessionId)
    .sortBy('orderIndex');

  if (currentExercises.length !== orderedSessionExerciseIds.length) {
    return;
  }

  const knownIds = new Set(currentExercises.map((item) => item.id));

  if (orderedSessionExerciseIds.some((id) => !knownIds.has(id))) {
    return;
  }

  // Eine Reihenfolge, die einen Supersatz zerreißt, entstünde stumm und ließe
  // sich danach weder darstellen noch am Stück bewegen.
  const exerciseById = new Map(currentExercises.map((item) => [item.id, item]));
  const nextOrder = orderedSessionExerciseIds
    .map((id) => exerciseById.get(id))
    .filter((item): item is WorkoutSessionExercise => Boolean(item));

  if (!areGroupsContiguous(nextOrder)) {
    return;
  }

  await db.transaction('rw', db.workoutSessionExercises, async () => {
    await Promise.all(
      orderedSessionExerciseIds.map((id, index) =>
        db.workoutSessionExercises.update(id, {
          orderIndex: index + 1,
        }),
      ),
    );
  });
}

/**
 * Verbindet eine Session-Übung mit ihrer Vorgängerin zu einem Supersatz bzw.
 * löst sie wieder heraus.
 *
 * Arbeitet ausschließlich auf der Session-Kopie: ein Supersatz, der beim
 * Training entsteht oder gelöst wird, darf den Plan nicht anfassen.
 */
async function applySessionSupersetPlan(
  sessionExerciseId: string,
  plan: (
    items: WorkoutSessionExercise[],
    id: string,
  ) => SupersetAssignment[] | null,
) {
  await db.transaction('rw', db.workoutSessions, db.workoutSessionExercises, async () => {
    if (!(await isSessionExerciseEditable(sessionExerciseId))) {
      return;
    }

    const current = await db.workoutSessionExercises.get(sessionExerciseId);

    if (!current) {
      return;
    }

    const items = await db.workoutSessionExercises
      .where('sessionId')
      .equals(current.sessionId)
      .sortBy('orderIndex');
    const assignments = plan(items, sessionExerciseId);

    if (!assignments) {
      return;
    }

    await Promise.all(
      assignments.map((entry) =>
        // `undefined` löscht die Property über Dexies Update-Semantik - beim
        // Lösen ist genau das gemeint.
        db.workoutSessionExercises.update(entry.id, { supersetGroupId: entry.supersetGroupId }),
      ),
    );
  });
}

export async function groupSessionExerciseWithPrevious(sessionExerciseId: string) {
  await applySessionSupersetPlan(sessionExerciseId, planGroupWithPrevious);
}

export async function ungroupSessionExercise(sessionExerciseId: string) {
  await applySessionSupersetPlan(sessionExerciseId, planUngroup);
}

async function closeSession(sessionId: string, status: 'completed' | 'aborted') {
  await db.transaction('rw', db.workoutSessions, async () => {
    const session = await db.workoutSessions.get(sessionId);

    if (!session) {
      throw new Error('Session nicht gefunden');
    }

    // Nur eine laufende Session lässt sich abschließen. Ohne diesen Guard
    // überschreibt ein zweiter Tipp den bereits gesetzten Abschlusszeitpunkt.
    if (session.status !== 'active') {
      return;
    }

    await db.workoutSessions.update(sessionId, {
      status,
      completedAt: new Date().toISOString(),
      restTimers: undefined,
      setTimer: undefined,
    });
  });
}

export async function completeSession(sessionId: string) {
  await closeSession(sessionId, 'completed');
}

/**
 * Bricht eine laufende Session ab. Ohne diesen Weg bleibt eine versehentlich
 * gestartete Session für immer aktiv und blockiert jeden neuen Trainingsstart.
 */
export async function abortSession(sessionId: string) {
  await closeSession(sessionId, 'aborted');
}
