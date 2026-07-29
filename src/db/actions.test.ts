import { describe, expect, it } from 'vitest';
import { db } from '@/db/appDb';
import {
  abortSession,
  addSessionExercise,
  completeSession,
  reorderSessionExercises,
  startSessionFromTemplate,
  toggleSetCompletion,
  updateSetLogValues,
} from '@/db/session-actions';
import {
  addProgramWeek,
  createProgram,
  deleteProgram,
  deleteProgramWeek,
  setProgramActiveWeek,
  updateProgram,
  updateProgramWeek,
} from '@/db/program-actions';
import { clearExerciseMedia, replaceExerciseMedia } from '@/db/media-actions';
import { clearWeekOverride, setActiveProgram, setWeekOverride } from '@/db/settings-actions';
import { clearProgressionRule, reorderTemplateExercises, saveProgressionRule } from '@/db/template-actions';

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
    await db.workoutSessions.add({
      id: 'session-1',
      templateId: 'template-1',
      templateNameSnapshot: 'Einheit A',
      resolvedProgramWeek: 4,
      startedAt: '2026-01-08T09:00:00.000Z',
      status: 'active',
    });

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
    await db.workoutSessions.add({
      id: 'session-2',
      templateId: 'template-2',
      templateNameSnapshot: 'Einheit B',
      resolvedProgramWeek: 4,
      startedAt: '2026-01-08T10:00:00.000Z',
      status: 'active',
    });

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

  it('does nothing when the session is completed', async () => {
    await db.workoutSessions.add({
      id: 'session-3',
      templateId: 'template-3',
      templateNameSnapshot: 'Einheit C',
      resolvedProgramWeek: 4,
      startedAt: '2026-01-08T11:00:00.000Z',
      completedAt: '2026-01-08T12:00:00.000Z',
      status: 'completed',
    });

    await db.workoutSessionExercises.bulkAdd([
      {
        id: 'session-exercise-x',
        sessionId: 'session-3',
        exerciseId: 'exercise-x',
        exerciseNameSnapshot: 'Row',
        trackingMode: 'reps_weight',
        unilateral: false,
        orderIndex: 1,
        wasSkipped: false,
        addedInSession: false,
        workSetCount: 3,
      },
      {
        id: 'session-exercise-y',
        sessionId: 'session-3',
        exerciseId: 'exercise-y',
        exerciseNameSnapshot: 'Press',
        trackingMode: 'reps_weight',
        unilateral: false,
        orderIndex: 2,
        wasSkipped: false,
        addedInSession: false,
        workSetCount: 3,
      },
    ]);

    await reorderSessionExercises('session-3', ['session-exercise-y', 'session-exercise-x']);

    const unchanged = await db.workoutSessionExercises
      .where('sessionId')
      .equals('session-3')
      .sortBy('orderIndex');

    expect(unchanged.map((item) => item.id)).toEqual(['session-exercise-x', 'session-exercise-y']);
    expect(unchanged.map((item) => item.orderIndex)).toEqual([1, 2]);
  });
});

