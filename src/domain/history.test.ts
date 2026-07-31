import { describe, expect, it } from 'vitest';
import {
  buildLastSetValues,
  pickLastCompletedExecution,
  sortSetLogs,
  type ExerciseExecution,
} from '@/domain/history';
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

describe('buildLastSetValues', () => {
  it('findet die Werte derselben Satzzeile inklusive Warmup', () => {
    const lastValues = buildLastSetValues([
      workLog({ setKind: 'warmup', setNumber: 0, reps: 10, weight: 40 }),
      workLog({ setNumber: 1, reps: 5, weight: 82.5 }),
      workLog({ setNumber: 2, reps: 5, weight: 85 }),
    ]);

    expect(lastValues.resolve({ setKind: 'warmup', side: 'both', setNumber: 0 })).toEqual({
      reps: 10,
      seconds: undefined,
      weight: 40,
    });
    expect(lastValues.resolve({ setKind: 'work', side: 'both', setNumber: 2 })?.weight).toBe(85);
  });

  it('reicht auch das Band der letzten Ausführung durch', () => {
    const lastValues = buildLastSetValues([
      workLog({ setNumber: 1, reps: 15, bandId: 'band-rot', bandNameSnapshot: 'rot' }),
    ]);

    expect(lastValues.resolve({ setKind: 'work', side: 'both', setNumber: 1 })).toMatchObject({
      bandId: 'band-rot',
      bandNameSnapshot: 'rot',
    });
  });

  it('fällt auf den letzten Arbeitssatz derselben Seite zurück', () => {
    const lastValues = buildLastSetValues([
      workLog({ setNumber: 1, side: 'left', reps: 8 }),
      workLog({ setNumber: 2, side: 'left', reps: 7 }),
      workLog({ setNumber: 1, side: 'right', reps: 9 }),
    ]);

    // Satz 3 gab es letzte Woche noch nicht - die Vorlage hat seitdem einen
    // Arbeitssatz mehr.
    expect(lastValues.resolve({ setKind: 'work', side: 'left', setNumber: 3 })?.reps).toBe(7);
    expect(lastValues.resolve({ setKind: 'work', side: 'right', setNumber: 3 })?.reps).toBe(9);
  });

  it('erfindet keinen Warmup-Wert aus Arbeitssätzen', () => {
    const lastValues = buildLastSetValues([workLog({ setNumber: 1, reps: 5, weight: 82.5 })]);

    expect(lastValues.resolve({ setKind: 'warmup', side: 'both', setNumber: 0 })).toBeUndefined();
  });
});
