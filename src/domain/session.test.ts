import { describe, expect, it } from 'vitest';
import { calculateAsymmetryPercent, materializeSession } from '@/domain/session';
import type { Exercise, ProgressionRule, WorkoutTemplate, WorkoutTemplateExercise } from '@/domain/models';

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

describe('calculateAsymmetryPercent', () => {
  it('returns the percentage delta based on the larger side', () => {
    expect(calculateAsymmetryPercent(22, 24)).toBe(8.3);
  });

  it('returns zero when both sides are zero', () => {
    expect(calculateAsymmetryPercent(0, 0)).toBe(0);
  });
});
