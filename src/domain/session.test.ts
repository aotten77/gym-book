import { describe, expect, it } from 'vitest';
import { calculateAsymmetryPercent, materializeSession } from '@/domain/session';
import type { Exercise, WorkoutTemplate, WorkoutTemplateExercise } from '@/domain/models';

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
});

describe('calculateAsymmetryPercent', () => {
  it('returns the percentage delta based on the larger side', () => {
    expect(calculateAsymmetryPercent(22, 24)).toBe(8.3);
  });

  it('returns zero when both sides are zero', () => {
    expect(calculateAsymmetryPercent(0, 0)).toBe(0);
  });
});
