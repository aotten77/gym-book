import { db } from '@/db/appDb';
import type { LoadKind, TrackingMode, WorkoutSetLog } from '@/domain/models';
import { materializeSession } from '@/domain/session';
import { clampSetTimerSeconds } from '@/domain/set-timer';
import { createId } from '@/lib/id';

export interface SetLogValuesInput {
  reps?: number;
  seconds?: number;
  weight?: number;
  /** Id aus dem Band-Katalog; den Namen friert die Aktion selbst ein. */
  bandId?: string;
}

interface AddSessionExerciseInput {
  sessionId: string;
  workSetCount: number;
  includeWarmup?: boolean;
  targetReps?: number;
  targetSeconds?: number;
  targetWeight?: number;
  targetBandId?: string;
  restSeconds?: number;
  notes?: string;
  exerciseId?: string;
  exerciseName?: string;
  instructions?: string;
  tempo?: string;
  trackingMode: TrackingMode;
  loadKind?: LoadKind;
  unilateral: boolean;
}

function normalizeOptionalText(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeOptionalNumber(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return undefined;
  }

  return value >= 0 ? value : undefined;
}

function createSetLogs(
  sessionExerciseId: string,
  workSetCount: number,
  unilateral: boolean,
  includeWarmup = true,
) {
  // Spiegelt die Regel aus `materializeSession`: höchstens ein Warmup-Satz,
  // und nur wenn er nicht ausdrücklich abgewählt wurde.
  const setLogs: WorkoutSetLog[] = includeWarmup
    ? [
        {
          id: createId(),
          sessionExerciseId,
          setKind: 'warmup',
          side: 'both',
          setNumber: 0,
          completed: false,
        },
      ]
    : [];

  for (let setNumber = 1; setNumber <= workSetCount; setNumber += 1) {
    const sides = unilateral ? (['left', 'right'] as const) : (['both'] as const);

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

async function isSessionExerciseEditable(sessionExerciseId: string) {
  const sessionExercise = await db.workoutSessionExercises.get(sessionExerciseId);

  if (!sessionExercise) {
    return false;
  }

  const session = await db.workoutSessions.get(sessionExercise.sessionId);
  return session?.status === 'active';
}

async function isSetLogEditable(setLogId: string) {
  const setLog = await db.workoutSetLogs.get(setLogId);

  if (!setLog) {
    return false;
  }

  return isSessionExerciseEditable(setLog.sessionExerciseId);
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
  if (!(await isSetLogEditable(setLogId))) {
    return;
  }

  const current = await db.workoutSetLogs.get(setLogId);

  if (!current) {
    return;
  }

  const changes: Partial<
    Pick<WorkoutSetLog, 'reps' | 'seconds' | 'weight' | 'bandId' | 'bandNameSnapshot'>
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

      // Ein Timer ohne Satzzeile hätte kein Ziel mehr für sein Ergebnis und
      // liefe in der Leiste bis zum Ablauf weiter.
      if (sessionExercise) {
        const session = await db.workoutSessions.get(sessionExercise.sessionId);

        if (session?.setTimer?.setLogId === setLogId) {
          await db.workoutSessions.update(session.id, { setTimer: undefined });
        }
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
  const now = new Date().toISOString();
  const exerciseId = input.exerciseId ?? createId();
  const existingExercise = input.exerciseId ? await db.exercises.get(input.exerciseId) : undefined;

  if (input.exerciseId && !existingExercise) {
    throw new Error('Exercise not found');
  }

  const exerciseName = existingExercise?.name ?? input.exerciseName?.trim() ?? 'Neue Übung';
  const trackingMode = existingExercise?.trackingMode ?? input.trackingMode;
  const loadKind = existingExercise ? existingExercise.loadKind : input.loadKind;
  const unilateral = existingExercise?.unilateral ?? input.unilateral;
  const targetBandId = normalizeOptionalText(input.targetBandId);
  const targetBand = targetBandId ? await db.bandLevels.get(targetBandId) : undefined;
  const sessionExerciseId = createId();
  const setLogs = createSetLogs(
    sessionExerciseId,
    workSetCount,
    unilateral,
    input.includeWarmup !== false,
  );

  await db.transaction(
    'rw',
    db.exercises,
    db.workoutSessionExercises,
    db.workoutSetLogs,
    async () => {
      if (!input.exerciseId) {
        await db.exercises.add({
          id: exerciseId,
          name: exerciseName,
          instructions: normalizeOptionalText(input.instructions),
          tempo: normalizeOptionalText(input.tempo),
          trackingMode,
          loadKind,
          unilateral,
          createdAt: now,
          updatedAt: now,
        });
      }

      await db.workoutSessionExercises.add({
        id: sessionExerciseId,
        sessionId: input.sessionId,
        exerciseId,
        exerciseNameSnapshot: exerciseName,
        trackingMode,
        loadKind,
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
        restSeconds: normalizeOptionalNumber(input.restSeconds),
        notes: normalizeOptionalText(input.notes),
      });

      await db.workoutSetLogs.bulkAdd(setLogs);
    },
  );

  return sessionExerciseId;
}

export async function toggleSkipSessionExercise(sessionExerciseId: string) {
  await db.transaction('rw', db.workoutSessions, db.workoutSessionExercises, async () => {
    if (!(await isSessionExerciseEditable(sessionExerciseId))) {
      return;
    }

    // `modify` liest und schreibt in einem Zug, damit ein Doppeltipp den
    // Zustand nicht zweimal auf denselben Wert setzt.
    await db.workoutSessionExercises.where('id').equals(sessionExerciseId).modify((item) => {
      item.wasSkipped = !item.wasSkipped;
    });
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

export async function startRestTimer(sessionId: string, seconds: number) {
  await db.transaction('rw', db.workoutSessions, async () => {
    const session = await db.workoutSessions.get(sessionId);

    if (session?.status !== 'active') {
      return;
    }

    await db.workoutSessions.update(sessionId, {
      restTimerEndsAt: Date.now() + Math.max(1, Math.round(seconds)) * 1000,
    });
  });
}

export async function extendRestTimer(sessionId: string, seconds: number) {
  await db.transaction('rw', db.workoutSessions, async () => {
    const session = await db.workoutSessions.get(sessionId);

    if (session?.status !== 'active') {
      return;
    }

    // Von der Restlaufzeit aus verlängern, nicht vom ursprünglichen Ende:
    // ein abgelaufener Timer startet damit sauber neu.
    const base = Math.max(session.restTimerEndsAt ?? 0, Date.now());

    await db.workoutSessions.update(sessionId, {
      restTimerEndsAt: base + Math.round(seconds) * 1000,
    });
  });
}

export async function clearRestTimer(sessionId: string) {
  await db.workoutSessions.update(sessionId, { restTimerEndsAt: undefined });
}

/**
 * Startet den Timer für einen Satz auf Zeit.
 *
 * Der Timer hängt an der Session, nicht an der Satzzeile: es läuft immer
 * höchstens einer, und ein Start auf einer anderen Zeile löst den vorigen
 * ohne Rückstand ab.
 */
export async function startSetTimer(sessionId: string, setLogId: string, seconds: number) {
  await db.transaction(
    'rw',
    db.workoutSessions,
    db.workoutSessionExercises,
    db.workoutSetLogs,
    async () => {
      // Derselbe Guard wie beim Werteschreiben: in einer abgeschlossenen
      // Session gibt es nichts mehr zu messen.
      if (!(await isSetLogEditable(setLogId))) {
        return;
      }

      const setLog = await db.workoutSetLogs.get(setLogId);
      const sessionExercise = setLog
        ? await db.workoutSessionExercises.get(setLog.sessionExerciseId)
        : undefined;

      // Verhindert einen Timer, der auf eine Satzzeile einer fremden Session
      // zeigt - sein Ergebnis landete sonst außerhalb der laufenden Session.
      if (sessionExercise?.sessionId !== sessionId) {
        return;
      }

      const durationSeconds = clampSetTimerSeconds(seconds);

      await db.workoutSessions.update(sessionId, {
        setTimer: {
          setLogId,
          durationSeconds,
          endsAt: Date.now() + durationSeconds * 1000,
        },
      });
    },
  );
}

/**
 * Beendet den Satz-Timer und schreibt die erreichte Zeit in den Satz.
 *
 * Genau dafür ist der Timer da: was gemessen wurde, muss nicht noch einmal
 * getippt werden. `seconds` kommt vom Aufrufer, weil nur er weiß, ob der Timer
 * abgelaufen ist (volle Dauer) oder vorzeitig gestoppt wurde (gehaltene Zeit).
 */
export async function finishSetTimer(sessionId: string, seconds: number) {
  const session = await db.workoutSessions.get(sessionId);
  const timer = session?.setTimer;

  if (!session || session.status !== 'active' || !timer) {
    return;
  }

  const value = Math.max(0, Math.round(seconds));

  await updateSetLogValues(timer.setLogId, { seconds: value });
  await db.workoutSessions.update(sessionId, { setTimer: undefined });
}

/** Bricht den Satz-Timer ab, ohne einen Wert zu schreiben. */
export async function clearSetTimer(sessionId: string) {
  await db.workoutSessions.update(sessionId, { setTimer: undefined });
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
      restTimerEndsAt: undefined,
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
