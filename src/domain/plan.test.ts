import { describe, expect, it } from 'vitest';
import type { PlanEntry } from '@/domain/models';
import {
  PLAN_MESSAGES,
  buildPlanLinks,
  describeRunTarget,
  expandSeries,
  findMatchingPlanEntry,
  isValidLocalDate,
  pickTodayPlan,
  planEntryKey,
  planEntryName,
  planEntryState,
  toPlanEntryFields,
  toRunPlanSnapshot,
  validatePlanEntryValues,
  type PlanEntryValues,
} from '@/domain/plan';

function values(overrides: Partial<PlanEntryValues> = {}): PlanEntryValues {
  return {
    date: '2026-10-05',
    kind: 'run',
    templateId: null,
    title: 'Dauerlauf',
    targetDistanceKm: null,
    targetDurationSeconds: null,
    targetElevationGainM: null,
    targetAverageHeartRate: null,
    targetPaceSecondsPerKm: null,
    instructions: null,
    notes: null,
    ...overrides,
  };
}

function entry(overrides: Partial<PlanEntry> & { id: string; date: string }): PlanEntry {
  return {
    orderInDay: 1,
    kind: 'workout',
    templateId: 'A',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('planEntryKey', () => {
  it('normalizes the run title', () => {
    expect(planEntryKey({ date: '2026-10-05', kind: 'run', title: ' Intervalle 6×400 ' })).toBe(
      planEntryKey({ date: '2026-10-05', kind: 'run', title: 'intervalle 6×400' }),
    );
  });

  it('contains the template id for workouts', () => {
    expect(planEntryKey({ date: '2026-10-05', kind: 'workout', templateId: 'tpl-1' })).toContain('tpl-1');
  });
});

describe('isValidLocalDate', () => {
  it('accepts only real calendar days', () => {
    expect(isValidLocalDate('2026-10-05')).toBe(true);
    expect(isValidLocalDate('2026-13-01')).toBe(false);
    expect(isValidLocalDate('2026-02-30')).toBe(false);
    expect(isValidLocalDate('')).toBe(false);
  });
});

describe('validatePlanEntryValues', () => {
  it('requires a workout for workout entries', () => {
    expect(validatePlanEntryValues(values({ kind: 'workout', title: null }))).toBe(
      PLAN_MESSAGES.workoutMissing,
    );
  });

  it('requires a title for runs', () => {
    expect(validatePlanEntryValues(values({ title: '  ' }))).toBe(PLAN_MESSAGES.titleMissing);
  });

  it('rejects bad run targets', () => {
    expect(validatePlanEntryValues(values({ targetDistanceKm: 0 }))).toBe(PLAN_MESSAGES.distance);
    expect(validatePlanEntryValues(values({ targetAverageHeartRate: 251 }))).toBe(PLAN_MESSAGES.heartRate);
    expect(validatePlanEntryValues(values({ targetElevationGainM: 12.5 }))).toBe(PLAN_MESSAGES.elevation);
    expect(validatePlanEntryValues(values({ targetPaceSecondsPerKm: 0 }))).toBe(PLAN_MESSAGES.pace);
    expect(validatePlanEntryValues(values({ targetDurationSeconds: 0 }))).toBe(PLAN_MESSAGES.duration);
  });

  it('rejects an invalid date', () => {
    expect(validatePlanEntryValues(values({ date: '2026-02-30' }))).toBe(PLAN_MESSAGES.dateInvalid);
  });

  it('ignores fields of the other kind', () => {
    expect(
      validatePlanEntryValues(values({ kind: 'workout', templateId: 'A', targetDistanceKm: 0 })),
    ).toBeUndefined();
  });
});

describe('toPlanEntryFields', () => {
  it('drops run fields on a workout', () => {
    const fields = toPlanEntryFields(
      values({ kind: 'workout', templateId: 'A', title: 'x', targetDistanceKm: 5 }),
    );

    expect(fields).not.toHaveProperty('title');
    expect(fields).not.toHaveProperty('targetDistanceKm');
    expect(fields.templateId).toBe('A');
  });

  it('omits blank texts and nulls and trims', () => {
    const fields = toPlanEntryFields(values({ title: ' Lauf ', notes: '  ', instructions: ' los ' }));

    expect(fields).not.toHaveProperty('notes');
    expect(fields).not.toHaveProperty('targetDistanceKm');
    expect(fields.title).toBe('Lauf');
    expect(fields.instructions).toBe('los');
  });
});

describe('buildPlanLinks', () => {
  it('derives links from sessions and runs', () => {
    const links = buildPlanLinks(
      [
        { id: 's1', planEntryId: 'p1', status: 'aborted', templateNameSnapshot: 'A' },
        { id: 's2', planEntryId: 'p2', status: 'active', templateNameSnapshot: 'A' },
        {
          id: 's3',
          planEntryId: 'p3',
          status: 'completed',
          completedAt: '2026-10-05T10:00:00.000Z',
          templateNameSnapshot: 'A',
        },
      ],
      [{ id: 'r1', planEntryId: 'p4', date: '2026-10-06' }],
    );

    expect(links.p1).toBeUndefined();
    expect(links.p2.done).toBe(false);
    expect(links.p3).toMatchObject({ done: true, doneAt: '2026-10-05T10:00:00.000Z' });
    expect(links.p4).toMatchObject({ source: 'run', done: true, doneAt: '2026-10-06' });
    expect(planEntryState('p1', links)).toBe('offen');
    expect(planEntryState('p2', links)).toBe('belegt');
    expect(planEntryState('p3', links)).toBe('erledigt');
  });
});

describe('findMatchingPlanEntry', () => {
  const mo = entry({ id: 'mo', date: '2026-10-05' });
  const th = entry({ id: 'do', date: '2026-10-08' });
  const query = (day: string, takenIds: string[] = []) => ({
    kind: 'workout' as const,
    templateId: 'A',
    day,
    takenIds: new Set(takenIds),
  });

  it('prefers the same day', () => {
    expect(findMatchingPlanEntry([mo, th], query('2026-10-08'))?.id).toBe('do');
  });

  it('takes an earlier entry on a later day', () => {
    expect(findMatchingPlanEntry([mo, th], query('2026-10-06'))?.id).toBe('mo');
  });

  it('skips taken entries and pulls the next one forward', () => {
    expect(findMatchingPlanEntry([mo, th], query('2026-10-06', ['mo']))?.id).toBe('do');
  });

  it('returns null when nothing is left', () => {
    expect(findMatchingPlanEntry([mo, th], query('2026-10-12'))).toBeNull();
  });

  it('matches runs only on the same day', () => {
    const run = entry({ id: 'run', date: '2026-10-11', kind: 'run', templateId: undefined, title: 'Lauf' });

    expect(
      findMatchingPlanEntry([run], { kind: 'run', day: '2026-10-12', takenIds: new Set() }),
    ).toBeNull();
  });

  it('ignores other templates', () => {
    expect(findMatchingPlanEntry([mo], { ...query('2026-10-05'), templateId: 'B' })).toBeNull();
  });

  it('takes the lower orderInDay on the same day', () => {
    const first = entry({ id: 'r1', date: '2026-10-05', kind: 'run', templateId: undefined, title: 'a', orderInDay: 1 });
    const second = entry({ id: 'r2', date: '2026-10-05', kind: 'run', templateId: undefined, title: 'b', orderInDay: 2 });

    expect(
      findMatchingPlanEntry([second, first], { kind: 'run', day: '2026-10-05', takenIds: new Set() })?.id,
    ).toBe('r1');
  });
});

describe('expandSeries', () => {
  it('expands across the DST change', () => {
    expect(expandSeries({ weekdays: [1, 4], startDate: '2026-10-21', weeks: 3 })).toEqual([
      '2026-10-22',
      '2026-10-26',
      '2026-10-29',
      '2026-11-02',
      '2026-11-05',
    ]);
  });
});

describe('describeRunTarget', () => {
  it('lists all parts in order', () => {
    expect(
      describeRunTarget({
        targetDistanceKm: 8,
        targetDurationSeconds: 2700,
        targetPaceSecondsPerKm: 330,
        targetElevationGainM: 120,
        targetAverageHeartRate: 145,
      }),
    ).toBe('8 km · 45:00 · 5:30 /km · 120 hm · Ø 145');
  });

  it('uses the German decimal comma and drops missing parts', () => {
    expect(describeRunTarget({ targetDistanceKm: 7.5 })).toBe('7,5 km');
    expect(describeRunTarget({})).toBe('');
  });
});

describe('pickTodayPlan', () => {
  it('lists open entries of today in order and drops done ones', () => {
    const later = entry({ id: 'b', date: '2026-10-05', orderInDay: 2 });
    const first = entry({ id: 'a', date: '2026-10-05', orderInDay: 1 });
    const done = entry({ id: 'c', date: '2026-10-05', orderInDay: 3 });
    const links = buildPlanLinks(
      [{ id: 's', planEntryId: 'c', status: 'completed', completedAt: 'x', templateNameSnapshot: 'A' }],
      [],
    );

    expect(pickTodayPlan([later, done, first], links, '2026-10-05').todayOpen.map((e) => e.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('falls back to the earliest future open entry', () => {
    const far = entry({ id: 'far', date: '2026-10-12' });
    const near = entry({ id: 'near', date: '2026-10-08' });
    const past = entry({ id: 'past', date: '2026-10-01' });
    const result = pickTodayPlan([far, past, near], {}, '2026-10-05');

    expect(result.todayOpen).toEqual([]);
    expect(result.next?.id).toBe('near');
  });
});

describe('planEntryName', () => {
  it('falls back to the snapshot of a deleted workout', () => {
    const e = entry({ id: 'p', date: '2026-10-05', templateId: 'gone' });
    const links = buildPlanLinks(
      [{ id: 's', planEntryId: 'p', status: 'active', templateNameSnapshot: 'Einheit A' }],
      [],
    );

    expect(planEntryName(e, {}, links)).toBe('Einheit A');
    expect(planEntryName(e, {}, {})).toBe('Gelöschtes Workout');
    expect(planEntryName(e, { gone: 'Neu' }, links)).toBe('Neu');
  });
});

describe('toRunPlanSnapshot', () => {
  const base: PlanEntry = {
    id: 'p1',
    date: '2026-10-05',
    orderInDay: 1,
    kind: 'run',
    title: 'Dauerlauf',
    targetDistanceKm: 8,
    targetPaceSecondsPerKm: 330,
    instructions: 'locker',
    notes: 'privat',
    createdAt: 'x',
    updatedAt: 'x',
  };

  it('übernimmt Titel, Datum, Vorgaben und Anleitung', () => {
    expect(toRunPlanSnapshot(base)).toEqual({
      title: 'Dauerlauf',
      date: '2026-10-05',
      targetDistanceKm: 8,
      targetPaceSecondsPerKm: 330,
      instructions: 'locker',
    });
  });

  it('lässt fehlende Felder als Schlüssel weg', () => {
    const snapshot = toRunPlanSnapshot({
      ...base,
      instructions: undefined,
      targetDistanceKm: undefined,
      targetPaceSecondsPerKm: undefined,
    });

    expect(Object.keys(snapshot).sort()).toEqual(['date', 'title']);
  });
});
