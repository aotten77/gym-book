import { describe, expect, it } from 'vitest';
import type { PlanEntry } from '@/domain/models';
import { buildTodayUnitOptions, describeLastTrained } from '@/domain/today-units';

const today = new Date(2026, 9, 7, 12);

const templates = [
  { id: 'b', name: 'Einheit B' },
  { id: 'a', name: 'Einheit A' },
  { id: 'm', name: 'Mobility Hüfte', category: 'mobility' as const },
];

function entry(partial: Partial<PlanEntry> & Pick<PlanEntry, 'id' | 'orderInDay'>): PlanEntry {
  return { date: '2026-10-07', kind: 'workout', ...partial } as PlanEntry;
}

describe('buildTodayUnitOptions', () => {
  it('geplante zuerst, übrige nach Name', () => {
    const { planned, others } = buildTodayUnitOptions({
      templates,
      plannedToday: [entry({ id: 'e1', orderInDay: 1, templateId: 'b' })],
      recency: {},
      today,
    });

    expect(planned.map((option) => option.name)).toEqual(['Einheit B']);
    expect(others.map((option) => option.name)).toEqual(['Einheit A', 'Mobility Hüfte']);
    expect(others[1].kind).toBe('mobility');
    expect(others[0].lastTrained).toBe('noch nie');
  });

  it('ein Workout zweimal geplant erscheint einmal', () => {
    const { planned } = buildTodayUnitOptions({
      templates,
      plannedToday: [
        entry({ id: 'e1', orderInDay: 1, templateId: 'b' }),
        entry({ id: 'e2', orderInDay: 2, templateId: 'b' }),
      ],
      recency: {},
      today,
    });

    expect(planned).toHaveLength(1);
  });

  it('Termin eines gelöschten Workouts fällt weg', () => {
    const { planned } = buildTodayUnitOptions({
      templates,
      plannedToday: [entry({ id: 'e1', orderInDay: 1, templateId: 'weg' })],
      recency: {},
      today,
    });

    expect(planned).toEqual([]);
  });

  it('Lauf-Termine fallen weg', () => {
    const { planned, others } = buildTodayUnitOptions({
      templates,
      plannedToday: [entry({ id: 'e1', orderInDay: 1, kind: 'run', title: 'Intervalle' })],
      recency: {},
      today,
    });

    expect(planned).toEqual([]);
    expect(others).toHaveLength(3);
  });
});

describe('describeLastTrained', () => {
  it('beschreibt den Abstand in Kalendertagen', () => {
    expect(describeLastTrained(new Date(2026, 9, 5, 18).toISOString(), today)).toBe('zuletzt Mo');
    expect(describeLastTrained(new Date(2026, 8, 30, 18).toISOString(), today)).toBe('zuletzt 30.09.');
    expect(describeLastTrained(new Date(2026, 9, 7, 6).toISOString(), today)).toBe('zuletzt heute');
    expect(describeLastTrained(undefined, today)).toBe('noch nie');
  });
});
