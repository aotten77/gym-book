import type { PlanEntry, WorkoutTemplate } from '@/domain/models';
import { isoWeekday, weekdayShortLabel } from '@/domain/training-calendar';
import { resolveWorkoutCategory } from '@/domain/workout-category';
import { formatShortDate } from '@/lib/format';

export interface TodayUnitOption {
  templateId: string;
  name: string;
  kind: 'strength' | 'mobility';
  lastTrained: string;
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
 * Die Auswahl für „Heute trainieren": zuerst die Workouts der heutigen Termine
 * (je Workout einmal, in Tagesreihenfolge), danach alle übrigen nach Name.
 * Ein Termin ist ein Angebot, kein Schloss - deshalb bleibt jedes Workout wählbar.
 */
export function buildTodayUnitOptions(input: {
  templates: Pick<WorkoutTemplate, 'id' | 'name' | 'category'>[];
  plannedToday: PlanEntry[];
  recency: Record<string, string>;
  today: Date;
}): { planned: TodayUnitOption[]; others: TodayUnitOption[] } {
  const byId = new Map(input.templates.map((template) => [template.id, template]));

  const toOption = (template: Pick<WorkoutTemplate, 'id' | 'name' | 'category'>): TodayUnitOption => ({
    templateId: template.id,
    name: template.name,
    kind: resolveWorkoutCategory(template.category),
    lastTrained: describeLastTrained(input.recency[template.id], input.today),
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
    planned.push(toOption(template));
  }

  const others = input.templates
    .filter((template) => !plannedIds.has(template.id))
    .map(toOption)
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));

  return { planned, others };
}
