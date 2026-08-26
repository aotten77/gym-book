import { calendarWeeksBetween, startOfCalendarWeek } from '@/domain/calendar-week';
import type { AppSettings, Program, ProgramWeek } from '@/domain/models';

export interface WeekControl {
  effectiveWeek: number;
  maxWeek: number;
  /**
   * Woher die wirksame Woche kommt.
   *
   * `derived` heißt: sie läuft mit dem Kalender, seit dem Startdatum des
   * Programms. `override` ist die Übersteuerung von Hand, `program` die alte
   * Zahl am Programm, `none` der Notnagel ohne Programm.
   */
  mode: 'override' | 'derived' | 'program' | 'none';
  /** Die aus dem Startdatum abgeleitete Woche - auch wenn ein Override gilt. */
  derivedWeek?: number;
}

/**
 * Programmwoche aus dem Startdatum.
 *
 * Kalendarisch, nicht nach gezählten Einheiten: eine ausgefallene Woche ist
 * eine ausgefallene Woche und schiebt das Programm nicht nach hinten. Nach der
 * letzten Woche bleibt der Wert stehen, statt umzulaufen - ein Zyklus wäre
 * eine Automatik, und die entscheidet der Mensch (v1 kennt keine
 * Deload-Automatik).
 *
 * Ein Startdatum in der Zukunft ergibt Woche 1: das Programm hat noch nicht
 * begonnen, und eine Null oder eine negative Woche gibt es nicht.
 */
export function deriveProgramWeek(startedOn: string, now: Date, maxWeek: number) {
  const weeks = calendarWeeksBetween(startedOn, now);

  if (weeks === undefined) {
    return undefined;
  }

  return Math.min(Math.max(weeks + 1, 1), Math.max(1, maxWeek));
}

/**
 * Löst die aktuell wirksame Woche auf und liefert dieselbe Obergrenze für
 * Home und Settings - die beiden Seiten wichen vorher in der maxWeek-Formel
 * voneinander ab (Home bezog einen Override oberhalb der höchsten
 * Programmwoche mit ein, Settings nicht).
 *
 * Die Rangfolge ist `Override → Startdatum → activeWeek → 1`. Der Override
 * steht bewusst ganz oben und ist trotzdem nicht der Normalfall: er gilt, bis
 * er zurückgesetzt wird, und genau deshalb wird er nur noch bewusst gesetzt.
 */
export function resolveWeekControl(
  weekOverride: AppSettings['weekOverride'],
  program: Program | undefined,
  programWeeks: ProgramWeek[],
  now: Date = new Date(),
): WeekControl {
  const maxWeek = Math.max(
    1,
    program?.activeWeek ?? 1,
    weekOverride ?? 1,
    ...programWeeks.map((week) => week.weekNumber),
  );
  const plannedWeeks = Math.max(1, ...programWeeks.map((week) => week.weekNumber));
  const derivedWeek = program?.startedOn
    ? deriveProgramWeek(program.startedOn, now, plannedWeeks)
    : undefined;
  const effectiveWeek = weekOverride ?? derivedWeek ?? program?.activeWeek ?? 1;
  const mode = weekOverride
    ? 'override'
    : derivedWeek
      ? 'derived'
      : program
        ? 'program'
        : 'none';

  return { effectiveWeek, maxWeek, mode, derivedWeek };
}

/**
 * Vorschlag für ein fehlendes Startdatum: der Montag der Woche, in der das
 * Programm angelegt wurde.
 *
 * Nur ein Vorschlag - wer sein Programm später eingetragen hat als er es
 * begonnen hat, korrigiert das Datum im Dialog. Als Format `YYYY-MM-DD`, damit
 * es in ein `<input type="date">` passt.
 */
export function suggestProgramStart(program: Program): string {
  const monday = startOfCalendarWeek(new Date(program.createdAt));

  return toDateInputValue(Number.isNaN(monday.getTime()) ? startOfCalendarWeek(new Date()) : monday);
}

/** Ein Datum als `YYYY-MM-DD` in Ortszeit - nicht über `toISOString()`. */
export function toDateInputValue(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');

  return `${date.getFullYear()}-${month}-${day}`;
}