describe('set log guards', () => {
  it('prevents editing set logs for completed sessions', async () => {
    await db.workoutSessions.add({
      id: 'session-locked',
      templateId: 'template-locked',
      templateNameSnapshot: 'Einheit Locked',
      resolvedProgramWeek: 1,
      startedAt: '2026-01-08T09:00:00.000Z',
      completedAt: '2026-01-08T10:00:00.000Z',
      status: 'completed',
    });

    await db.workoutSessionExercises.add({
      id: 'session-exercise-locked',
      sessionId: 'session-locked',
      exerciseId: 'exercise-locked',
      exerciseNameSnapshot: 'Squat',
      trackingMode: 'reps_weight',
      unilateral: false,
      orderIndex: 1,
      wasSkipped: false,
      addedInSession: false,
      workSetCount: 3,
    });

    await db.workoutSetLogs.add({
      id: 'set-log-locked',
      sessionExerciseId: 'session-exercise-locked',
      setKind: 'work',
      side: 'both',
      setNumber: 1,
      reps: 5,
      weight: 100,
      completed: false,
    });

    await updateSetLogValues('set-log-locked', {
      reps: 6,
      weight: 110,
    });
    await toggleSetCompletion('set-log-locked');

    const unchanged = await db.workoutSetLogs.get('set-log-locked');

    expect(unchanged).toMatchObject({
      reps: 5,
      weight: 100,
      completed: false,
    });
  });

  it('leaves stored values untouched when a field is omitted', async () => {
    await db.workoutSessions.add({
      id: 'session-partial',
      templateId: 'template-partial',
      templateNameSnapshot: 'Einheit Partial',
      resolvedProgramWeek: 1,
      startedAt: '2026-01-09T09:00:00.000Z',
      status: 'active',
    });

    await db.workoutSessionExercises.add({
      id: 'session-exercise-partial',
      sessionId: 'session-partial',
      exerciseId: 'exercise-partial',
      exerciseNameSnapshot: 'Front Squat',
      trackingMode: 'reps_weight',
      unilateral: false,
      orderIndex: 1,
      wasSkipped: false,
      addedInSession: false,
      workSetCount: 3,
    });

    await db.workoutSetLogs.add({
      id: 'set-log-partial',
      sessionExerciseId: 'session-exercise-partial',
      setKind: 'work',
      side: 'both',
      setNumber: 1,
      reps: 10,
      weight: 50,
      completed: false,
    });

    // Nur die Wiederholungen werden geschrieben - das Gewicht darf nicht
    // verschwinden, obwohl es im Input-Objekt fehlt.
    await updateSetLogValues('set-log-partial', { reps: 8 });

    expect(await db.workoutSetLogs.get('set-log-partial')).toMatchObject({
      reps: 8,
      weight: 50,
    });

    // Ein bewusst geleertes Feld wird dagegen entfernt.
    await updateSetLogValues('set-log-partial', { weight: undefined });

    const cleared = await db.workoutSetLogs.get('set-log-partial');
    expect(cleared?.weight).toBeUndefined();
    expect(cleared?.reps).toBe(8);
  });
});

