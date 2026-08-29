import { parseLocalDate, startOfCalendarWeek } from '@/domain/calendar-week';
import type { ProgramWeek, WorkoutTemplate } from '@/domain/models';

/**
 * Wann ist was dran?
 *
 * Der Wochenplan im Datenmodell besteht aus genau einem Feld -
 * `WorkoutTemplate.scheduledWeekdays` - und wiederholt sich in jeder
 * Programmwoche gleich. Was die Wochen voneinander unterscheidet, ist nicht der
 * Plan, sondern der *Zustand*: was ist erledigt, was steht noch aus, was ist
 * ausgefallen. Genau das rechnet dieses Modul aus, pur und ohne Dexie.
 *
 * Zwei Grenzen sind Absicht:
 *
 * - **Ohne `Program.startedOn` gibt es keine Termine.** Dann trägt kein Tag ein
 *   Datum, keiner ist "heute", und erledigt kann nichts sein - eine
 *   Programmwoche sagt für sich genommen nicht, welcher Montag gerade war.
 *   Ein geratenes Datum wäre dieselbe stille Erfindung wie ein geratener
 *   Progressionsschritt.
 * - **Erledigt kommt aus dem Verlauf, nie aus dem Plan.** Eine abgeschlossene
 *   Einheit zählt auf den Kalendertag ihres `completedAt`, auch wenn sie an
 *   einem Tag lief, an dem sie nicht geplant war. Der Kalender darf der
 *   Wirklichkeit nicht widersprechen.
 */

const DAYS_PER_WEEK = 7;

export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Montag bis Sonntag, in genau der Reihenfolge, in der das Raster sie zeigt. */
export const ISO_WEEKDAYS: readonly IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];

/**
 * Wochentagskürzel, indiziert über den ISO-Tag (1 = Montag).
 *
 * Von Hand und nicht über `Intl`: `de-DE` liefert "Mo." mit Punkt, die Spalte
 * im Raster und im Analyse-Export soll aber zweistellig sein. Außerdem bleibt
 * beides damit unabhängig von der ICU-Datenlage des Geräts.
 */
const SHORT_LABELS: Record<IsoWeekday, string> = {
  1: 'Mo',
  2: 'Di',
  3: 'Mi',
  4: 'Do',
  5: 'Fr',
  6: 'Sa',
  7: 'So',
};

const LONG_LABELS: Record<IsoWeekday, string> = {
  1: 'Montag',
  2: 'Dienstag',
  3: 'Mittwoch',
  4: 'Donnerstag',
  5: 'Freitag',
  6: 'Samstag',
  7: 'Sonntag',
};

/** `Date.getDay()` zählt ab Sonntag - hier wird daraus der ISO-Tag. */
export function isoWeekday(date: Date): IsoWeekday {
  return (((date.getDay() + 6) % DAYS_PER_WEEK) + 1) as IsoWeekday;
}

export function weekdayShortLabel(day: IsoWeekday): string {
  return SHORT_LABELS[day];
}

export function weekdayLongLabel(day: IsoWeekday): string {
  return LONG_LABELS[day];
}

/**
 * Räumt die gespeicherten Wochentage auf: sortiert, ohne Duplikate, ohne
 * alles außerhalb von 1 bis 7.
 *
 * Liefert `undefined`, wenn nichts übrig bleibt - "kein fester Tag" hat damit
 * genau eine Schreibweise, so wie `normalizeTracksHeight` nie ein `false`
 * schreibt.
 */
export function normalizeScheduledWeekdays(days?: number[] | null): IsoWeekday[] | undefined {
  if (!days) {
    return undefined;
  }

  const valid = ISO_WEEKDAYS.filter((day) => days.includes(day));

  return valid.length > 0 ? valid : undefined;
}

/**
 * Der Montag, an dem Programmwoche `weekNumber` beginnt.
 *
 * Die Umkehrung von `deriveProgramWeek` und die einzige Stelle, die sie
 * bildet. Gerechnet wird über `setDate`, nicht über `n * 7 * 24h`: an der
 * Zeitumstellung ist eine Woche 167 oder 169 Stunden lang, und eine
 * Millisekundenrechnung schöbe den Wochenanfang um eine Stunde über die
 * Mitternachtsgrenze.
 */
