import { describe, expect, it } from 'vitest';
import type { PlanEntry } from '@/domain/models';
import {
  buildNowSections,
  describeLastTrained,
  describePlanDay,
  estimateTemplateMinutes,
  nowStartMode,
  type TodayUnitOption,
} from '@/domain/today-units';

// 2026-10-07 ist ein Mittwoch.
const today = new Date(2026, 9, 7, 12);

const templates = [
  { id: 'b', name: 'Einheit B' },
  { id: 'a', name: 'Einheit A' },
  { id: 'm', name: 'Mobility Hüfte', category: 'mobility' as const },
];

function entry(partial: Partial<PlanEntry> & Pick<PlanEntry, 'id' | 'orderInDay'>): PlanEntry {
  return { date: '2026-10-07', kind: 'workout', ...partial } as PlanEntry;
}

function sections(openEntries: PlanEntry[], extra: Partial<Parameters<typeof buildNowSections>[0]> = {}) {
  return buildNowSections({
    templates,
    openEntries,
    recency: {},
    minutesByTemplate: {},
    exerciseCountByTemplate: {},
    today,
    ...extra,
  });
}

const names = (options: TodayUnitOption[]) => options.map((option) => option.name);

describe('buildNowSections', () => {
  it('reicht die Zeile der Einschränkungen an die Workout-Karte durch', () => {
    const result = sections([entry({ id: 'e1', orderInDay: 1, templateId: 'b' })], {
      restrictionSummaryByTemplate: { b: '1 Übung pausiert · 1 angepasst' },
    });

    expect(result.now?.restrictionSummary).toBe('1 Übung pausiert · 1 angepasst');
    expect(result.spontaneous.every((option) => option.restrictionSummary === undefined)).toBe(true);
  });

  it('ohne Termine ist alles spontan, nach Name', () => {
    const result = sections([]);

    expect(result.now).toBeUndefined();
    expect(names(result.spontaneous)).toEqual(['Einheit A', 'Einheit B', 'Mobility Hüfte']);
    expect(result.spontaneous[2].kind).toBe('mobility');
    expect(result.spontaneous[0].lastTrained).toBe('noch nie');
    expect(result.planned).toEqual([]);
    expect(result.catchUp).toEqual([]);
  });

  it('der erste Termin von heute ist die Lime-Zeile, weitere stehen unter „Geplant“', () => {
    const result = sections([
      entry({ id: 'e2', orderInDay: 2, templateId: 'm' }),
      entry({ id: 'e1', orderInDay: 1, templateId: 'b' }),
    ]);

    expect(result.now).toMatchObject({ name: 'Einheit B', planEntry: { id: 'e1', date: '2026-10-07' } });
    expect(names(result.planned)).toEqual(['Mobility Hüfte']);
    expect(names(result.spontaneous)).toEqual(['Einheit A']);
  });

  it('„Geplant“ zeigt je Workout den nächsten Termin, nach Datum', () => {
    const result = sections([
      entry({ id: 'a-sa', date: '2026-10-10', orderInDay: 1, templateId: 'a' }),
      entry({ id: 'b-do', date: '2026-10-08', orderInDay: 1, templateId: 'b' }),
      entry({ id: 'a-fr', date: '2026-10-09', orderInDay: 1, templateId: 'a' }),
      entry({ id: 'a-weit', date: '2026-12-01', orderInDay: 1, templateId: 'a' }),
    ]);

    expect(result.planned.map((option) => option.planEntry?.id)).toEqual(['b-do', 'a-fr']);
    expect(names(result.spontaneous)).toEqual(['Mobility Hüfte']);
  });

  it('auch ein Termin weit in der Zukunft macht ein Workout zu einem geplanten', () => {
    const result = sections([entry({ id: 'm', date: '2026-12-01', orderInDay: 1, templateId: 'm' })]);

    expect(names(result.planned)).toEqual(['Mobility Hüfte']);
    expect(names(result.spontaneous)).toEqual(['Einheit A', 'Einheit B']);
  });

  it('das Workout der Lime-Zeile steht nicht noch einmal unter „Geplant“', () => {
    const result = sections([
      entry({ id: 'heute', orderInDay: 1, templateId: 'a' }),
      entry({ id: 'sa', date: '2026-10-10', orderInDay: 1, templateId: 'a' }),
    ]);

    expect(result.now?.planEntry?.id).toBe('heute');
    expect(result.planned).toEqual([]);
    expect(names(result.spontaneous)).not.toContain('Einheit A');
  });

  it('„Nachholen“ zeigt die offenen Termine der letzten sieben Tage, je Termin', () => {
    const result = sections([
      entry({ id: 'zu-alt', date: '2026-09-29', orderInDay: 1, templateId: 'a' }),
      entry({ id: 'so', date: '2026-10-04', orderInDay: 1, templateId: 'a' }),
      entry({ id: 'mo', date: '2026-10-05', orderInDay: 1, templateId: 'a' }),
      entry({ id: 'fr', date: '2026-10-09', orderInDay: 1, templateId: 'a' }),
    ]);

    expect(result.catchUp.map((option) => option.planEntry?.id)).toEqual(['so', 'mo']);
    // Zwei Termine, zwei Zeilen: dasselbe Workout darf auch unter „Geplant“ stehen.
    expect(result.planned.map((option) => option.planEntry?.id)).toEqual(['fr']);
  });

  it('ein Workout nur mit Termin in der Vergangenheit ist spontan', () => {
    const result = sections([entry({ id: 'mo', date: '2026-10-05', orderInDay: 1, templateId: 'b' })]);

    expect(names(result.catchUp)).toEqual(['Einheit B']);
    expect(names(result.spontaneous)).toContain('Einheit B');
  });

  it('Lauf-Termine und Termine gelöschter Workouts fallen weg', () => {
    const result = sections([
      entry({ id: 'lauf', orderInDay: 1, kind: 'run', title: 'Intervalle' }),
      entry({ id: 'weg', orderInDay: 2, templateId: 'weg' }),
    ]);

    expect(result.now).toBeUndefined();
    expect(result.planned).toEqual([]);
    expect(result.spontaneous).toHaveLength(3);
  });

  it('trägt Minuten, Übungszahl und die geführte Marke', () => {
    const result = sections([], {
      templates: [
        ...templates,
        { id: 'g', name: 'Yoga Abend', category: 'yoga', steps: [{ name: 'Kindhaltung', seconds: 60 }] },
      ],
      minutesByTemplate: { m: 8 },
      exerciseCountByTemplate: { m: 5 },
    });

    expect(result.spontaneous.find((option) => option.templateId === 'm')).toMatchObject({
      minutes: 8,
      exerciseCount: 5,
      guided: false,
    });
    expect(result.spontaneous.find((option) => option.templateId === 'g')?.guided).toBe(true);
    expect(result.spontaneous.find((option) => option.templateId === 'a')?.planEntry).toBeUndefined();
  });
});