describe('settings and program week actions', () => {
  it('creates settings when missing and updates weekOverride', async () => {
    await setWeekOverride(3);

    const settings = await db.appSettings.get('app-settings');

    expect(settings).toMatchObject({
      id: 'app-settings',
      weekOverride: 3,
      exportSchemaVersion: 1,
    });

    await clearWeekOverride();

    const cleared = await db.appSettings.get('app-settings');
    expect(cleared?.weekOverride).toBeUndefined();
  });

  it('sets the active program and clears weekOverride', async () => {
    await db.programs.add({
      id: 'program-1',
      name: 'Block A',
      activeWeek: 2,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await setWeekOverride(4);

    await setActiveProgram('program-1');

    const settings = await db.appSettings.get('app-settings');

    expect(settings).toMatchObject({
      activeProgramId: 'program-1',
    });
    expect(settings?.weekOverride).toBeUndefined();
  });

  it('updates the program activeWeek', async () => {
    await db.programs.add({
      id: 'program-2',
      name: 'Block B',
      activeWeek: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await db.programWeeks.bulkAdd([
      {
        id: 'program-2-week-1',
        programId: 'program-2',
        weekNumber: 1,
        label: 'Woche 1',
      },
      {
        id: 'program-2-week-2',
        programId: 'program-2',
        weekNumber: 2,
        label: 'Woche 2',
      },
      {
        id: 'program-2-week-3',
        programId: 'program-2',
        weekNumber: 3,
        label: 'Woche 3',
      },
      {
        id: 'program-2-week-4',
        programId: 'program-2',
        weekNumber: 4,
        label: 'Woche 4',
      },
      {
        id: 'program-2-week-5',
        programId: 'program-2',
        weekNumber: 5,
        label: 'Woche 5',
      },
    ]);

    await setProgramActiveWeek('program-2', 5);

    const updated = await db.programs.get('program-2');
    expect(updated?.activeWeek).toBe(5);
  });

  it('creates a program with generated weeks and sets it active when none exists', async () => {
    const programId = await createProgram({
      name: '  Block C  ',
      weekCount: 4,
    });

    const program = await db.programs.get(programId);
    const weeks = await db.programWeeks.where('programId').equals(programId).sortBy('weekNumber');
    const settings = await db.appSettings.get('app-settings');

    expect(program).toMatchObject({
      id: programId,
      name: 'Block C',
      activeWeek: 1,
    });
    expect(weeks.map((week) => week.weekNumber)).toEqual([1, 2, 3, 4]);
    expect(settings?.activeProgramId).toBe(programId);
  });

  it('updates program names and week labels', async () => {
    const programId = await createProgram({
      name: 'Block D',
      weekCount: 2,
    });
    const week = await db.programWeeks.where('programId').equals(programId).first();

    await updateProgram(programId, { name: '  Block D Intensiv  ' });
    await updateProgramWeek(week!.id, { label: '  Deload  ' });

    const program = await db.programs.get(programId);
    const updatedWeek = await db.programWeeks.get(week!.id);

    expect(program?.name).toBe('Block D Intensiv');
    expect(updatedWeek?.label).toBe('Deload');
  });

  it('adds and renumbers program weeks when a week is deleted', async () => {
    const programId = await createProgram({
      name: 'Block E',
      weekCount: 3,
    });
    await setActiveProgram(programId);
    await setWeekOverride(3);

    const addedWeekId = await addProgramWeek(programId);
    const weeksBeforeDelete = await db.programWeeks.where('programId').equals(programId).sortBy('weekNumber');

    expect(weeksBeforeDelete.map((week) => week.weekNumber)).toEqual([1, 2, 3, 4]);

    await deleteProgramWeek(addedWeekId);

    const weeksAfterDelete = await db.programWeeks.where('programId').equals(programId).sortBy('weekNumber');
    const settings = await db.appSettings.get('app-settings');

    expect(weeksAfterDelete.map((week) => week.weekNumber)).toEqual([1, 2, 3]);
    expect(settings?.weekOverride).toBe(3);
  });

  it('clears activeProgramId and deletes progression rules when deleting the active program', async () => {
    const programId = await createProgram({
      name: 'Block F',
      weekCount: 2,
    });
    const week = await db.programWeeks.where('programId').equals(programId).first();

    await db.progressionRules.add({
      id: 'rule-1',
      templateExerciseId: 'template-exercise-1',
      programWeekId: week!.id,
      targetReps: 8,
    });

    await deleteProgram(programId);

    const deletedProgram = await db.programs.get(programId);
    const deletedWeeks = await db.programWeeks.where('programId').equals(programId).toArray();
    const remainingRules = await db.progressionRules.where('programWeekId').equals(week!.id).toArray();
    const settings = await db.appSettings.get('app-settings');

    expect(deletedProgram).toBeUndefined();
    expect(deletedWeeks).toHaveLength(0);
    expect(remainingRules).toHaveLength(0);
    expect(settings?.activeProgramId).toBeUndefined();
    expect(settings?.weekOverride).toBeUndefined();
  });
});

describe('progression rule actions', () => {
  it('upserts and clears progression rules for a template exercise and program week', async () => {
    await saveProgressionRule({
      templateExerciseId: 'template-exercise-1',
      programWeekId: 'week-1',
      targetReps: 8,
      targetWeight: 72.5,
      notes: '  Woche 1  ',
    });

    const created = await db.progressionRules
      .where('templateExerciseId')
      .equals('template-exercise-1')
      .first();

    expect(created).toMatchObject({
      templateExerciseId: 'template-exercise-1',
      programWeekId: 'week-1',
      targetReps: 8,
      targetWeight: 72.5,
      notes: 'Woche 1',
    });

    await saveProgressionRule({
      templateExerciseId: 'template-exercise-1',
      programWeekId: 'week-1',
      targetReps: 9,
    });

    const updated = await db.progressionRules
      .where('templateExerciseId')
      .equals('template-exercise-1')
      .first();

    expect(updated).toMatchObject({
      targetReps: 9,
      targetWeight: undefined,
      notes: undefined,
    });

    await clearProgressionRule('template-exercise-1', 'week-1');

    const cleared = await db.progressionRules
      .where('templateExerciseId')
      .equals('template-exercise-1')
      .first();

    expect(cleared).toBeUndefined();
  });
});

describe('startSessionFromTemplate', () => {
  it('materializes progression rules from the active program week into the session snapshot', async () => {
    await db.exercises.add({
      id: 'exercise-1',
      name: 'Front Squat',
      trackingMode: 'reps_weight',
      unilateral: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await db.workoutTemplates.add({
      id: 'template-1',
      name: 'Einheit A',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await db.workoutTemplateExercises.add({
      id: 'template-exercise-1',
      templateId: 'template-1',
      exerciseId: 'exercise-1',
      orderIndex: 1,
      workSetCount: 3,
      targetReps: 5,
      targetWeight: 80,
      notes: 'Basis',
    });
    await db.programs.add({
      id: 'program-1',
      name: 'Block A',
      activeWeek: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await db.programWeeks.bulkAdd([
      { id: 'week-1', programId: 'program-1', weekNumber: 1, label: 'Woche 1' },
      { id: 'week-2', programId: 'program-1', weekNumber: 2, label: 'Woche 2' },
      { id: 'week-3', programId: 'program-1', weekNumber: 3, label: 'Woche 3' },
    ]);
    await db.appSettings.add({
      id: 'app-settings',
      activeProgramId: 'program-1',
      exportSchemaVersion: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await db.progressionRules.add({
      id: 'rule-1',
      templateExerciseId: 'template-exercise-1',
      programWeekId: 'week-3',
      targetReps: 7,
      targetWeight: 87.5,
      notes: 'Woche 3',
    });

    const sessionId = await startSessionFromTemplate('template-1');
    const session = await db.workoutSessions.get(sessionId);
    const sessionExercise = await db.workoutSessionExercises
      .where('sessionId')
      .equals(sessionId)
      .first();

    expect(session).toMatchObject({
      resolvedProgramWeek: 3,
      templateNameSnapshot: 'Einheit A',
      programNameSnapshot: 'Block A',
      programWeekLabelSnapshot: 'Woche 3',
      usedWeekOverride: false,
    });
    expect(sessionExercise).toMatchObject({
      targetReps: 7,
      targetWeight: 87.5,
      notes: 'Woche 3',
    });
  });

  it('marks session snapshots that started from a week override', async () => {
    await db.exercises.add({
      id: 'exercise-2',
      name: 'Bench Press',
      trackingMode: 'reps_weight',
      unilateral: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await db.workoutTemplates.add({
      id: 'template-2',
      name: 'Einheit B',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await db.workoutTemplateExercises.add({
      id: 'template-exercise-2',
      templateId: 'template-2',
      exerciseId: 'exercise-2',
      orderIndex: 1,
      workSetCount: 3,
      targetReps: 8,
    });
    await db.programs.add({
      id: 'program-2',
      name: 'Block Override',
      activeWeek: 2,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await db.programWeeks.bulkAdd([
      { id: 'program-2-week-1', programId: 'program-2', weekNumber: 1, label: 'Woche 1' },
      { id: 'program-2-week-2', programId: 'program-2', weekNumber: 2, label: 'Woche 2' },
      { id: 'program-2-week-3', programId: 'program-2', weekNumber: 3, label: 'Peak' },
    ]);
    await db.appSettings.add({
      id: 'app-settings',
      activeProgramId: 'program-2',
      weekOverride: 3,
      exportSchemaVersion: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const sessionId = await startSessionFromTemplate('template-2');
    const session = await db.workoutSessions.get(sessionId);

    expect(session).toMatchObject({
      resolvedProgramWeek: 3,
      programNameSnapshot: 'Block Override',
      programWeekLabelSnapshot: 'Peak',
      usedWeekOverride: true,
    });
  });
});

describe('exercise media actions', () => {
  it('replaces and clears exercise media while cleaning up orphaned assets', async () => {
    await db.exercises.add({
      id: 'exercise-media',
      name: 'Face Pull',
      trackingMode: 'reps_weight',
      unilateral: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const firstMediaAssetId = await replaceExerciseMedia({
      exerciseId: 'exercise-media',
      file: new Blob(['first'], { type: 'image/png' }),
      fileName: 'first.png',
      mimeType: 'image/png',
    });

    const secondMediaAssetId = await replaceExerciseMedia({
      exerciseId: 'exercise-media',
      file: new Blob(['second'], { type: 'image/webp' }),
      fileName: 'second.webp',
      mimeType: 'image/webp',
    });

    const updatedExercise = await db.exercises.get('exercise-media');
    expect(updatedExercise?.mediaAssetId).toBe(secondMediaAssetId);
    expect(await db.mediaAssets.get(firstMediaAssetId)).toBeUndefined();
    expect(await db.mediaAssets.get(secondMediaAssetId)).toMatchObject({
      fileName: 'second.webp',
      mimeType: 'image/webp',
    });

    await clearExerciseMedia('exercise-media');

    const clearedExercise = await db.exercises.get('exercise-media');
    expect(clearedExercise?.mediaAssetId).toBeUndefined();
    expect(await db.mediaAssets.get(secondMediaAssetId)).toBeUndefined();
  });
});

describe('closing a session', () => {
  async function seedActiveSession(id: string) {
    await db.workoutSessions.add({
      id,
      templateId: 'template-close',
      templateNameSnapshot: 'Einheit Close',
      resolvedProgramWeek: 1,
      startedAt: '2026-01-10T09:00:00.000Z',
      status: 'active',
      restTimerEndsAt: Date.now() + 60_000,
    });
  }

  it('aborts an active session and clears the rest timer', async () => {
    await seedActiveSession('session-abort');

    await abortSession('session-abort');

    const session = await db.workoutSessions.get('session-abort');
    expect(session?.status).toBe('aborted');
    expect(session?.completedAt).toBeTruthy();
    expect(session?.restTimerEndsAt).toBeUndefined();
  });

  it('does not overwrite an already closed session', async () => {
    await seedActiveSession('session-double');

    await completeSession('session-double');
    const firstClose = await db.workoutSessions.get('session-double');

    await completeSession('session-double');
    await abortSession('session-double');

    const afterRepeats = await db.workoutSessions.get('session-double');
    expect(afterRepeats?.status).toBe('completed');
    expect(afterRepeats?.completedAt).toBe(firstClose?.completedAt);
  });

  it('rejects closing a session that does not exist', async () => {
    await expect(completeSession('missing-session')).rejects.toThrow('Session nicht gefunden');
  });
});

describe('starting a session', () => {
  async function seedTemplate() {
    await db.exercises.add({
      id: 'exercise-race',
      name: 'Deadlift',
      trackingMode: 'reps_weight',
      unilateral: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await db.workoutTemplates.add({
      id: 'template-race',
      name: 'Einheit Race',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await db.workoutTemplateExercises.add({
      id: 'template-exercise-race',
      templateId: 'template-race',
      exerciseId: 'exercise-race',
      orderIndex: 1,
      workSetCount: 2,
      targetReps: 5,
    });
  }

  it('creates only one active session when started twice at once', async () => {
    await seedTemplate();

    const [first, second] = await Promise.all([
      startSessionFromTemplate('template-race'),
      startSessionFromTemplate('template-race'),
    ]);

    const activeSessions = await db.workoutSessions.where('status').equals('active').toArray();

    expect(activeSessions).toHaveLength(1);
    expect(first).toBe(second);
    expect(activeSessions[0].id).toBe(first);
  });
});
