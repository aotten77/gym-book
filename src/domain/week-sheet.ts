/**
 * Die Regeln des Wochen-Sheets: drei Kacheln (Kraft, Mobility, Laufen) und die
 * Vorgaben-Blöcke der Woche. Rein und ohne Uhr - "heute" kommt als `todayKey`
 * herein, die Woche als `CalendarWeek`.
 *
 * Geplant ist, was in der Woche *datiert* ist, in jedem Zustand; erledigt ist,
 * was die Woche als erledigte Einheit führt, auch Ungeplantes. Seitenvergleiche
 * zählen in keiner Kachel.
 */
import type { PlanEntry, WorkoutTemplate } from '@/domain/models';
import { parseLocalDate } from '@/domain/calendar-week';
import { planEntryState, sortPlanEntries, type PlanEntryLink } from '@/domain/plan';
import type { WeekPlanBlock, WeekPlanEntry } from '@/domain/program-plan';
import { isoWeekday, weekdayShortLabel, type CalendarWeek } from '@/domain/training-calendar';
import type { WeekVolume } from '@/domain/weekly-volume';
import { resolveWorkoutCategory } from '@/domain/workout-category';
import { formatDurationHours, formatNumber } from '@/lib/format';

type TileKind = 'strength' | 'mobility' | 'run';

export interface WeekSheetTile {
  kind: TileKind;
  title: 'Kraft' | 'Mobility' | 'Laufen';
  count: string;
  detail?: string;
  done: boolean;
}

const TILES: { kind: TileKind; title: WeekSheetTile['title'] }[] = [
  { kind: 'strength', title: 'Kraft' },
  { kind: 'mobility', title: 'Mobility' },
  { kind: 'run', title: 'Laufen' },
];

interface BuildWeekSheetTilesInput {
  week: CalendarWeek;
  entries: PlanEntry[];
  templates: Pick<WorkoutTemplate, 'id' | 'category'>[];
  volume?: WeekVolume;
  todayKey: string;
}

function entryKind(
  entry: PlanEntry,
  categoryByTemplateId: Map<string, WorkoutTemplate['category']>,
): TileKind {
  if (entry.kind === 'run') {
    return 'run';
  }

  // Ein gelöschtes Workout zählt als Kraft, wie im Kalender.
  return resolveWorkoutCategory(
    entry.templateId === undefined ? undefined : categoryByTemplateId.get(entry.templateId),
  );
}

export function buildWeekSheetTiles({
  week,
  entries,
  templates,
  volume,
  todayKey,
}: BuildWeekSheetTilesInput): WeekSheetTile[] {
  const categoryByTemplateId = new Map(templates.map((template) => [template.id, template.category]));
  const dayKeys = new Set(week.days.map((day) => day.key));
  const planned = entries.filter((entry) => dayKeys.has(entry.date));
  const doneUnits = week.days
    .flatMap((day) => day.units)
    .filter((unit) => unit.state === 'erledigt');
  const isFuture = week.key > todayKey;

  return TILES.map(({ kind, title }) => {
    const plannedOfKind = planned.filter((entry) => entryKind(entry, categoryByTemplateId) === kind);
    const doneOfKind = doneUnits.filter((unit) => unit.kind === kind);
    const plannedKm = plannedOfKind.reduce((sum, entry) => sum + (entry.targetDistanceKm ?? 0), 0);
    const doneKm = doneOfKind.reduce((sum, unit) => sum + (unit.distanceKm ?? 0), 0);

    if (isFuture) {
      return {
        kind,
        title,
        count: `${plannedOfKind.length} geplant`,
        ...(kind === 'run' && plannedKm > 0 ? { detail: `${formatNumber(plannedKm)} km` } : {}),
        done: false,
      };
    }

    let detail: string | undefined;

    if (kind === 'strength') {
      const volumeKg = Math.round(volume?.strength.volumeKg ?? 0);

      detail = volumeKg > 0 ? `${formatNumber(volumeKg)} kg` : undefined;
    } else if (kind === 'mobility') {
      detail =
        volume && volume.mobility.sessions > 0
          ? formatDurationHours(volume.mobility.durationSeconds)
          : undefined;
    } else if (plannedKm > 0) {
      detail = `${formatNumber(doneKm)} / ${formatNumber(plannedKm)} km`;
    } else if (doneKm > 0) {
      detail = `${formatNumber(doneKm)} km`;
    }

    return {
      kind,
      title,
      count: `${doneOfKind.length} / ${plannedOfKind.length}`,
      ...(detail === undefined ? {} : { detail }),
      done: doneOfKind.length > 0,
    };
  });
}

export interface WeekSheetBlock {
  block: WeekPlanBlock;
  days: string;
}

interface SelectWeekSheetBlocksInput {
  blocks: WeekPlanBlock[];
  /** Die Termine der gezeigten Woche. */
  entries: PlanEntry[];
  links: Record<string, PlanEntryLink>;
  todayKey: string;
}

function describeEntryDay(
  entry: PlanEntry,
  links: Record<string, PlanEntryLink>,
  todayKey: string,
): string {
  const date = parseLocalDate(entry.date);
  const label = date ? weekdayShortLabel(isoWeekday(date)) : entry.date;

  if (planEntryState(entry.id, links) === 'erledigt') {
    return `${label} · erledigt`;
  }

  return entry.date === todayKey ? `${label} · heute` : label;
}

export function selectWeekSheetBlocks({
  blocks,
  entries,
  links,
  todayKey,
}: SelectWeekSheetBlocksInput): WeekSheetBlock[] {
  const workoutEntries = sortPlanEntries(
    entries.filter((entry) => entry.kind === 'workout' && entry.templateId !== undefined),
  );

  if (workoutEntries.length === 0) {
    return blocks.map((block) => ({ block, days: '' }));
  }

  // Die Termine sind sortiert, also steht der früheste eines Workouts vorn.
  const entriesByTemplateId = new Map<string, PlanEntry[]>();

  for (const entry of workoutEntries) {
    const list = entriesByTemplateId.get(entry.templateId as string) ?? [];

    list.push(entry);
    entriesByTemplateId.set(entry.templateId as string, list);
  }

  const shown = blocks
    .filter((block) => entriesByTemplateId.has(block.templateId))
    .map((block) => {
      const own = entriesByTemplateId.get(block.templateId) as PlanEntry[];

      return {
        block,
        first: own[0],
        days: own.map((entry) => describeEntryDay(entry, links, todayKey)).join(', '),
      };
    })
    .sort(
      (left, right) =>
        left.first.date.localeCompare(right.first.date) || left.first.orderInDay - right.first.orderInDay,
    );

  return shown.map(({ block, days }) => ({ block, days }));
}

/** Überschriebene Zeilen stehen offen, der Rest klappt ein; Reihenfolge bleibt. */
export function splitWeekPlanEntries(entries: WeekPlanEntry[]): {
  shown: WeekPlanEntry[];
  hidden: WeekPlanEntry[];
} {
  return {
    shown: entries.filter((entry) => entry.overriddenFields.length > 0),
    hidden: entries.filter((entry) => entry.overriddenFields.length === 0),
  };
}
