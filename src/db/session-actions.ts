import { db } from '@/db/appDb';
import type { TrackingMode, WorkoutSetLog } from '@/domain/models';
import { materializeSession } from '@/domain/session';
import { createId } from '@/lib/id';

interface SetLogValuesInput {
  reps?: number;
  seconds?: number;
  weight?: number;
}

interface AddSessionExerciseInput {
  sessionId: string;
  workSetCount: number;
  targetReps?: number;
  targetSeconds?: number;
  targetWeight?: number;
  restSeconds?: number;
  notes?: string;
  exerciseId?: string;
  exerciseName?: string;
  instructions?: string;
  tempo?: string;
  trackingMode: TrackingMode;
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

function createSetLogs(sessionExerciseId: string, workSetCount: number, unilateral: boolean) {
  const setLogs: WorkoutSetLog[] = [
    {
      id: createId(),
      sessionExerciseId,
      setKind: 'warmup',
      side: 'both',
      setNumber: 0,
      completed: false,
    },
  ];

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

export async function startSessionFromTemplate(templateId: string) {
  const existingActiveSession = await db.workoutSessions.where('status').equals('active').first();

  if (existingActiveSession) {
    return existingActiveSession.id;
  }

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

  const bundle = materializeSession({
    template,
    templateExercises,
    exercisesById: Object.fromEntries(
      exercises.filter(Boolean).map((exercise) => [exercise.id, exercise]),
    ),
    resolvedProgramWeek: settings?.weekOverride ?? program?.activeWeek ?? 1,
    startedAt: new Date().toISOString(),
  });

  await db.transaction(
    'rw',
    db.workoutSessions,
    db.workoutSessionExercises,
    db.workoutSetLogs,
    async () => {
      await db.workoutSessions.add(bundle.session);
      await db.workoutSessionExercises.bulkAdd(bundle.sessionExercises);
      await db.workoutSetLogs.bulkAdd(bundle.setLogs);
    },
  );

  return bundle.session.id;
}

export async function toggleSetCompletion(setLogId: string) {
  const current = await db.workoutSetLogs.get(setLogId);

  if (!current) {
    return;
  }

  await db.workoutSetLogs.update(setLogId, {
    completed: !current.completed,
    completedAt: !current.completed ? new Date().toISOString() : undefined,
  });
}

export async function updateSetLogValues(setLogId: string, values: SetLogValuesInput) {
  const current = await db.workoutSetLogs.get(setLogId);

  if (!current) {
    return;
  }

  await db.workoutSetLogs.update(setLogId, {
    reps: values.reps,
    seconds: values.seconds,
    weight: values.weight,
  });
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

  const exerciseName = existingExercise?.name ?? input.exerciseName?.trim() ?? 'Neue Uebung';
  const trackingMode = existingExercise?.trackingMode ?? input.trackingMode;
  const unilateral = existingExercise?.unilateral ?? input.unilateral;
  const sessionExerciseId = createId();
  const setLogs = createSetLogs(sessionExerciseId, workSetCount, unilateral);

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
        unilateral,
        orderIndex: nextOrderIndex,
        wasSkipped: false,
        addedInSession: true,
        workSetCount,
        targetReps: normalizeOptionalNumber(input.targetReps),
        targetSeconds: normalizeOptionalNumber(input.targetSeconds),
        targetWeight: normalizeOptionalNumber(input.targetWeight),
        restSeconds: normalizeOptionalNumber(input.restSeconds),
        notes: normalizeOptionalText(input.notes),
      });

      await db.workoutSetLogs.bulkAdd(setLogs);
    },
  );

  return sessionExerciseId;
}

export async function toggleSkipSessionExercise(sessionExerciseId: string) {
  const current = await db.workoutSessionExercises.get(sessionExerciseId);

  if (!current) {
    return;
  }

  await db.workoutSessionExercises.update(sessionExerciseId, {
    wasSkipped: !current.wasSkipped,
  });
}

export async function moveSessionExercise(sessionExerciseId: string, direction: -1 | 1) {
  const current = await db.workoutSessionExercises.get(sessionExerciseId);

  if (!current) {
    return;
  }

  const allExercises = await db.workoutSessionExercises
    .where('sessionId')
    .equals(current.sessionId)
    .sortBy('orderIndex');

  const currentIndex = allExercises.findIndex((item) => item.id === sessionExerciseId);
  const targetIndex = currentIndex + direction;

  if (currentIndex === -1 || targetIndex < 0 || targetIndex >= allExercises.length) {
    return;
  }

  const target = allExercises[targetIndex];

  await db.transaction('rw', db.workoutSessionExercises, async () => {
    await db.workoutSessionExercises.update(current.id, { orderIndex: target.orderIndex });
    await db.workoutSessionExercises.update(target.id, { orderIndex: current.orderIndex });
  });
}

export async function completeSession(sessionId: string) {
  await db.workoutSessions.update(sessionId, {
    status: 'completed',
    completedAt: new Date().toISOString(),
  });
}