describe('nowStartMode', () => {
  const option = (date?: string): TodayUnitOption => ({
    templateId: 'a',
    name: 'Einheit A',
    kind: 'strength',
    lastTrained: 'noch nie',
    minutes: 0,
    exerciseCount: 0,
    guided: false,
    ...(date ? { planEntry: { id: 'e', date } } : {}),
  });

  it('heute verknüpft, im Fenster fragt, sonst zusätzlich', () => {
    expect(nowStartMode(option('2026-10-07'), '2026-10-07')).toBe('link');
    expect(nowStartMode(option('2026-10-12'), '2026-10-07')).toBe('ask');
    expect(nowStartMode(option('2026-09-30'), '2026-10-07')).toBe('ask');
    expect(nowStartMode(option('2026-10-15'), '2026-10-07')).toBe('extra');
    expect(nowStartMode(option(), '2026-10-07')).toBe('extra');
  });
});

describe('describePlanDay', () => {
  it('heute, bis sechs Tage der Wochentag, sonst das Datum', () => {
    expect(describePlanDay('2026-10-07', today)).toBe('heute');
    expect(describePlanDay('2026-10-08', today)).toBe('Do');
    expect(describePlanDay('2026-10-05', today)).toBe('Mo');
    expect(describePlanDay('2026-10-13', today)).toBe('Di');
    expect(describePlanDay('2026-10-14', today)).toBe('14.10.');
    expect(describePlanDay('2026-09-30', today)).toBe('30.09.');
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
