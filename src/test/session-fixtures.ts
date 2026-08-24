import { db } from '@/db/appDb';

/**
 * Eine laufende Einheit mit drei Übungen, davon eine einseitige.
 *
 * Geteilt zwischen den Uhren- und den Supersatz-Tests, weil beide dieselbe
 * Ausgangslage brauchen: mehrere Übungen hintereinander und eine, die links
 * und rechts getrennt führt. Genau daran hängen die zwei Fälle, für die es
 * mehrere Pausenspuren überhaupt gibt.
 */
export async function seedRestSession(status: 'active' | 'completed' = 'active') {
  await db.workoutSessions.add({
    id: 'session-rest',
    templateId: 'template-rest',
    templateNameSnapshot: 'Einheit Pause',
    resolvedProgramWeek: 1,
    startedAt: '2026-01-08T09:00:00.000Z',
    status,
  });

  await db.workoutSessionExercises.bulkAdd([
    {
      id: 'exercise-a',
      sessionId: 'session-rest',
      exerciseId: 'squat',
      exerciseNameSnapshot: 'Front Squat',
      trackingMode: 'reps_weight',
      unilateral: false,
      orderIndex: 1,
      wasSkipped: false,
      addedInSession: false,
      workSetCount: 2,
      restSeconds: 120,
    },
    {
      id: 'exercise-b',
      sessionId: 'session-rest',
      exerciseId: 'split-squat',
      exerciseNameSnapshot: 'Split Squat',
      trackingMode: 'reps_weight',
      unilateral: true,
      orderIndex: 2,
      wasSkipped: false,
      addedInSession: false,
      workSetCount: 2,
    },
    {
      id: 'exercise-c',
      sessionId: 'session-rest',
      exerciseId: 'curl',
      exerciseNameSnapshot: 'Curl',
      trackingMode: 'reps_weight',
      unilateral: false,
      orderIndex: 3,
      wasSkipped: false,
      addedInSession: false,
      workSetCount: 1,
    },
  ]);

  await db.workoutSetLogs.bulkAdd([
    { id: 'a-1', sessionExerciseId: 'exercise-a', setKind: 'work', side: 'both', setNumber: 1, completed: false },
    { id: 'a-2', sessionExerciseId: 'exercise-a', setKind: 'work', side: 'both', setNumber: 2, completed: false },
    { id: 'b-1-left', sessionExerciseId: 'exercise-b', setKind: 'work', side: 'left', setNumber: 1, completed: false },
    { id: 'b-1-right', sessionExerciseId: 'exercise-b', setKind: 'work', side: 'right', setNumber: 1, completed: false },
    { id: 'b-2-left', sessionExerciseId: 'exercise-b', setKind: 'work', side: 'left', setNumber: 2, completed: false },
    { id: 'b-2-right', sessionExerciseId: 'exercise-b', setKind: 'work', side: 'right', setNumber: 2, completed: false },
    { id: 'c-1', sessionExerciseId: 'exercise-c', setKind: 'work', side: 'both', setNumber: 1, completed: false },
  ]);
}
