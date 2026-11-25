import { parseLocalDate } from '@/domain/calendar-week';
import { isGuidedTemplate } from '@/domain/guided-steps';
import type { PlanEntry, WorkoutTemplate } from '@/domain/models';
import {
  isWithinPlanShiftWindow,
  PLAN_SHIFT_WINDOW_DAYS,
  shiftDateKey,
  sortPlanEntries,
} from '@/domain/plan';
import { toDateInputValue } from '@/domain/program';
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
  /** Eine geführte Vorlage startet nicht als Session, sondern auf ihrem Start-Screen. */
  guided: boolean;
  /** Nur bei Zeilen aus dem Plan: der Termin, um den es geht. */
  planEntry?: { id: string; date: string };
  /** „1 Übung pausiert · 1 angepasst“ - was Einschränkungen heute an diesem Workout ändern. */
  restrictionSummary?: string;
}

/**
 * Wie ein Tap auf eine Zeile startet: mit ihrem Termin (`link`, er ist von
 * heute), erst nach Rückfrage (`ask`, er liegt an einem anderen Tag im Fenster
 * - vorziehen, nachholen oder zusätzlich?) oder ohne Termin (`extra`).
 */
export type NowStartMode = 'link' | 'ask' | 'extra';

export interface TemplateEstimateItem {
  workSetCount: number;
  targetReps?: number;
  targetSeconds?: number;
  restSeconds?: number;
  includeWarmup?: boolean;
  unilateral: boolean;
}

/**
 * Grobe Dauer eines Workouts in Minuten - nur für die Zeilen unter „Spontan“ im Jetzt-Sheet.
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

export function nowStartMode(option: TodayUnitOption, today: string): NowStartMode {
  if (!option.planEntry) {
    return 'extra';
  }

  if (option.planEntry.date === today) {
    return 'link';
  }

  return isWithinPlanShiftWindow(option.planEntry.date, today) ? 'ask' : 'extra';
}

/** Der Tag eines Termins aus Sicht von heute: „heute", bis sechs Tage der Wochentag, sonst Datum. */
export function describePlanDay(date: string, today: Date): string {
  const todayKey = toDateInputValue(today);

  if (date === todayKey) {
    return 'heute';
  }

  const target = parseLocalDate(date);

  if (!target) {
    return date;
  }

  const distance =
    date > todayKey ? calendarDaysBetween(today, target) : calendarDaysBetween(target, today);

  return distance <= 6 ? weekdayShortLabel(isoWeekday(target)) : formatShortDate(target);
}

export interface NowSections {
  /** Der erste offene Termin von heute - die eine Lime-Zeile. */
  now?: TodayUnitOption;
  /** Offene Termine der letzten `PLAN_SHIFT_WINDOW_DAYS` Tage, je Termin eine Zeile. */
  catchUp: TodayUnitOption[];
  /** Workouts ohne offenen Termin ab heute, nach Name. */
  spontaneous: TodayUnitOption[];
  /** Je Workout der nächste offene Termin ab heute, ohne den Lime-Termin, nach Datum. */
  planned: TodayUnitOption[];
}

/**
 * Die Auswahl für „Jetzt trainieren".
 *
 * `openEntries` sind die offenen Termine ab dem Anfang des Fensters; Lauf-
 * Termine und Termine gelöschter Workouts fallen weg. Ein Workout kann unter
 * „Nachholen" und unter „Geplant" stehen - das sind zwei verschiedene
 * Termine. „Spontan" ist alles, was ab heute nirgends mehr im Plan steht.
 */
export function buildNowSections(input: {
  templates: Pick<WorkoutTemplate, 'id' | 'name' | 'category' | 'steps'>[];
  openEntries: PlanEntry[];
  recency: Record<string, string>;
  minutesByTemplate: Record<string, number>;
  exerciseCountByTemplate: Record<string, number>;
  /**
   * Je Workout die Zeile der Einschränkungen, für heute gerechnet: jeder
   * Start aus dem Jetzt-Sheet - auch Nachholen und Vorziehen - ist heute.
   */
  restrictionSummaryByTemplate?: Record<string, string>;
  today: Date;
}): NowSections {
  const byId = new Map(input.templates.map((template) => [template.id, template]));
  const todayKey = toDateInputValue(input.today);
  const windowStart = shiftDateKey(todayKey, -PLAN_SHIFT_WINDOW_DAYS) ?? todayKey;

  const toOption = (
    template: Pick<WorkoutTemplate, 'id' | 'name' | 'category' | 'steps'>,
    entry?: PlanEntry,
  ): TodayUnitOption => ({
    templateId: template.id,
    name: template.name,
    kind: resolveWorkoutCategory(template.category),
    lastTrained: describeLastTrained(input.recency[template.id], input.today),
    minutes: input.minutesByTemplate[template.id] ?? 0,
    exerciseCount: input.exerciseCountByTemplate[template.id] ?? 0,
    guided: isGuidedTemplate(template),
    ...(entry ? { planEntry: { id: entry.id, date: entry.date } } : {}),
    ...(input.restrictionSummaryByTemplate?.[template.id]
      ? { restrictionSummary: input.restrictionSummaryByTemplate[template.id] }
      : {}),
  });

  // Lauf-Termine und Termine gelöschter Workouts fallen weg.
  const rows = sortPlanEntries(input.openEntries).flatMap((entry) => {
    const template =
      entry.kind === 'workout' && entry.templateId ? byId.get(entry.templateId) : undefined;

    return template ? [{ entry, template }] : [];
  });

  const first = rows.find((row) => row.entry.date === todayKey);
  const catchUp = rows
    .filter((row) => row.entry.date >= windowStart && row.entry.date < todayKey)
    .map((row) => toOption(row.template, row.entry));

  const plannedIds = new Set<string>();
  const planned: TodayUnitOption[] = [];

  for (const row of rows) {
    if (row.entry.date < todayKey) {
      continue;
    }

    const alreadyShown = row === first || plannedIds.has(row.template.id);

    // Auch der Lime-Termin macht sein Workout zu einem geplanten - er steht nur schon oben.
    plannedIds.add(row.template.id);

    if (!alreadyShown) {
      planned.push(toOption(row.template, row.entry));
    }
  }

  const spontaneous = input.templates
    .filter((template) => !plannedIds.has(template.id))
    .map((template) => toOption(template))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));

  return {
    now: first ? toOption(first.template, first.entry) : undefined,
    catchUp,
    spontaneous,
    planned,
  };
}
