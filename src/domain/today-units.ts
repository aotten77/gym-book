import type { PlanEntry, WorkoutTemplate } from '@/domain/models';
import {
  FALLBACK_WORK_SECONDS,
  ROW_OVERHEAD_SECONDS,
  SECONDS_PER_REP,
  SIDE_SWITCH_SECONDS,
  WARMUP_REST_FACTOR,
} from '@/domain/session-estimate';
import { isoWeekday, weekdayShortLabel } from '@/domain/training-calendar';
import { resolveWorkoutCategory, type WorkoutCategory } from '@/domain/workout-category';
import { formatShortDate } from '@/lib/format';

export interface TodayUnitOption {
  templateId: string;
  name: string;
  kind: WorkoutCategory;
  lastTrained: string;
  /** Grobe Dauer, siehe `estimateTemplateMinutes`; 0 heißt „nicht schätzbar". */
  minutes: number;
  exerciseCount: number;
  /** Nur bei einem heute geplanten Workout: der Termin, der beim Start mitgegeben wird. */
  planEntryId?: string;
}

/** Bis hierhin gilt ein Workout als „kurz & spontan". */
export const SHORT_WORKOUT_MAX_MINUTES = 15;

export type NowFilter = 'all' | 'short' | WorkoutCategory;

export interface TemplateEstimateItem {
  workSetCount: number;
  targetReps?: number;
  targetSeconds?: number;
  restSeconds?: number;
  includeWarmup?: boolean;
  unilateral: boolean;
}

/**
 * Grobe Dauer eines Workouts in Minuten - nur für den Filter „Kurz".
 *
 * Bewusst die einfache Planzeit ohne Tempo und Historie: das Jetzt-Sheet will
 * 8 min von 40 min unterscheiden, nicht den Feierabend vorhersagen (das tut
 * `session-estimate.ts` für die laufende Einheit). Die Konstanten kommen von
 * dort, damit es keine zweite Wahrheit über „eine Zeile kostet 20 s" gibt.
 */
export function estimateTemplateMinutes(items: TemplateEstimateItem[]): number {
  const rounds: { seconds: number; rest: number }[] = [];

  for (const item of items) {
    const work =
      item.targetSeconds ??
      (item.targetReps ? item.targetReps * SECONDS_PER_REP : FALLBACK_WORK_SECONDS);
    const row = work + ROW_OVERHEAD_SECONDS;
    const roundSeconds = item.unilateral ? 2 * row + SIDE_SWITCH_SECONDS : row;
    const rest = item.restSeconds ?? 0;

    if (item.includeWarmup !== false) {
      rounds.push({ seconds: roundSeconds, rest: rest * WARMUP_REST_FACTOR });
    }

    for (let set = 0; set < item.workSetCount; set += 1) {
      rounds.push({ seconds: roundSeconds, rest });
    }
  }

  if (rounds.length === 0) {
    return 0;
  }

  // Nach der allerletzten Runde wartet niemand mehr eine Pause ab.
  const total = rounds.reduce(
    (sum, round, index) => sum + round.seconds + (index < rounds.length - 1 ? round.rest : 0),
    0,
  );

  return Math.ceil(total / 60);
}

export function filterNowOptions(options: TodayUnitOption[], filter: NowFilter): TodayUnitOption[] {
  switch (filter) {
    case 'short':
      return options.filter(
        (option) => option.minutes > 0 && option.minutes <= SHORT_WORKOUT_MAX_MINUTES,
      );
    case 'mobility':
    case 'yoga':
    case 'faszien':
    case 'strength':
      return options.filter((option) => option.kind === filter);
    default:
      return options;
  }
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Kalendertage von `from` bis `to`, per `setDate` gezählt - eine Zeitumstellung verschiebt nichts. */
function calendarDaysBetween(from: Date, to: Date): number {
  const cursor = startOfLocalDay(from);
  const end = startOfLocalDay(to);
  let days = 0;

  while (cursor < end) {
    cursor.setDate(cursor.getDate() + 1);
    days += 1;
  }

  return days;
}

export function describeLastTrained(completedAt: string | undefined, today: Date): string {
  if (!completedAt) {
    return 'noch nie';
  }

  const day = new Date(completedAt);

  if (Number.isNaN(day.getTime())) {
    return 'noch nie';
  }

  const daysAgo = calendarDaysBetween(day, today);

  if (daysAgo === 0) {
    return 'zuletzt heute';
  }

  if (daysAgo >= 1 && daysAgo <= 6) {
    return `zuletzt ${weekdayShortLabel(isoWeekday(day))}`;
  }

  return `zuletzt ${formatShortDate(day)}`;
}

/**
 * Die Auswahl für „Jetzt trainieren": zuerst die Workouts der heutigen Termine
 * (je Workout einmal, in Tagesreihenfolge), danach alle übrigen nach Name.
 * Ein Termin ist ein Angebot, kein Schloss - deshalb bleibt jedes Workout wählbar.
 */
export function buildTodayUnitOptions(input: {
  templates: Pick<WorkoutTemplate, 'id' | 'name' | 'category'>[];
  plannedToday: PlanEntry[];
  recency: Record<string, string>;
  minutesByTemplate: Record<string, number>;
  /** Optional: nur die Kacheln brauchen die Zahl; ohne sie steht 0. */
  exerciseCountByTemplate?: Record<string, number>;
  today: Date;
}): { planned: TodayUnitOption[]; others: TodayUnitOption[] } {
  const byId = new Map(input.templates.map((template) => [template.id, template]));

  const toOption = (template: Pick<WorkoutTemplate, 'id' | 'name' | 'category'>): TodayUnitOption => ({
    templateId: template.id,
    name: template.name,
    kind: resolveWorkoutCategory(template.category),
    lastTrained: describeLastTrained(input.recency[template.id], input.today),
    minutes: input.minutesByTemplate[template.id] ?? 0,
    exerciseCount: input.exerciseCountByTemplate?.[template.id] ?? 0,
  });

  const plannedIds = new Set<string>();
  const planned: TodayUnitOption[] = [];
  const ordered = [...input.plannedToday].sort((a, b) => a.orderInDay - b.orderInDay);

  for (const entry of ordered) {
    if (entry.kind !== 'workout' || !entry.templateId || plannedIds.has(entry.templateId)) {
      continue;
    }

    const template = byId.get(entry.templateId);

    if (!template) {
      continue;
    }

    plannedIds.add(template.id);
    planned.push({ ...toOption(template), planEntryId: entry.id });
  }

  const others = input.templates
    .filter((template) => !plannedIds.has(template.id))
    .map(toOption)
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));

  return { planned, others };
}