export function programWeekStart(startedOn: string, weekNumber: number): Date | undefined {
  const parsed = parseLocalDate(startedOn);

  if (!parsed || weekNumber < 1) {
    return undefined;
  }

  const start = startOfCalendarWeek(parsed);

  start.setDate(start.getDate() + (weekNumber - 1) * DAYS_PER_WEEK);

  return start;
}

/**
 * Was ein Tag im Raster zeigt.
 *
 * `leer` heißt: hier ist nichts geplant und nichts passiert. `verpasst` ist
 * bewusst nicht rot - Rot bedeutet in dieser App "übersprungen oder gelöscht",
 * und ein ausgefallener Montag ist keins von beidem.
 */
export type CalendarDayState = 'leer' | 'geplant' | 'erledigt' | 'teilweise' | 'verpasst';

export interface CalendarTemplateRef {
  id: string;
  name: string;
}

export interface CalendarDay {
  isoWeekday: IsoWeekday;
  /** Fehlt ohne `Program.startedOn` - dann kennt der Kalender keine Termine. */
  date?: Date;
  isToday: boolean;
  /** Was laut Wochenplan an diesem Tag ansteht. */
  planned: CalendarTemplateRef[];
  /** Was an diesem Tag tatsächlich abgeschlossen wurde - auch Ungeplantes. */
  done: CalendarTemplateRef[];
  state: CalendarDayState;
}

export interface CalendarWeekRow {
  weekNumber: number;
  label?: string;
  kind?: ProgramWeek['kind'];
  start?: Date;
  /** Der Sonntag derselben Woche - für die Bereichsangabe in der Zeile. */
  end?: Date;
  /** Die Woche, in der die nächste Einheit tatsächlich startet. */
  isEffective: boolean;
  /** Immer sieben Einträge, Montag bis Sonntag. */
  days: CalendarDay[];
  /**
   * Ob in dieser Woche ein Seitenvergleich ansteht.
   *
   * Kommt aus `ProgramWeek.kind` und wird ausschließlich *angezeigt*. Nichts
   * verzweigt darauf - nicht `materializeSession`, nicht `resolveWeekControl`,
   * nicht `startSessionFromTemplate`; die Art einer Woche bleibt beschreibend.
   */
  hasTestAppointment: boolean;
  testDone: boolean;
}

export interface BuildTrainingCalendarInput {
  weeks: ProgramWeek[];
  templates: WorkoutTemplate[];
  startedOn?: string;
  effectiveWeek: number;
  completedSessions: { templateId: string; templateName: string; completedAt: string }[];
  /** `recordedAt` der Seitenvergleiche - mehr braucht die Woche nicht. */
  testDates: string[];
  now: Date;
}

/** Gleicher Kalendertag in Ortszeit - nicht über die ISO-Zeichenkette. */
function isSameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function startOfDay(date: Date): Date {
  const value = new Date(date.getTime());

  value.setHours(0, 0, 0, 0);

  return value;
}

/** Die Workouts, die an diesem Wochentag anstehen - in Namensreihenfolge. */
export function templatesOnWeekday(
  templates: WorkoutTemplate[],
  day: IsoWeekday,
): CalendarTemplateRef[] {
  return templates
    .filter((template) => normalizeScheduledWeekdays(template.scheduledWeekdays)?.includes(day))
    .map((template) => ({ id: template.id, name: template.name }))
    .sort((left, right) => left.name.localeCompare(right.name, 'de'));
}

/**
 * Workouts ohne festen Tag.
 *
 * Sie stehen im Kalender unter dem Raster, statt still herauszufallen: ein
 * Workout, das aus einer Übersicht verschwindet, ist der teuerste Fehler, den
 * diese Seite machen kann.
 */
export function templatesWithoutSchedule(templates: WorkoutTemplate[]): CalendarTemplateRef[] {
  return templates
    .filter((template) => normalizeScheduledWeekdays(template.scheduledWeekdays) === undefined)
    .map((template) => ({ id: template.id, name: template.name }))
    .sort((left, right) => left.name.localeCompare(right.name, 'de'));
}

