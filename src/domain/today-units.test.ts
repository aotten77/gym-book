import { describe, expect, it } from 'vitest';
import type { PlanEntry } from '@/domain/models';
import {
  buildTodayUnitOptions,
  describeLastTrained,
  estimateTemplateMinutes,
  filterNowOptions,
  SHORT_WORKOUT_MAX_MINUTES,
  type TodayUnitOption,
} from '@/domain/today-units';

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
      minutesByTemplate: {},
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
      minutesByTemplate: {},
      today,
    });

    expect(planned).toHaveLength(1);
  });

  it('Termin eines gelöschten Workouts fällt weg', () => {
    const { planned } = buildTodayUnitOptions({
      templates,
      plannedToday: [entry({ id: 'e1', orderInDay: 1, templateId: 'weg' })],
      recency: {},
      minutesByTemplate: {},
      today,
    });

    expect(planned).toEqual([]);
  });

  it('Lauf-Termine fallen weg', () => {
    const { planned, others } = buildTodayUnitOptions({
      templates,
      plannedToday: [entry({ id: 'e1', orderInDay: 1, kind: 'run', title: 'Intervalle' })],
      recency: {},
      minutesByTemplate: {},
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

describe('buildTodayUnitOptions: Minuten und Termin', () => {
  it('trägt Minuten, Übungszahl und die Termin-Id des geplanten Workouts', () => {
    const { planned, others } = buildTodayUnitOptions({
      templates,
      plannedToday: [entry({ id: 'e1', orderInDay: 1, templateId: 'b' })],
      recency: {},
      minutesByTemplate: { b: 40, m: 8 },
      exerciseCountByTemplate: { m: 5 },
      today,
    });

    expect(planned[0]).toMatchObject({ templateId: 'b', minutes: 40, planEntryId: 'e1' });
    expect(others.find((option) => option.templateId === 'm')).toMatchObject({
      minutes: 8,
      exerciseCount: 5,
    });
    expect(others.find((option) => option.templateId === 'a')?.minutes).toBe(0);
    expect(others.find((option) => option.templateId === 'a')?.planEntryId).toBeUndefined();
  });
});

describe('estimateTemplateMinutes', () => {
  it('schätzt 3 × 10 Wdh, 60 s Pause, ohne Aufwärmen, auf 5 min', () => {
    // 3 × (30 + 20) + 2 × 60 = 270 s
    expect(
      estimateTemplateMinutes([
        { workSetCount: 3, targetReps: 10, restSeconds: 60, includeWarmup: false, unilateral: false },
      ]),
    ).toBe(5);
  });

  it('rechnet unilateral beide Seiten plus Seitenwechsel', () => {
    // 2 × (2 × (30 + 20) + 20) = 240 s
    expect(
      estimateTemplateMinutes([
        { workSetCount: 2, targetSeconds: 30, restSeconds: 0, includeWarmup: false, unilateral: true },
      ]),
    ).toBe(4);
  });

  it('zählt eine Aufwärmrunde mit halber Pause, solange nicht ausdrücklich abgeschaltet', () => {
    // Aufwärmen 50 s + 30 s Pause, dann 1 × 50 s (letzte Runde ohne Pause) = 130 s
    expect(
      estimateTemplateMinutes([{ workSetCount: 1, targetReps: 10, restSeconds: 60, unilateral: false }]),
    ).toBe(3);
  });

  it('nimmt ohne Ziel die Ersatzarbeitszeit und kennt kein leeres Workout', () => {
    // 30 + 20 = 50 s
    expect(estimateTemplateMinutes([{ workSetCount: 1, includeWarmup: false, unilateral: false }])).toBe(1);
    expect(estimateTemplateMinutes([])).toBe(0);
  });
});

describe('filterNowOptions', () => {
  const option = (
    templateId: string,
    kind: TodayUnitOption['kind'],
    minutes: number,
  ): TodayUnitOption => ({
    templateId,
    name: templateId,
    kind,
    lastTrained: 'noch nie',
    minutes,
    exerciseCount: 0,
  });
  const options = [
    option('m8', 'mobility', 8),
    option('s15', 'strength', 15),
    option('s40', 'strength', 40),
    option('y30', 'yoga', 30),
    option('f10', 'faszien', 10),
  ];

  it('filtert „Kurz" auf höchstens 15 min, die übrigen Filter auf die Art', () => {
    expect(SHORT_WORKOUT_MAX_MINUTES).toBe(15);
    expect(filterNowOptions(options, 'all')).toHaveLength(5);
    expect(filterNowOptions(options, 'short').map((o) => o.templateId)).toEqual(['m8', 's15', 'f10']);
    expect(filterNowOptions(options, 'mobility').map((o) => o.templateId)).toEqual(['m8']);
    expect(filterNowOptions(options, 'yoga').map((o) => o.templateId)).toEqual(['y30']);
    expect(filterNowOptions(options, 'faszien').map((o) => o.templateId)).toEqual(['f10']);
    expect(filterNowOptions(options, 'strength').map((o) => o.templateId)).toEqual(['s15', 's40']);
  });

  it('„Kurz" lässt Workouts ohne Schätzung aus', () => {
    expect(filterNowOptions([option('leer', 'strength', 0)], 'short')).toEqual([]);
  });
});
