import { describe, expect, it } from 'vitest';
import {
  calculateAsymmetryPercent,
  findNextOpenExercise,
  hasOpenSets,
  materializeSession,
} from '@/domain/session';
import type {
  Exercise,
  ProgressionRule,
  WorkoutSessionExercise,
  WorkoutSetLog,
  WorkoutTemplate,
  WorkoutTemplateExercise,
} from '@/domain/models';

describe('materializeSession', () => {
  it('creates exactly one warmup set and mirrored unilateral work sets', () => {
    const template: WorkoutTemplate = {
      id: 'template-1',
      name: 'Einheit A',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const exercises: Record<string, Exercise> = {
      squat: {
        id: 'squat',
        name: 'Split Squat',
        trackingMode: 'reps_weight',
        unilateral: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    };

    const templateExercises: WorkoutTemplateExercise[] = [
      {
        id: 'template-exercise-1',
        templateId: template.id,
        exerciseId: 'squat',
        orderIndex: 1,
        workSetCount: 2,
        targetReps: 8,
      },
    ];

    const bundle = materializeSession({
      template,
      templateExercises,
      exercisesById: exercises,
      resolvedProgramWeek: 3,
      startedAt: '2026-01-08T09:00:00.000Z',
    });

    expect(bundle.session.templateNameSnapshot).toBe('Einheit A');
    expect(bundle.sessionExercises).toHaveLength(1);
    expect(bundle.setLogs.filter((item) => item.setKind === 'warmup')).toHaveLength(1);
    expect(
      bundle.setLogs.filter((item) => item.setKind === 'work' && item.side === 'left'),
    ).toHaveLength(2);
    expect(
      bundle.setLogs.filter((item) => item.setKind === 'work' && item.side === 'right'),
    ).toHaveLength(2);
  });

  it('skips the warmup set when the template exercise switched it off', () => {
    const template: WorkoutTemplate = {
      id: 'template-1',
      name: 'Einheit A',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const exercises: Record<string, Exercise> = {
      squat: {
        id: 'squat',
        name: 'Front Squat',
        trackingMode: 'reps_weight',
        unilateral: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    };

    const bundle = materializeSession({
      template,
      templateExercises: [
        {
          id: 'template-exercise-1',
          templateId: template.id,
          exerciseId: 'squat',
          orderIndex: 1,
          workSetCount: 3,
          includeWarmup: false,
        },
      ],
      exercisesById: exercises,
      resolvedProgramWeek: 1,
      startedAt: '2026-01-08T09:00:00.000Z',
    });

    expect(bundle.setLogs.filter((item) => item.setKind === 'warmup')).toHaveLength(0);
    expect(bundle.setLogs).toHaveLength(3);
  });

  it('overrides template targets from progression rules for the resolved week snapshot', () => {
    const template: WorkoutTemplate = {
      id: 'template-1',
      name: 'Einheit A',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const exercises: Record<string, Exercise> = {
      squat: {
        id: 'squat',
        name: 'Front Squat',
        trackingMode: 'reps_weight',
        unilateral: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    };

    const templateExercises: WorkoutTemplateExercise[] = [
      {
        id: 'template-exercise-1',
        templateId: template.id,
        exerciseId: 'squat',
        orderIndex: 1,
        workSetCount: 3,
        targetReps: 5,
        targetWeight: 80,
        notes: 'Basis',
      },
    ];

    const progressionRulesByTemplateExerciseId: Record<string, ProgressionRule> = {
      'template-exercise-1': {
        id: 'rule-1',
        templateExerciseId: 'template-exercise-1',
        programWeekId: 'week-4',
        targetReps: 6,
        targetWeight: 85,
        notes: 'Woche 4',
      },
    };

    const bundle = materializeSession({
      template,
      templateExercises,
      exercisesById: exercises,
      progressionRulesByTemplateExerciseId,
      programNameSnapshot: 'Block A',
      programWeekLabelSnapshot: 'Woche 4',
      usedWeekOverride: true,
      resolvedProgramWeek: 4,
      startedAt: '2026-01-08T09:00:00.000Z',
    });

    expect(bundle.session).toMatchObject({
      programNameSnapshot: 'Block A',
      programWeekLabelSnapshot: 'Woche 4',
      usedWeekOverride: true,
    });
    expect(bundle.sessionExercises[0]).toMatchObject({
      targetReps: 6,
      targetWeight: 85,
      notes: 'Woche 4',
    });
  });
});

describe('findNextOpenExercise', () => {
  function createExercise(
    id: string,
    orderIndex: number,
    overrides: Partial<WorkoutSessionExercise> = {},
  ): WorkoutSessionExercise {
    return {
      id,
      sessionId: 'session-1',
      exerciseId: `exercise-${id}`,
      exerciseNameSnapshot: id,
      trackingMode: 'reps_weight',
      unilateral: false,
      orderIndex,
      wasSkipped: false,
      addedInSession: false,
      workSetCount: 1,
      ...overrides,
    };
  }

  function createLog(sessionExerciseId: string, setNumber: number, completed: boolean): WorkoutSetLog {
    return {
      id: `${sessionExerciseId}-${setNumber}`,
      sessionExerciseId,
      setKind: 'work',
      side: 'both',
      setNumber,
      completed,
    };
  }

  const first = createExercise('first', 1);
  const second = createExercise('second', 2);
  const third = createExercise('third', 3);

  it('liefert die nächste Übung, sobald die aktuelle vollständig abgehakt ist', () => {
    const setLogs = [
      createLog('first', 1, true),
      createLog('second', 1, false),
      createLog('third', 1, false),
    ];

    expect(findNextOpenExercise([first, second, third], setLogs, 'first')?.id).toBe('second');
  });

  it('überspringt Übungen, die als übersprungen markiert sind', () => {
    const skipped = createExercise('second', 2, { wasSkipped: true });
    const setLogs = [
      createLog('first', 1, true),
      createLog('second', 1, false),
      createLog('third', 1, false),
    ];

    expect(findNextOpenExercise([first, skipped, third], setLogs, 'first')?.id).toBe('third');
  });

  it('überspringt Übungen, die bereits vollständig abgehakt sind', () => {
    const setLogs = [
      createLog('first', 1, true),
      createLog('second', 1, true),
      createLog('third', 1, false),
    ];

    expect(findNextOpenExercise([first, second, third], setLogs, 'first')?.id).toBe('third');
  });

  it('läuft am Ende der Liste vorn weiter, damit eine offene Übung oben nicht liegenbleibt', () => {
    const setLogs = [
      createLog('first', 1, false),
      createLog('second', 1, true),
      createLog('third', 1, true),
    ];

    expect(findNextOpenExercise([first, second, third], setLogs, 'third')?.id).toBe('first');
  });

  it('gibt undefined zurück, wenn nur noch die aktuelle Übung offen ist', () => {
    const setLogs = [
      createLog('first', 1, false),
      createLog('second', 1, true),
      createLog('third', 1, true),
    ];

    expect(findNextOpenExercise([first, second, third], setLogs, 'first')).toBeUndefined();
  });

  it('gibt undefined zurück, wenn alles erledigt ist', () => {
    const setLogs = [
      createLog('first', 1, true),
      createLog('second', 1, true),
      createLog('third', 1, true),
    ];

    expect(findNextOpenExercise([first, second, third], setLogs, 'first')).toBeUndefined();
  });

  it('behandelt eine Übung ohne Sätze als offen', () => {
    // Ohne Satzzeilen gibt es nichts abzuhaken - übersprungen würde sie sonst
    // nie wieder in den Fokus kommen.
    const setLogs = [createLog('first', 1, true), createLog('third', 1, true)];

    expect(findNextOpenExercise([first, second, third], setLogs, 'first')?.id).toBe('second');
  });
});

describe('hasOpenSets', () => {
  function createLog(sessionExerciseId: string, setNumber: number, completed: boolean): WorkoutSetLog {
    return {
      id: `${sessionExerciseId}-${setNumber}`,
      sessionExerciseId,
      setKind: 'work',
      side: 'both',
      setNumber,
      completed,
    };
  }

  it('meldet offen, solange ein Satz nicht abgehakt ist', () => {
    const setLogs = [createLog('first', 1, true), createLog('first', 2, false)];

    expect(hasOpenSets('first', setLogs)).toBe(true);
  });

  it('meldet erledigt, wenn alle Sätze abgehakt sind', () => {
    const setLogs = [createLog('first', 1, true), createLog('first', 2, true)];

    expect(hasOpenSets('first', setLogs)).toBe(false);
  });

  it('betrachtet nur die Sätze der eigenen Übung', () => {
    // Ein offener Satz einer anderen Übung darf den Fokus nicht festhalten.
    const setLogs = [createLog('first', 1, true), createLog('second', 1, false)];

    expect(hasOpenSets('first', setLogs)).toBe(false);
  });

  it('behandelt eine Übung ohne Sätze als offen', () => {
    expect(hasOpenSets('first', [])).toBe(true);
  });
});

describe('calculateAsymmetryPercent', () => {
  it('returns the percentage delta based on the larger side', () => {
    expect(calculateAsymmetryPercent(22, 24)).toBe(8.3);
  });

  it('returns zero when both sides are zero', () => {
    expect(calculateAsymmetryPercent(0, 0)).toBe(0);
  });
});