/** Geplante und davon erledigte Einheiten einer Woche - für die Ansage der Zeile. */
export function countWeekProgress(row: CalendarWeekRow): { planned: number; done: number } {
  let planned = 0;
  let done = 0;

  for (const day of row.days) {
    planned += day.planned.length;
    done += day.planned.filter((template) =>
      day.done.some((entry) => entry.id === template.id),
    ).length;
  }

  return { planned, done };
}

export function buildTrainingCalendar({
  weeks,
  templates,
  startedOn,
  effectiveWeek,
  completedSessions,
  testDates,
  now,
}: BuildTrainingCalendarInput): CalendarWeekRow[] {
  const today = startOfDay(now);
  const plannedByWeekday = new Map<IsoWeekday, CalendarTemplateRef[]>(
    ISO_WEEKDAYS.map((day) => [day, templatesOnWeekday(templates, day)]),
  );

  const sessionDates = completedSessions.flatMap((session) => {
    const at = new Date(session.completedAt);

    return Number.isNaN(at.getTime())
      ? []
      : [{ at, ref: { id: session.templateId, name: session.templateName } }];
  });
  const testMoments = testDates.flatMap((value) => {
    const at = new Date(value);

    return Number.isNaN(at.getTime()) ? [] : [at.getTime()];
  });

  return [...weeks]
    .sort((left, right) => left.weekNumber - right.weekNumber)
    .map((week) => {
      const start = startedOn ? programWeekStart(startedOn, week.weekNumber) : undefined;
      const end = start ? new Date(start.getTime()) : undefined;

      end?.setDate(end.getDate() + DAYS_PER_WEEK - 1);

      const days = ISO_WEEKDAYS.map<CalendarDay>((day) => {
        const planned = plannedByWeekday.get(day) ?? [];
        const date = start ? new Date(start.getTime()) : undefined;

        date?.setDate(date.getDate() + (day - 1));

        const done = date
          ? sessionDates
              .filter((session) => isSameDay(session.at, date))
              .map((session) => session.ref)
          : [];
        const isToday = date ? isSameDay(date, today) : false;

        return {
          isoWeekday: day,
          date,
          isToday,
          planned,
          done,
          state: resolveDayState({ planned, done, date, today }),
        };
      });

      /*
       * Das Wochenende wird über `setDate(+7)` gebildet und nicht über sieben
       * mal 24 Stunden - dieselbe Begründung wie in `isInCalendarWeek`.
       */
      const testWindowEnd = start ? new Date(start.getTime()) : undefined;

      testWindowEnd?.setDate(testWindowEnd.getDate() + DAYS_PER_WEEK);

      return {
        weekNumber: week.weekNumber,
        label: week.label,
        kind: week.kind,
        start,
        end,
        isEffective: week.weekNumber === effectiveWeek,
        days,
        hasTestAppointment: week.kind === 'test',
        testDone:
          start !== undefined &&
          testWindowEnd !== undefined &&
          testMoments.some(
            (moment) => moment >= start.getTime() && moment < testWindowEnd.getTime(),
          ),
      };
    });
}

function resolveDayState({
  planned,
  done,
  date,
  today,
}: {
  planned: CalendarTemplateRef[];
  done: CalendarTemplateRef[];
  date?: Date;
  today: Date;
}): CalendarDayState {
  /*
   * Ohne Datum gibt es keinen Zustand, nur den Plan: die Zuordnung
   * Programmwoche -> Kalendertag fehlt, und "erledigt" wäre geraten.
   */
  if (!date) {
    return planned.length > 0 ? 'geplant' : 'leer';
  }

  if (done.length > 0) {
    const openPlanned = planned.filter(
      (template) => !done.some((entry) => entry.id === template.id),
    );

    return openPlanned.length === 0 ? 'erledigt' : 'teilweise';
  }

  if (planned.length === 0) {
    return 'leer';
  }

  return date.getTime() < today.getTime() ? 'verpasst' : 'geplant';
}
