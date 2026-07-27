import { db } from '@/db/appDb';
import { materializeSession } from '@/domain/session';

interface SetLogValuesInput {
  reps?: number;
  seconds?: number;
  weight?: number;
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
