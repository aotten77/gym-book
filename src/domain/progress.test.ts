import { describe, expect, it } from 'vitest';
import { buildProgressSeries, progressMetricFor, summarizeTrend } from '@/domain/progress';
import type { WorkoutSetLog } from '@/domain/models';

function log(overrides: Partial<WorkoutSetLog>): WorkoutSetLog {
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

describe('progressMetricFor', () => {
  it('tracks seconds for pure time exercises and weight otherwise', () => {
    expect(progressMetricFor('time').key).toBe('seconds');
    expect(progressMetricFor('time_weight').key).toBe('weight');
    expect(progressMetricFor('reps_weight').key).toBe('weight');
  });

  it('tracks the band level when the exercise is loaded with bands', () => {
    expect(progressMetricFor('reps_weight', 'band').key).toBe('band');
    expect(progressMetricFor('reps_weight', 'weight').key).toBe('weight');
    // Zeit ohne Last bleibt Zeit, auch wenn irrtümlich ein Band gesetzt ist.
    expect(progressMetricFor('time', 'band').key).toBe('seconds');
  });
});

describe('buildProgressSeries', () => {
  it('uses the best working set per execution and sorts chronologically', () => {
    const series = buildProgressSeries(
      [
        {
          completedAt: '2026-02-01T10:00:00.000Z',
          workLogs: [log({ weight: 90, reps: 5 }), log({ weight: 95, reps: 3 })],
        },
        {
          completedAt: '2026-01-01T10:00:00.000Z',
          workLogs: [log({ weight: 80, reps: 5 })],
        },
      ],
      'reps_weight',
    );

    expect(series.map((point) => point.topValue)).toEqual([80, 95]);
    expect(series[0].completedAt).toBe('2026-01-01T10:00:00.000Z');
  });

  it('takes the better side rather than the sum for unilateral work', () => {
    const series = buildProgressSeries(
      [
        {
          completedAt: '2026-01-01T10:00:00.000Z',
          workLogs: [
            log({ side: 'left', weight: 20, reps: 8 }),
            log({ side: 'right', weight: 22.5, reps: 8 }),
          ],
        },
      ],
      'reps_weight',
    );

    expect(series[0].topValue).toBe(22.5);
  });

  it('skips executions without usable values', () => {
    const series = buildProgressSeries(
      [
        { completedAt: '2026-01-01T10:00:00.000Z', workLogs: [] },
        { completedAt: '2026-01-08T10:00:00.000Z', workLogs: [log({ reps: 5 })] },
        { completedAt: '2026-01-15T10:00:00.000Z', workLogs: [log({ weight: 60, reps: 5 })] },
      ],
      'reps_weight',
    );

    expect(series).toHaveLength(1);
    expect(series[0].topValue).toBe(60);
  });

  it('turns bands into their rank in the catalogue', () => {
    const bandRank = (bandId: string) => ({ 'band-gelb': 1, 'band-rot': 2, 'band-gruen': 3 })[bandId];

    const series = buildProgressSeries(
      [
        {
          completedAt: '2026-01-01T10:00:00.000Z',
          workLogs: [log({ bandId: 'band-gelb', reps: 12 }), log({ bandId: 'band-rot', reps: 8 })],
        },
        {
          completedAt: '2026-01-08T10:00:00.000Z',
          workLogs: [log({ bandId: 'band-gruen', reps: 8 })],
        },
      ],
      'reps_weight',
      { loadKind: 'band', bandRank },
    );

    expect(series.map((point) => point.topValue)).toEqual([2, 3]);
    // Ohne Kilo gibt es kein Volumen, das man ausrechnen könnte.
    expect(series[0].volume).toBe(0);
  });

  it('drops sets whose band is no longer in the catalogue', () => {
    const series = buildProgressSeries(
      [
        {
          completedAt: '2026-01-01T10:00:00.000Z',
          workLogs: [log({ bandId: 'band-geloescht', reps: 10 })],
        },
        {
          completedAt: '2026-01-08T10:00:00.000Z',
          workLogs: [log({ bandId: 'band-gelb', reps: 10 })],
        },
      ],
      'reps_weight',
      { loadKind: 'band', bandRank: (bandId) => (bandId === 'band-gelb' ? 1 : undefined) },
    );

    expect(series).toHaveLength(1);
    expect(series[0].completedAt).toBe('2026-01-08T10:00:00.000Z');
  });
});

describe('summarizeTrend', () => {
  it('reports the delta between first and last point', () => {
    const trend = summarizeTrend([
      { completedAt: '2026-01-01T10:00:00.000Z', topValue: 80, volume: 400, setCount: 3 },
      { completedAt: '2026-02-01T10:00:00.000Z', topValue: 90, volume: 450, setCount: 3 },
    ]);

    expect(trend).toEqual({ first: 80, last: 90, delta: 10, percent: 12.5 });
  });

  it('needs at least two points', () => {
    expect(
      summarizeTrend([
        { completedAt: '2026-01-01T10:00:00.000Z', topValue: 80, volume: 400, setCount: 3 },
      ]),
    ).toBeUndefined();
  });
});
