import type {
  Exercise,
  SessionBundle,
  WorkoutSession,
  WorkoutSessionExercise,
  WorkoutSetLog,
  WorkoutTemplate,
  WorkoutTemplateExercise,
} from '@/domain/models';

interface MaterializeSessionInput {
  template: WorkoutTemplate;
  templateExercises: WorkoutTemplateExercise[];
  exercisesById: Record<string, Exercise>;
  resolvedProgramWeek: number;
  startedAt: string;
}

function createId() {
  return crypto.randomUUID();
}

export function materializeSession({
  template,
  templateExercises,
  exercisesById,
  resolvedProgramWeek,
  startedAt,
}: MaterializeSessionInput): SessionBundle {
  const sessionId = createId();

  const session: WorkoutSession = {
    id: sessionId,
    templateId: template.id,
    templateNameSnapshot: template.name,
    resolvedProgramWeek,
    startedAt,
    status: 'active',
  };

  const sessionExercises: WorkoutSessionExercise[] = [];
  const setLogs: WorkoutSetLog[] = [];

  for (const templateExercise of [...templateExercises].sort(
    (left, right) => left.orderIndex - right.orderIndex,
  )) {
    const exercise = exercisesById[templateExercise.exerciseId];

    if (!exercise) {
      throw new Error(`Exercise ${templateExercise.exerciseId} not found`);
    }

    const sessionExerciseId = createId();

    sessionExercises.push({
      id: sessionExerciseId,
      sessionId,
      exerciseId: exercise.id,
      exerciseNameSnapshot: exercise.name,
      trackingMode: exercise.trackingMode,
      unilateral: exercise.unilateral,
      sourceTemplateExerciseId: templateExercise.id,
      orderIndex: templateExercise.orderIndex,
      wasSkipped: false,
      addedInSession: false,
      workSetCount: templateExercise.workSetCount,
      targetReps: templateExercise.targetReps,
      targetSeconds: templateExercise.targetSeconds,
      targetWeight: templateExercise.targetWeight,
      restSeconds: templateExercise.restSeconds,
      notes: templateExercise.notes,
    });

    setLogs.push({
      id: createId(),
      sessionExerciseId,
      setKind: 'warmup',
      side: 'both',
      setNumber: 0,
      completed: false,
    });

    for (let setNumber = 1; setNumber <= templateExercise.workSetCount; setNumber += 1) {
      const sides = exercise.unilateral ? (['left', 'right'] as const) : (['both'] as const);

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
  }

  return {
    session,
    sessionExercises,
    setLogs,
  };
}

export function calculateAsymmetryPercent(leftValue: number, rightValue: number) {
  const largest = Math.max(leftValue, rightValue);

  if (largest === 0) {
    return 0;
  }

  return Number((((largest - Math.min(leftValue, rightValue)) / largest) * 100).toFixed(1));
}
