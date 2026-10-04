import { describe, expect, it } from 'vitest';
import type {
  RunLog,
  TrackingMode,
  WorkoutSession,
  WorkoutSessionExercise,
  WorkoutSetLog,
} from '@/domain/models';
import {
  buildWeeklyVolume,
  describeWeekCounts,
  describeWeekVolume,
  hasTraining,
  type WeekVolume,
} from '@/domain/weekly-volume';

/* Alle Daten lokal konstruiert (`new Date(j, m, t, h)`), nicht als UTC-Text. */

function session(
  id: string,
  startedAt: Date,
  completedAt: Date | undefined,
  overrides: Partial<WorkoutSession> = {},
): WorkoutSession {
  return {
    id,
    templateId: 't',
    templateNameSnapshot: 'Einheit',
    resolvedProgramWeek: 1,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt?.toISOString(),
    status: 'completed',
    ...overrides,
  };
}

function exercise(
  id: string,
  sessionId: string,
  trackingMode: TrackingMode = 'reps_weight',
): WorkoutSessionExercise {
  return {
    id,
    sessionId,
    exerciseId: id,
    exerciseNameSnapshot: id,
    trackingMode,
    unilateral: false,
    orderIndex: 1,
    wasSkipped: false,
    addedInSession: false,
    workSetCount: 1,
  };
}

function setLog(
  id: string,
  sessionExerciseId: string,
  overrides: Partial<WorkoutSetLog> = {},
): WorkoutSetLog {
  return {
    id,
    sessionExerciseId,
    setKind: 'work',
    side: 'both',
    setNumber: 1,
    completed: true,
    ...overrides,
  };
}

