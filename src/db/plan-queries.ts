import { db } from '@/db/appDb';
import { startOfCalendarWeek, parseLocalDate } from '@/domain/calendar-week';
import type { PlanEntry } from '@/domain/models';
import { buildPlanLinks, planEntryState, sortPlanEntries, type PlanEntryLink } from '@/domain/plan';
import { toDateInputValue } from '@/domain/program';

/*
 * Leseseite des datierten Trainingsplans. Die Termine kommen über den
 * `date`-Index, ob sie belegt oder erledigt sind über die Verweise, die
 * Sessions und Läufe auf sie tragen (`planEntryId`).
 */

export interface PlanWithLinks {
  entries: PlanEntry[];
  links: Record<string, PlanEntryLink>;
}

async function attachLinks(entries: PlanEntry[]): Promise<PlanWithLinks> {
  const sorted = sortPlanEntries(entries);
  const ids = sorted.map((entry) => entry.id);

  if (ids.length === 0) {
    return { entries: sorted, links: {} };
  }

  const [sessions, runs] = await Promise.all([
    db.workoutSessions.where('planEntryId').anyOf(ids).toArray(),
    db.runLogs.where('planEntryId').anyOf(ids).toArray(),
  ]);

  return { entries: sorted, links: buildPlanLinks(sessions, runs) };
}

/** Alle Termine von `from` bis `to`, beide Tage (`YYYY-MM-DD`) eingeschlossen, sortiert, mit Verweisen. */
export async function loadPlanBetween(from: string, to: string): Promise<PlanWithLinks> {
  const entries = await db.planEntries.where('date').between(from, to, true, true).toArray();

  return attachLinks(entries);
}

/** Alle Termine ab `today` (einschließlich), sortiert, mit Verweisen. */
export async function loadUpcomingPlan(today: string): Promise<PlanWithLinks> {
  const entries = await db.planEntries.where('date').aboveOrEqual(today).toArray();

  return attachLinks(entries);
}

/**
 * Welche Lauf-Termine ein Lauf an `day` erfüllen kann: die offenen der
 * Kalenderwoche von `day` (Montag bis Sonntag) - plus der, auf den
 * `currentRunId` schon zeigt, damit ein bestehender Lauf seinen Termin
 * behalten kann.
 */
export async function loadRunPlanOptions(day: string, currentRunId?: string): Promise<PlanEntry[]> {
  const parsed = parseLocalDate(day);

  if (!parsed) {
    return [];
  }

  const weekStart = startOfCalendarWeek(parsed);
  const weekEnd = new Date(weekStart.getTime());

  weekEnd.setDate(weekEnd.getDate() + 6);

  const { entries, links } = await loadPlanBetween(
    toDateInputValue(weekStart),
    toDateInputValue(weekEnd),
  );
  /* Der Termin des eigenen Laufs bleibt wählbar, auch aus einer anderen Woche. */
  const ownEntryId = currentRunId ? (await db.runLogs.get(currentRunId))?.planEntryId : undefined;
  const own =
    ownEntryId && !entries.some((entry) => entry.id === ownEntryId)
      ? await db.planEntries.get(ownEntryId)
      : undefined;

  return sortPlanEntries(
    [...entries, ...(own?.kind === 'run' ? [own] : [])].filter(
      (entry) =>
        entry.kind === 'run' &&
        (entry.id === ownEntryId || planEntryState(entry.id, links) === 'offen'),
    ),
  );
}
