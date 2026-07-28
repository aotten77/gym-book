import { describe, expect, it } from 'vitest';
import { db } from '@/db/appDb';
import { addSessionExercise, reorderSessionExercises } from '@/db/session-actions';
import { reorderTemplateExercises } from '@/db/template-actions';

describe('addSessionExercise', () => {
  it('appends an existing unilateral exercise and creates warmup plus mirrored work sets', async () => {
    await db.exercises.add({
      id: 'exercise-split-squat',
      name: 'Split Squat',
      trackingMode: 'reps_weight',
      unilateral: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    await db.workoutSessions.add({
      id: 'session-1',
      templateId: 'template-1',
      templateNameSnapshot: 'Einheit A',
      resolvedProgramWeek: 4,
      startedAt: '2026-01-08T09:00:00.000Z',
      status: 'active',
    });

    await db.workoutSessionExercises.add({
      id: 'session-exercise-existing',
      sessionId: 'session-1',
      exerciseId: 'exercise-initial',
      exerciseNameSnapshot: 'Goblet Squat',
      trackingMode: 'reps_weight',
      unilateral: false,
      orderIndex: 1,
      wasSkipped: false,
      addedInSession: false,
      workSetCount: 3,
    });

    const sessionExerciseId = await addSessionExercise({
      sessionId: 'session-1',
      exerciseId: 'exercise-split-squat',
      workSetCount: 2,
      targetReps: 8,
      restSeconds: 90,
      notes: '  Fokus auf stabile Knieachse  ',
      trackingMode: 'time',
      unilateral: false,
    });

    const sessionExercise = await db.workoutSessionExercises.get(sessionExerciseId);
    const setLogs = await db.workoutSetLogs.where('sessionExerciseId').equals(sessionExerciseId).sortBy('setNumber');

    expect(sessionExercise).toMatchObject({
      sessionId: 'session-1',
      exerciseId: 'exercise-split-squat',
      exerciseNameSnapshot: 'Split Squat',
      trackingMode: 'reps_weight',
      unilateral: true,
      orderIndex: 2,
      addedInSession: true,
      workSetCount: 2,
      targetReps: 8,
      restSeconds: 90,
      notes: 'Fokus auf stabile Knieachse',
    });
    expect(setLogs).toHaveLength(5);
    expect(setLogs.filter((item) => item.setKind === 'warmup')).toHaveLength(1);
    expect(setLogs.filter((item) => item.setKind === 'work' && item.side === 'left')).toHaveLength(2);
    expect(setLogs.filter((item) => item.setKind === 'work' && item.side === 'right')).toHaveLength(2);
    expect(await db.exercises.count()).toBe(1);
  });

  it('creates a new exercise when the session exercise does not reference an existing one', async () => {
    await db.workoutSessions.add({
      id: 'session-2',
      templateId: 'template-2',
      templateNameSnapshot: 'Einheit B',
      resolvedProgramWeek: 5,
      startedAt: '2026-01-08T10:00:00.000Z',
      status: 'active',
    });

    const sessionExerciseId = await addSessionExercise({
      sessionId: 'session-2',
      exerciseName: '  Copenhagen Plank  ',
      instructions: '  Unteres Bein sauber fuehren  ',
      tempo: ' 2-1-2 ',
      trackingMode: 'time',
      unilateral: false,
      workSetCount: 3,
      targetSeconds: 30,
      notes: '  Ende Range halten  ',
    });

    const sessionExercise = await db.workoutSessionExercises.get(sessionExerciseId);
    const createdExercise = sessionExercise
      ? await db.exercises.get(sessionExercise.exerciseId)
      : undefined;

    expect(createdExercise).toMatchObject({
      name: 'Copenhagen Plank',
      instructions: 'Unteres Bein sauber fuehren',
      tempo: '2-1-2',
      trackingMode: 'time',
      unilateral: false,
    });
    expect(sessionExercise).toMatchObject({
      orderIndex: 1,
      addedInSession: true,
      targetSeconds: 30,
      notes: 'Ende Range halten',
    });
  });
});

describe('reorderTemplateExercises', () => {
  it('persists a new sequential order for all template exercises', async () => {
    await db.workoutTemplateExercises.bulkAdd([
      {
        id: 'template-exercise-1',
        templateId: 'template-1',
        exerciseId: 'exercise-1',
        orderIndex: 1,
        workSetCount: 3,
      },
      {
        id: 'template-exercise-2',
        templateId: 'template-1',
        exerciseId: 'exercise-2',
        orderIndex: 2,
        workSetCount: 3,
      },
      {
        id: 'template-exercise-3',
        templateId: 'template-1',
        exerciseId: 'exercise-3',
        orderIndex: 3,
        workSetCount: 3,
      },
    ]);

    await reorderTemplateExercises('template-1', [
      'template-exercise-3',
      'template-exercise-1',
      'template-exercise-2',
    ]);

    const reordered = await db.workoutTemplateExercises.where('templateId').equals('template-1').sortBy('orderIndex');

    expect(reordered.map((item) => item.id)).toEqual([
      'template-exercise-3',
      'template-exercise-1',
      'template-exercise-2',
    ]);
    expect(reordered.map((item) => item.orderIndex)).toEqual([1, 2, 3]);
  });

  it('leaves the current order untouched when the provided ids are incomplete', async () => {
    await db.workoutTemplateExercises.bulkAdd([
      {
        id: 'template-exercise-a',
        templateId: 'template-2',
        exerciseId: 'exercise-a',
        orderIndex: 1,
        workSetCount: 3,
      },
      {
        id: 'template-exercise-b',
        templateId: 'template-2',
        exerciseId: 'exercise-b',
        orderIndex: 2,
        workSetCount: 3,
      },
    ]);

    await reorderTemplateExercises('template-2', ['template-exercise-b']);

    const unchanged = await db.workoutTemplateExercises.where('templateId').equals('template-2').sortBy('orderIndex');

    expect(unchanged.map((item) => item.id)).toEqual(['template-exercise-a', 'template-exercise-b']);
    expect(unchanged.map((item) => item.orderIndex)).toEqual([1, 2]);
  });
});

describe('reorderSessionExercises', () => {
  it('persists a new sequential order for all session exercises', async () => {
    await db.workoutSessionExercises.bulkAdd([
      {
        id: 'session-exercise-1',
        sessionId: 'session-1',
        exerciseId: 'exercise-1',
        exerciseNameSnapshot: 'Squat',
        trackingMode: 'reps_weight',
        unilateral: false,
        orderIndex: 1,
        wasSkipped: false,
        addedInSession: false,
        workSetCount: 3,
      },
      {
        id: 'session-exercise-2',
        sessionId: 'session-1',
        exerciseId: 'exercise-2',
        exerciseNameSnapshot: 'Bench',
        trackingMode: 'reps_weight',
        unilateral: false,
        orderIndex: 2,
        wasSkipped: false,
        addedInSession: false,
        workSetCount: 3,
      },
      {
        id: 'session-exercise-3',
        sessionId: 'session-1',
        exerciseId: 'exercise-3',
        exerciseNameSnapshot: 'Row',
        trackingMode: 'reps_weight',
        unilateral: false,
        orderIndex: 3,
        wasSkipped: false,
        addedInSession: true,
        workSetCount: 3,
      },
    ]);

    await reorderSessionExercises('session-1', [
      'session-exercise-3',
      'session-exercise-1',
      'session-exercise-2',
    ]);

    const reordered = await db.workoutSessionExercises
      .where('sessionId')
      .equals('session-1')
      .sortBy('orderIndex');

    expect(reordered.map((item) => item.id)).toEqual([
      'session-exercise-3',
      'session-exercise-1',
      'session-exercise-2',
    ]);
    expect(reordered.map((item) => item.orderIndex)).toEqual([1, 2, 3]);
  });

  it('leaves the current order untouched when the provided ids are incomplete', async () => {
    await db.workoutSessionExercises.bulkAdd([
      {
        id: 'session-exercise-a',
        sessionId: 'session-2',
        exerciseId: 'exercise-a',
        exerciseNameSnapshot: 'Press',
        trackingMode: 'reps_weight',
        unilateral: false,
        orderIndex: 1,
        wasSkipped: false,
        addedInSession: false,
        workSetCount: 3,
      },
      {
        id: 'session-exercise-b',
        sessionId: 'session-2',
        exerciseId: 'exercise-b',
        exerciseNameSnapshot: 'Pull Up',
        trackingMode: 'reps_weight',
        unilateral: false,
        orderIndex: 2,
        wasSkipped: false,
        addedInSession: false,
        workSetCount: 3,
      },
    ]);

    await reorderSessionExercises('session-2', ['session-exercise-b']);

    const unchanged = await db.workoutSessionExercises
      .where('sessionId')
      .equals('session-2')
      .sortBy('orderIndex');

    expect(unchanged.map((item) => item.id)).toEqual(['session-exercise-a', 'session-exercise-b']);
    expect(unchanged.map((item) => item.orderIndex)).toEqual([1, 2]);
  });
});