function run(id: string, date: string, overrides: Partial<RunLog> = {}): RunLog {
  return {
    id,
    date,
    distanceKm: 5,
    durationSeconds: 1800,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const empty: {
  sessions: WorkoutSession[];
  sessionExercises: WorkoutSessionExercise[];
  setLogs: WorkoutSetLog[];
  runs: RunLog[];
} = { sessions: [], sessionExercises: [], setLogs: [], runs: [] };

describe('buildWeeklyVolume', () => {
  it('ordnet einen Sonntagslauf seiner Woche zu', () => {
    const weeks = buildWeeklyVolume({
      ...empty,
      runs: [run('r1', '2026-10-04')],
      from: new Date(2026, 8, 28),
      to: new Date(2026, 9, 5),
    });

    expect(weeks).toHaveLength(2);
    expect(weeks[0].running.runs).toBe(1);
    expect(weeks[1].running.runs).toBe(0);
  });

  it('liefert leere Wochen mit', () => {
    const weeks = buildWeeklyVolume({
      ...empty,
      runs: [run('r1', '2026-10-07')],
      from: new Date(2026, 8, 30),
      to: new Date(2026, 9, 14),
    });

    expect(weeks).toHaveLength(3);
    expect(weeks.map(hasTraining)).toEqual([false, true, false]);
  });

  it('zählt über die Zeitumstellung', () => {
    const weeks = buildWeeklyVolume({
      ...empty,
      from: new Date(2026, 9, 19),
      to: new Date(2026, 10, 2),
    });

    expect(weeks).toHaveLength(3);
    for (const week of weeks) {
      expect(week.weekStart.getDay()).toBe(1);
      expect(week.weekStart.getHours()).toBe(0);
    }
    expect(weeks[2].weekStart.getDate()).toBe(2);
  });

  it('zählt nur abgeschlossene Sessions mit abgehaktem Satz', () => {
    const start = new Date(2026, 9, 5, 18);
    const end = new Date(2026, 9, 5, 19);
    const weeks = buildWeeklyVolume({
      sessions: [
        session('aborted', start, end, { status: 'aborted' }),
        session('open', start, end),
        session('active', start, undefined, { status: 'active' }),
      ],
      sessionExercises: [exercise('e1', 'aborted'), exercise('e2', 'open'), exercise('e3', 'active')],
      setLogs: [
        setLog('l1', 'e1'),
        setLog('l2', 'e2', { completed: false }),
        setLog('l3', 'e3'),
      ],
      runs: [],
      from: start,
      to: start,
    });

    expect(weeks).toHaveLength(1);
    expect(weeks[0].strength.sessions).toBe(0);
    expect(weeks[0].mobility.sessions).toBe(0);
    expect(weeks[0].strength.workSets).toBe(0);
    expect(hasTraining(weeks[0])).toBe(false);
  });

  it('trennt Kraft und Mobility', () => {
    const start = new Date(2026, 9, 5, 18);
    const end = new Date(2026, 9, 5, 19);
    const weeks = buildWeeklyVolume({
      sessions: [
        session('m', start, end, { templateCategorySnapshot: 'mobility' }),
        session('k', start, end),
      ],
      sessionExercises: [exercise('e1', 'm'), exercise('e2', 'k')],
      setLogs: [setLog('l1', 'e1', { weight: 10, reps: 10 }), setLog('l2', 'e2', { weight: 10, reps: 10 })],
      runs: [],
      from: start,
      to: start,
    });

    expect(weeks[0].mobility.sessions).toBe(1);
    expect(weeks[0].strength.sessions).toBe(1);
    // Mobility trägt weder Volumen noch Sätze bei.
    expect(weeks[0].strength.volumeKg).toBe(100);
    expect(weeks[0].strength.workSets).toBe(1);
  });

  it('Dauer ist Start bis Abschluss', () => {
    const weeks = buildWeeklyVolume({
      sessions: [session('k', new Date(2026, 9, 5, 18), new Date(2026, 9, 5, 19, 10))],
      sessionExercises: [exercise('e1', 'k')],
      setLogs: [setLog('l1', 'e1')],
      runs: [],
      from: new Date(2026, 9, 5),
      to: new Date(2026, 9, 5),
    });

    expect(weeks[0].strength.durationSeconds).toBe(4200);
  });

  it('Volumen nur für Wiederholungsübungen', () => {
    const weeks = buildWeeklyVolume({
      sessions: [session('k', new Date(2026, 9, 5, 18), new Date(2026, 9, 5, 19))],
      sessionExercises: [exercise('e1', 'k', 'reps_weight'), exercise('e2', 'k', 'time_weight')],
      setLogs: [
        setLog('l1', 'e1', { weight: 60, reps: 5 }),
        setLog('l2', 'e2', { weight: 20, seconds: 45 }),
        setLog('l3', 'e1', { weight: 40, reps: 10, setKind: 'warmup', setNumber: 0 }),
      ],
      runs: [],
      from: new Date(2026, 9, 5),
      to: new Date(2026, 9, 5),
    });

    expect(weeks[0].strength.volumeKg).toBe(300);
    expect(weeks[0].strength.workSets).toBe(2);
  });

  it('merkt fehlende Höhenmeter', () => {
    const weeks = buildWeeklyVolume({
      ...empty,
      runs: [run('r1', '2026-10-05', { elevationGainM: 120 }), run('r2', '2026-10-06')],
      from: new Date(2026, 9, 5),
      to: new Date(2026, 9, 5),
    });

    expect(weeks[0].running.elevationGainM).toBe(120);
    expect(weeks[0].running.elevationIncomplete).toBe(true);
  });

  it('zwei Läufe am selben Tag', () => {
    const weeks = buildWeeklyVolume({
      ...empty,
      runs: [
        run('r1', '2026-10-05', { distanceKm: 5.5, durationSeconds: 1800 }),
        run('r2', '2026-10-05', { distanceKm: 3, durationSeconds: 1000 }),
      ],
      from: new Date(2026, 9, 5),
      to: new Date(2026, 9, 5),
    });

    expect(weeks[0].running.runs).toBe(2);
    expect(weeks[0].running.distanceKm).toBe(8.5);
    expect(weeks[0].running.durationSeconds).toBe(2800);
  });
});

function week(overrides: Partial<WeekVolume> = {}): WeekVolume {
  return {
    weekStart: new Date(2026, 9, 5),
    strength: { sessions: 0, durationSeconds: 0, volumeKg: 0, workSets: 0 },
    mobility: { sessions: 0, durationSeconds: 0 },
    running: { runs: 0, distanceKm: 0, elevationGainM: 0, elevationIncomplete: false, durationSeconds: 0 },
    ...overrides,
  };
}

describe('describeWeekVolume', () => {
  it('beschreibt Kraft', () => {
    const text = describeWeekVolume(
      week({ strength: { sessions: 3, durationSeconds: 11_400, volumeKg: 12_450, workSets: 54 } }),
    );

    expect(text.strength).toBe('3 Einheiten · 3:10 h · 12.450 kg · 54 Sätze');
    expect(text.mobility).toBeUndefined();
    expect(text.running).toBeUndefined();
  });

  it('nutzt die Einzahl', () => {
    const text = describeWeekVolume(
      week({ strength: { sessions: 1, durationSeconds: 3600, volumeKg: 500, workSets: 1 } }),
    );

    expect(text.strength).toContain('1 Einheit ·');
    expect(text.strength).toContain('1 Satz');
    expect(text.strength).not.toContain('1 Sätze');
  });

  it('beschreibt Mobility', () => {
    const text = describeWeekVolume(week({ mobility: { sessions: 1, durationSeconds: 1500 } }));

    expect(text.mobility).toBe('1 Einheit · 0:25 h');
  });

  it('beschreibt Laufen', () => {
    const running = { runs: 2, distanceKm: 14.2, elevationGainM: 180, elevationIncomplete: false, durationSeconds: 4860 };

    expect(describeWeekVolume(week({ running })).running).toBe('2 Läufe · 14,2 km · 180 HM · 1:21 h');
    expect(describeWeekVolume(week({ running: { ...running, runs: 1 } })).running).toMatch(/^1 Lauf ·/);
    expect(describeWeekVolume(week({ running: { ...running, elevationIncomplete: true } })).running).toContain(
      '≥ 180 HM',
    );
  });
});

describe('describeWeekCounts', () => {
  it('zählt die Arten', () => {
    expect(
      describeWeekCounts(
        week({
          strength: { sessions: 3, durationSeconds: 0, volumeKg: 0, workSets: 0 },
          mobility: { sessions: 1, durationSeconds: 0 },
          running: { runs: 2, distanceKm: 0, elevationGainM: 0, elevationIncomplete: false, durationSeconds: 0 },
        }),
      ),
    ).toBe('3 Kraft · 1 Mobility · 2 Läufe');
  });

  it('lässt Nullen weg', () => {
    expect(
      describeWeekCounts(
        week({ running: { runs: 1, distanceKm: 1, elevationGainM: 0, elevationIncomplete: false, durationSeconds: 0 } }),
      ),
    ).toBe('1 Lauf');
  });
});
