import { describe, expect, it } from 'vitest';
import { pickLastCompletedExecution, sortSetLogs, type ExerciseExecution } from '@/domain/history';
import type { WorkoutSetLog } from '@/domain/models';

function workLog(overrides: Partial<WorkoutSetLog>): WorkoutSetLog {
  return {
    id: crypto.randomUUID(),
    sessionExerciseId: 'session-exercise-1',
    setKind: 'work',
    side: 'both',
    setNumber: 1,
    completed: true,
    ...overrides,
  };
}

function execution(overrides: Partial<ExerciseExecution>): ExerciseExecution {
  return {
    sessionExerciseId: 'session-exercise-1',
    exerciseId: 'exercise-1',
    sessionId: 'session-1',
    completedAt: '2026-01-01T10:00:00.000Z',
    workLogs: [workLog({})],
    ...overrides,
  };
}

describe('sortSetLogs', () => {
  it('orders warmup first, then by set number, then left before right', () => {
    const sorted = sortSetLogs([
      workLog({ id: 'b', setNumber: 2, side: 'right' }),
      workLog({ id: 'c', setKind: 'warmup', setNumber: 0 }),
      workLog({ id: 'a', setNumber: 2, side: 'left' }),
      workLog({ id: 'd', setNumber: 1, side: 'left' }),
    ]);

    expect(sorted.map((log) => log.id)).toEqual(['c', 'd', 'a', 'b']);
  });

  it('does not mutate the input array', () => {
    const logs = [workLog({ id: 'second', setNumber: 2 }), workLog({ id: 'first', setNumber: 1 })];
    sortSetLogs(logs);

    expect(logs.map((log) => log.id)).toEqual(['second', 'first']);
  });
});

describe('pickLastCompletedExecution', () => {
  it('skips a more recent execution that has no logged work sets', () => {
    const withValues = execution({
      sessionExerciseId: 'older-with-values',
      completedAt: '2026-01-01T10:00:00.000Z',
      workLogs: [workLog({ weight: 100 })],
    });
    const skipped = execution({
      sessionExerciseId: 'newer-but-skipped',
      completedAt: '2026-01-08T10:00:00.000Z',
      workLogs: [],
    });

    expect(pickLastCompletedExecution([withValues, skipped])?.sessionExerciseId).toBe(
      'older-with-values',
    );
  });

  it('returns the most recent execution that has values', () => {
    const older = execution({ sessionExerciseId: 'older', completedAt: '2026-01-01T10:00:00.000Z' });
    const newer = execution({ sessionExerciseId: 'newer', completedAt: '2026-01-08T10:00:00.000Z' });

    expect(pickLastCompletedExecution([older, newer])?.sessionExerciseId).toBe('newer');
  });

  it('returns undefined when no execution has values', () => {
    expect(pickLastCompletedExecution([execution({ workLogs: [] })])).toBeUndefined();
    expect(pickLastCompletedExecution([])).toBeUndefined();
  });
});
