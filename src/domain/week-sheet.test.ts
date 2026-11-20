import { describe, expect, it } from 'vitest';
import type { PlanEntry, WorkoutTemplate } from '@/domain/models';
import type { PlanEntryLink } from '@/domain/plan';
import type { WeekPlanBlock, WeekPlanEntry } from '@/domain/program-plan';
import { buildCalendarWeeks, type CalendarSession } from '@/domain/training-calendar';
import type { WeekVolume } from '@/domain/weekly-volume';
import {
  buildWeekSheetTiles,
  selectWeekSheetBlocks,
  splitWeekPlanEntries,
} from '@/domain/week-sheet';

const TODAY_KEY = '2026-11-18';

const templates: Pick<WorkoutTemplate, 'id' | 'name' | 'category'>[] = [
  { id: 'a', name: 'Einheit A', category: undefined },
  { id: 'b', name: 'Einheit B', category: undefined },
  { id: 'm', name: 'Mobility', category: 'mobility' },
];

function entry(overrides: Partial<PlanEntry>): PlanEntry {
  return {
    id: 'e',
    date: '2026-11-16',
    orderInDay: 1,
    kind: 'workout',
    createdAt: '2026-11-01T08:00:00.000Z',
    updatedAt: '2026-11-01T08:00:00.000Z',
    ...overrides,
  };
}

function shiftDays(entries: PlanEntry[], days: number): PlanEntry[] {
  return entries.map((item) => {
    const [year, month, day] = item.date.split('-').map(Number);
    const moved = new Date(year, month - 1, day + days);

    return {
      ...item,
      date: `${moved.getFullYear()}-${String(moved.getMonth() + 1).padStart(2, '0')}-${String(moved.getDate()).padStart(2, '0')}`,
    };
  });
}

// Screen 4: Woche 16.-22.11.2026, heute Mittwoch der 18. (der 19. wäre ein Donnerstag).
const entries: PlanEntry[] = [
  entry({ id: 'eb', date: '2026-11-16', templateId: 'b' }),
  entry({ id: 'ea', date: '2026-11-18', templateId: 'a' }),
  entry({ id: 'em', date: '2026-11-21', templateId: 'm' }),
  entry({ id: 'er', date: '2026-11-19', kind: 'run', title: 'Intervalle', targetDistanceKm: 8 }),
];

const links: Record<string, PlanEntryLink> = {
  eb: { planEntryId: 'eb', source: 'session', sourceId: 's1', done: true, doneAt: '2026-11-16T07:00:00.000Z' },
};

const sessions: CalendarSession[] = [
  {
    id: 's1',
    templateId: 'b',
    templateName: 'Einheit B',
    startedAt: new Date(2026, 10, 16, 7, 0).toISOString(),
    completedAt: new Date(2026, 10, 16, 8, 0).toISOString(),
    planEntryId: 'eb',
  },
  {
    id: 's2',
    templateId: 'm',
    templateName: 'Mobility',
    startedAt: new Date(2026, 10, 17, 7, 0).toISOString(),
    completedAt: new Date(2026, 10, 17, 7, 9).toISOString(),
    templateCategorySnapshot: 'mobility',
  },
];

function weekOf(planEntries: PlanEntry[], firstMonday: Date) {
  return buildCalendarWeeks({
    firstMonday,
    weeks: 1,
    today: new Date(2026, 10, 18),
    programWeeks: [],
    planEntries,
    planLinks: links,
    templates,
    completedSessions: sessions,
    runs: [],
    tests: [],
  })[0];
}

const volume: WeekVolume = {
  weekStart: new Date(2026, 10, 16),
  strength: { sessions: 1, durationSeconds: 3600, volumeKg: 4180, workSets: 12 },
  mobility: { sessions: 1, durationSeconds: 540 },
  running: { runs: 0, distanceKm: 0, elevationGainM: 0, elevationIncomplete: false, durationSeconds: 0 },
};

describe('buildWeekSheetTiles', () => {
  it('zählt erledigt gegen geplant und nennt Volumen und Kilometer', () => {
    const tiles = buildWeekSheetTiles({
      week: weekOf(entries, new Date(2026, 10, 16)),
      entries,
      templates,
      volume,
      todayKey: TODAY_KEY,
    });

    expect(tiles).toEqual([
      { kind: 'strength', title: 'Kraft', count: '1 / 2', detail: '4.180 kg', done: true },
      { kind: 'mobility', title: 'Mobility', count: '1 / 1', detail: '0:09 h', done: true },
      { kind: 'run', title: 'Laufen', count: '0 / 1', detail: '0 / 8 km', done: false },
    ]);
  });

  it('nennt in einer künftigen Woche nur die Zahl der Termine', () => {
    const later = shiftDays(entries, 7);
    const tiles = buildWeekSheetTiles({
      week: weekOf(later, new Date(2026, 10, 23)),
      entries: later,
      templates,
      todayKey: TODAY_KEY,
    });

    expect(tiles).toEqual([
      { kind: 'strength', title: 'Kraft', count: '2 geplant', done: false },
      { kind: 'mobility', title: 'Mobility', count: '1 geplant', done: false },
      { kind: 'run', title: 'Laufen', count: '1 geplant', detail: '8 km', done: false },
    ]);
  });

  it('lässt Details ohne Volumen und ohne Kilometer weg', () => {
    const tiles = buildWeekSheetTiles({
      week: weekOf([], new Date(2026, 10, 16)),
      entries: [],
      templates,
      todayKey: TODAY_KEY,
    });

    expect(tiles.map((tile) => tile.detail)).toEqual([undefined, undefined, undefined]);
  });
});

function planEntry(id: string, exerciseName: string, overriddenFields: WeekPlanEntry['overriddenFields']) {
  return { templateExerciseId: id, exerciseName, overriddenFields } as WeekPlanEntry;
}

describe('selectWeekSheetBlocks', () => {
  const blocks: WeekPlanBlock[] = [
    { templateId: 'a', templateName: 'Einheit A', entries: [] },
    { templateId: 'b', templateName: 'Einheit B', entries: [] },
    { templateId: 'c', templateName: 'Einheit C', entries: [] },
  ];

  it('zeigt nur Workouts mit Termin, nach frühestem Termin sortiert', () => {
    const result = selectWeekSheetBlocks({ blocks, entries, links, todayKey: TODAY_KEY });

    expect(result.map((item) => [item.block.templateName, item.days])).toEqual([
      ['Einheit B', 'Mo · erledigt'],
      ['Einheit A', 'Mi · heute'],
    ]);
  });

  it('zeigt ohne Workout-Termine alle Blöcke ohne Tage', () => {
    const result = selectWeekSheetBlocks({
      blocks,
      entries: entries.filter((item) => item.kind === 'run'),
      links,
      todayKey: TODAY_KEY,
    });

    expect(result.map((item) => [item.block.templateName, item.days])).toEqual([
      ['Einheit A', ''],
      ['Einheit B', ''],
      ['Einheit C', ''],
    ]);
  });
});

describe('splitWeekPlanEntries', () => {
  it('zeigt die überschriebenen und versteckt die übrigen', () => {
    const list = [
      planEntry('1', 'Kniebeuge', []),
      planEntry('2', 'Bankdrücken', ['targetWeight']),
      planEntry('3', 'Rudern', []),
    ];
    const { shown, hidden } = splitWeekPlanEntries(list);

    expect(shown).toEqual([list[1]]);
    expect(hidden).toEqual([list[0], list[2]]);
  });
});
