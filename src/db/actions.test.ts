import { describe, expect, it } from 'vitest';
import { db } from '@/db/appDb';
import {
  abortSession,
  addSessionExercise,
  completeSession,
  deleteSetLog,
  groupSessionExerciseWithPrevious,
  reorderSessionExercises,
  startSessionFromTemplate,
  toggleSetCompletion,
  ungroupSessionExercise,
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
import {
  clearWeekOverride,
  setActiveProgram,
  setKeepScreenAwakeEnabled,
  setTimerSoundEnabled,
  setWeekOverride,
} from '@/db/settings-actions';
import {
  clearProgressionRule,
  deleteTemplateExercise,
  groupTemplateExerciseWithPrevious,
  reorderTemplateExercises,
  saveProgressionRule,
  ungroupTemplateExercise,
} from '@/db/template-actions';
import { seedRestSession } from '@/test/session-fixtures';

describe('addSessionExercise', () => {
  it('appends an existing unilateral exercise and mirrors warmup and work sets', async () => {
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
    expect(setLogs).toHaveLength(6);
    expect(
      setLogs
        .filter((item) => item.setKind === 'warmup')
        .map((item) => item.side)
        .sort(),
    ).toEqual(['left', 'right']);
    expect(setLogs.filter((item) => item.setKind === 'work' && item.side === 'left')).toHaveLength(2);
    expect(setLogs.filter((item) => item.setKind === 'work' && item.side === 'right')).toHaveLength(2);
    expect(await db.exercises.count()).toBe(1);
  });

  it('lässt den Warmup-Satz weg, wenn er abgewählt wurde', async () => {
    await db.workoutSessions.add({
      id: 'session-ohne-warmup',
      templateId: 'template-1',
      templateNameSnapshot: 'Einheit A',
      resolvedProgramWeek: 1,
      startedAt: '2026-01-08T09:00:00.000Z',
      status: 'active',
    });

    await db.exercises.add({
      id: 'exercise-hip-thrust',
      name: 'Hip Thrust',
      trackingMode: 'reps_weight',
      unilateral: false,
      createdAt: '2026-01-08T09:00:00.000Z',
      updatedAt: '2026-01-08T09:00:00.000Z',
    });

    const sessionExerciseId = await addSessionExercise({
      sessionId: 'session-ohne-warmup',
      exerciseId: 'exercise-hip-thrust',
      workSetCount: 3,
      includeWarmup: false,
    });

    const setLogs = await db.workoutSetLogs.where('sessionExerciseId').equals(sessionExerciseId).toArray();

    expect(setLogs).toHaveLength(3);
    expect(setLogs.filter((item) => item.setKind === 'warmup')).toHaveLength(0);
  });

  it('legt keine Übung nebenbei an, sondern verlangt eine bestehende', async () => {
    await db.workoutSessions.add({
      id: 'session-2',
      templateId: 'template-2',
      templateNameSnapshot: 'Einheit B',
      resolvedProgramWeek: 5,
      startedAt: '2026-01-08T10:00:00.000Z',
      status: 'active',
    });

    // Es gibt genau einen validierenden Schreibweg auf `db.exercises`, und der
    // liegt in `exercise-actions.ts`. Eine unbekannte Id ist hier ein Fehler,
    // keine Einladung, still eine Übung zu erfinden.
    await expect(
      addSessionExercise({
        sessionId: 'session-2',
        exerciseId: 'gibt-es-nicht',
        workSetCount: 3,
        targetSeconds: 30,
      }),
    ).rejects.toThrow(/Exercise not found/);

    expect(await db.exercises.count()).toBe(0);
    expect(
      await db.workoutSessionExercises.where('sessionId').equals('session-2').count(),
    ).toBe(0);
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

  it('stores a switched-off timer sound as false, not as a missing key', async () => {
    // Ohne Eintrag zählt der Ton als eingeschaltet - ein Aus muss davon
    // unterscheidbar bleiben.
    await setTimerSoundEnabled(false);

    const off = await db.appSettings.get('app-settings');
    expect(off?.timerSoundEnabled).toBe(false);

    await setTimerSoundEnabled(true);

    const on = await db.appSettings.get('app-settings');
    expect(on?.timerSoundEnabled).toBe(true);
  });

  it('keeps the other settings when toggling the timer sound', async () => {
    await setWeekOverride(2);

    await setTimerSoundEnabled(false);

    const settings = await db.appSettings.get('app-settings');
    expect(settings?.weekOverride).toBe(2);
  });

  it('stores a switched-off screen wake lock as false and leaves the sound alone', async () => {
    // Dieselbe additive Regel wie beim Ton, und die beiden Schalter der
    // Sektion dürfen sich nicht gegenseitig überschreiben.
    await setTimerSoundEnabled(false);
    await setKeepScreenAwakeEnabled(false);

    const off = await db.appSettings.get('app-settings');
    expect(off?.keepScreenAwakeEnabled).toBe(false);
    expect(off?.timerSoundEnabled).toBe(false);

    await setKeepScreenAwakeEnabled(true);

    const on = await db.appSettings.get('app-settings');
    expect(on?.keepScreenAwakeEnabled).toBe(true);
    expect(on?.timerSoundEnabled).toBe(false);
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

  it('keeps a rule whose only content is the upper rep range', async () => {
    /*
     * Die Lösch-Bedingung in `saveProgressionRule` kennt jedes Feld einzeln -
     * ein neues, das sie nicht mitzählt, verschwindet beim Speichern still.
     * Genau das hat Band- und Höhen-Progression schon einmal getroffen.
     */
    await saveProgressionRule({
      templateExerciseId: 'template-exercise-2',
      programWeekId: 'week-1',
      targetRepsMax: 12,
    });

    const created = await db.progressionRules
      .where('templateExerciseId')
      .equals('template-exercise-2')
      .first();

    expect(created).toMatchObject({ targetRepsMax: 12, targetReps: undefined });
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
      targetRepsMax: 8,
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
      // Die Regel gibt nur den unteren Rand vor - die Decke kommt weiter aus
      // dem Workout, statt mit der Regel zu verschwinden.
      targetRepsMax: 8,
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
      restTimers: [
        {
          sessionExerciseId: 'session-exercise-close',
          side: 'both',
          endsAt: Date.now() + 60_000,
          durationSeconds: 90,
        },
      ],
    });
  }

  it('aborts an active session and clears the rest timer', async () => {
    await seedActiveSession('session-abort');

    await abortSession('session-abort');

    const session = await db.workoutSessions.get('session-abort');
    expect(session?.status).toBe('aborted');
    expect(session?.completedAt).toBeTruthy();
    expect(session?.restTimers).toBeUndefined();
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

describe('deleteSetLog', () => {
  async function seedSetLog(status: 'active' | 'completed') {
    await db.workoutSessions.add({
      id: `session-delete-${status}`,
      templateId: 'template-1',
      templateNameSnapshot: 'Einheit A',
      resolvedProgramWeek: 1,
      startedAt: '2026-01-08T09:00:00.000Z',
      status,
    });

    await db.workoutSessionExercises.add({
      id: `session-exercise-delete-${status}`,
      sessionId: `session-delete-${status}`,
      exerciseId: 'exercise-1',
      exerciseNameSnapshot: 'Split Squat',
      trackingMode: 'reps_weight',
      unilateral: true,
      orderIndex: 1,
      wasSkipped: false,
      addedInSession: false,
      workSetCount: 1,
    });

    await db.workoutSetLogs.bulkAdd([
      {
        id: `warmup-${status}`,
        sessionExerciseId: `session-exercise-delete-${status}`,
        setKind: 'warmup',
        side: 'both',
        setNumber: 0,
        completed: false,
      },
      {
        id: `links-${status}`,
        sessionExerciseId: `session-exercise-delete-${status}`,
        setKind: 'work',
        side: 'left',
        setNumber: 1,
        completed: false,
      },
      {
        id: `rechts-${status}`,
        sessionExerciseId: `session-exercise-delete-${status}`,
        setKind: 'work',
        side: 'right',
        setNumber: 1,
        completed: false,
      },
    ]);
  }

  it('entfernt genau eine Zeile und lässt die Gegenseite stehen', async () => {
    await seedSetLog('active');

    await deleteSetLog('links-active');

    const remaining = await db.workoutSetLogs
      .where('sessionExerciseId')
      .equals('session-exercise-delete-active')
      .toArray();

    expect(remaining.map((item) => item.id).sort()).toEqual(['rechts-active', 'warmup-active']);
  });

  it('rührt abgeschlossene Sessions nicht an', async () => {
    await seedSetLog('completed');

    await deleteSetLog('warmup-completed');

    expect(await db.workoutSetLogs.get('warmup-completed')).toBeDefined();
  });
});

describe('Supersätze in der Session', () => {
  it('verbindet eine Übung mit ihrer Vorgängerin', async () => {
    await seedRestSession();

    await groupSessionExerciseWithPrevious('exercise-b');

    const exercises = await db.workoutSessionExercises
      .where('sessionId')
      .equals('session-rest')
      .sortBy('orderIndex');
    expect(exercises[0].supersetGroupId).toBeTruthy();
    expect(exercises[1].supersetGroupId).toBe(exercises[0].supersetGroupId);
    expect(exercises[2].supersetGroupId).toBeUndefined();
  });

  it('löst eine Verbindung wieder', async () => {
    await seedRestSession();
    await groupSessionExerciseWithPrevious('exercise-b');

    await ungroupSessionExercise('exercise-b');

    const exercises = await db.workoutSessionExercises
      .where('sessionId')
      .equals('session-rest')
      .sortBy('orderIndex');
    expect(exercises.every((item) => item.supersetGroupId === undefined)).toBe(true);
  });

  it('rührt eine abgeschlossene Session nicht an', async () => {
    await seedRestSession('completed');

    await groupSessionExerciseWithPrevious('exercise-b');

    expect((await db.workoutSessionExercises.get('exercise-b'))?.supersetGroupId).toBeUndefined();
  });

  it('verweigert eine Reihenfolge, die den Supersatz zerreißt', async () => {
    await seedRestSession();
    await groupSessionExerciseWithPrevious('exercise-b');

    await reorderSessionExercises('session-rest', ['exercise-a', 'exercise-c', 'exercise-b']);

    const exercises = await db.workoutSessionExercises
      .where('sessionId')
      .equals('session-rest')
      .sortBy('orderIndex');
    expect(exercises.map((item) => item.id)).toEqual(['exercise-a', 'exercise-b', 'exercise-c']);
  });

  it('erlaubt das Verschieben der Gruppe am Stück', async () => {
    await seedRestSession();
    await groupSessionExerciseWithPrevious('exercise-b');

    await reorderSessionExercises('session-rest', ['exercise-c', 'exercise-a', 'exercise-b']);

    const exercises = await db.workoutSessionExercises
      .where('sessionId')
      .equals('session-rest')
      .sortBy('orderIndex');
    expect(exercises.map((item) => item.id)).toEqual(['exercise-c', 'exercise-a', 'exercise-b']);
  });
});

describe('Supersätze im Template', () => {
  async function seedTemplateExercises() {
    await db.workoutTemplates.add({
      id: 'template-superset',
      name: 'Einheit Supersatz',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    await db.exercises.bulkAdd(
      ['ex-1', 'ex-2', 'ex-3'].map((id) => ({
        id,
        name: id,
        trackingMode: 'reps_weight' as const,
        unilateral: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })),
    );

    await db.workoutTemplateExercises.bulkAdd(
      ['ex-1', 'ex-2', 'ex-3'].map((exerciseId, index) => ({
        id: `template-exercise-${index + 1}`,
        templateId: 'template-superset',
        exerciseId,
        orderIndex: index + 1,
        workSetCount: 3,
      })),
    );
  }

  async function templateGroupIds() {
    const items = await db.workoutTemplateExercises
      .where('templateId')
      .equals('template-superset')
      .sortBy('orderIndex');

    return items.map((item) => item.supersetGroupId);
  }

  it('verbindet und löst geplante Übungen', async () => {
    await seedTemplateExercises();

    await groupTemplateExerciseWithPrevious('template-exercise-2');
    const [first, second, third] = await templateGroupIds();
    expect(first).toBeTruthy();
    expect(second).toBe(first);
    expect(third).toBeUndefined();

    await ungroupTemplateExercise('template-exercise-2');
    expect(await templateGroupIds()).toEqual([undefined, undefined, undefined]);
  });

  it('nimmt eine dritte Übung in die bestehende Gruppe auf', async () => {
    await seedTemplateExercises();
    await groupTemplateExerciseWithPrevious('template-exercise-2');

    await groupTemplateExerciseWithPrevious('template-exercise-3');

    const groupIds = await templateGroupIds();
    expect(new Set(groupIds).size).toBe(1);
  });

  it('löst eine Restgruppe auf, wenn ein Partner gelöscht wird', async () => {
    await seedTemplateExercises();
    await groupTemplateExerciseWithPrevious('template-exercise-2');

    await deleteTemplateExercise('template-exercise-1');

    expect(await templateGroupIds()).toEqual([undefined, undefined]);
  });

  it('verweigert eine Reihenfolge, die den Supersatz zerreißt', async () => {
    await seedTemplateExercises();
    await groupTemplateExerciseWithPrevious('template-exercise-2');

    await reorderTemplateExercises('template-superset', [
      'template-exercise-1',
      'template-exercise-3',
      'template-exercise-2',
    ]);

    const items = await db.workoutTemplateExercises
      .where('templateId')
      .equals('template-superset')
      .sortBy('orderIndex');
    expect(items.map((item) => item.id)).toEqual([
      'template-exercise-1',
      'template-exercise-2',
      'template-exercise-3',
    ]);
  });

  it('überträgt die Gruppe beim Start in die Session', async () => {
    await seedTemplateExercises();
    await groupTemplateExerciseWithPrevious('template-exercise-2');

    const sessionId = await startSessionFromTemplate('template-superset');
    const sessionExercises = await db.workoutSessionExercises
      .where('sessionId')
      .equals(sessionId)
      .sortBy('orderIndex');

    expect(sessionExercises[0].supersetGroupId).toBeTruthy();
    expect(sessionExercises[1].supersetGroupId).toBe(sessionExercises[0].supersetGroupId);
    expect(sessionExercises[2].supersetGroupId).toBeUndefined();
  });
});

describe('Höhe als Einheit', () => {
  async function seedHeightExercise() {
    await db.exercises.add({
      id: 'exercise-step-down',
      name: 'Step-Down',
      trackingMode: 'reps_weight',
      tracksHeight: true,
      unilateral: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await db.workoutTemplates.add({
      id: 'template-height',
      name: 'Unterkörper',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await db.workoutTemplateExercises.add({
      id: 'template-exercise-height',
      templateId: 'template-height',
      exerciseId: 'exercise-step-down',
      orderIndex: 1,
      workSetCount: 2,
      includeWarmup: false,
      targetReps: 8,
      targetHeightCm: 20,
    });
  }

  it('friert Schalter und Ziel-Höhe im Session-Snapshot ein', async () => {
    await seedHeightExercise();

    const sessionId = await startSessionFromTemplate('template-height');
    const sessionExercise = await db.workoutSessionExercises
      .where('sessionId')
      .equals(sessionId)
      .first();

    expect(sessionExercise).toMatchObject({ tracksHeight: true, targetHeightCm: 20 });
  });

  it('lässt die Wochenprogression die Ziel-Höhe überschreiben', async () => {
    await seedHeightExercise();
    await db.programs.add({
      id: 'program-height',
      name: 'Block Höhe',
      activeWeek: 2,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await db.programWeeks.bulkAdd([
      { id: 'height-week-1', programId: 'program-height', weekNumber: 1 },
      { id: 'height-week-2', programId: 'program-height', weekNumber: 2 },
    ]);
    await db.appSettings.put({
      id: 'app-settings',
      activeProgramId: 'program-height',
      exportSchemaVersion: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await saveProgressionRule({
      templateExerciseId: 'template-exercise-height',
      programWeekId: 'height-week-2',
      targetHeightCm: 25,
    });

    const sessionId = await startSessionFromTemplate('template-height');
    const sessionExercise = await db.workoutSessionExercises
      .where('sessionId')
      .equals(sessionId)
      .first();

    // Die Höhe allein trägt die Regel: eine Progression, die nur die Stufe
    // erhöht, darf beim Speichern nicht als "leer" verschwinden.
    expect(sessionExercise).toMatchObject({ targetHeightCm: 25, targetReps: 8 });
  });

  it('schreibt die erreichte Höhe in den Satz, ohne andere Werte anzufassen', async () => {
    await seedHeightExercise();

    const sessionId = await startSessionFromTemplate('template-height');
    const sessionExercise = await db.workoutSessionExercises
      .where('sessionId')
      .equals(sessionId)
      .first();
    const setLog = await db.workoutSetLogs
      .where('sessionExerciseId')
      .equals(sessionExercise!.id)
      .first();

    await updateSetLogValues(setLog!.id, { heightCm: 25, reps: 8 });
    await updateSetLogValues(setLog!.id, { reps: 6 });

    expect(await db.workoutSetLogs.get(setLog!.id)).toMatchObject({ heightCm: 25, reps: 6 });

    // Ein bewusst geleertes Feld verschwindet - anders als ein Feld, das gar
    // nicht im Input steht.
    await updateSetLogValues(setLog!.id, { heightCm: undefined });

    expect((await db.workoutSetLogs.get(setLog!.id))?.heightCm).toBeUndefined();
  });

  it('übernimmt den Höhen-Schalter der Übung beim Ergänzen in der Session', async () => {
    await seedHeightExercise();

    const sessionId = await startSessionFromTemplate('template-height');
    const sessionExerciseId = await addSessionExercise({
      sessionId,
      workSetCount: 2,
      exerciseId: 'exercise-step-down',
      targetHeightCm: 30,
    });

    expect(await db.workoutSessionExercises.get(sessionExerciseId)).toMatchObject({
      tracksHeight: true,
      targetHeightCm: 30,
    });
  });
});
