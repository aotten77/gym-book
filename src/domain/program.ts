import type { AppSettings, Program, ProgramWeek } from '@/domain/models';

export interface WeekControl {
  effectiveWeek: number;
  maxWeek: number;
  mode: 'override' | 'program' | 'none';
}

/**
 * Löst die aktuell wirksame Woche auf und liefert dieselbe Obergrenze für
 * Home und Settings - die beiden Seiten wichen vorher in der maxWeek-Formel
 * voneinander ab (Home bezog einen Override oberhalb der höchsten
 * Programmwoche mit ein, Settings nicht).
 */
export function resolveWeekControl(
  weekOverride: AppSettings['weekOverride'],
  program: Program | undefined,
  programWeeks: ProgramWeek[],
): WeekControl {
  const maxWeek = Math.max(
    1,
    program?.activeWeek ?? 1,
    weekOverride ?? 1,
    ...programWeeks.map((week) => week.weekNumber),
  );
  const effectiveWeek = weekOverride ?? program?.activeWeek ?? 1;
  const mode = weekOverride ? 'override' : program ? 'program' : 'none';

  return { effectiveWeek, maxWeek, mode };
}
