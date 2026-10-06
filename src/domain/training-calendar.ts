import { parseLocalDate, startOfCalendarWeek } from '@/domain/calendar-week';
import type { PlanEntry, ProgramWeek } from '@/domain/models';
import { doneDayOf, planEntryName, planEntryState, type PlanEntryLink } from '@/domain/plan';
import { toDateInputValue } from '@/domain/program';

/**
 * Wann ist was dran?
 *
 * Der Kalender liest die datierten Termine (`PlanEntry`) und die Läufe, die
 * tatsächlich stattfanden. Was Programmwochen voneinander unterscheidet, ist
 * nicht ein Plan je Woche, sondern der *Zustand* ihrer Tage: was ist erledigt,
 * was steht noch aus, was ist ausgefallen. Genau das rechnet dieses Modul aus,
 * pur und ohne Dexie.
 *
 * `WorkoutTemplate.scheduledWeekdays` ist nicht mehr der Plan - das Feld bleibt
 * im Datenmodell (und `normalizeScheduledWeekdays` für die Serien), aber der
 * Kalender fragt es nicht mehr.
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
 *   einem Tag lief, an dem sie nicht geplant war. Ein Termin, der an einem
 *   anderen Tag erledigt wurde, steht an seinem eigenen Tag nicht mehr - der
 *   Kalender darf der Wirklichkeit nicht widersprechen.
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

/** Eine Einheit im Raster: ein Termin (`id` = Termin-Id) oder eine erledigte Session bzw. ein Lauf. */
export interface CalendarUnitRef {
  id: string;
  name: string;
  kind: 'workout' | 'run';
}

export interface CalendarDay {
  isoWeekday: IsoWeekday;
  /** Fehlt ohne `Program.startedOn` - dann kennt der Kalender keine Termine. */
  date?: Date;
  isToday: boolean;
  /** Termine dieses Tages, die nicht erledigt sind - oder an diesem Tag erledigt wurden. */
  planned: CalendarUnitRef[];
  /** Wie viele davon an diesem Tag erledigt wurden. */
  plannedDone: number;
  /** Alle Termine, die auf diesen Tag datiert sind - auch ein anderswo erledigter. Grundlage der Wochenzählung. */
  dated: number;
  /** Wie viele davon erledigt sind, an welchem Tag auch immer. */
  datedDone: number;
  /** Was an diesem Tag tatsächlich abgeschlossen wurde (Sessions und Läufe) - auch Ungeplantes. */
  done: CalendarUnitRef[];
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
  planEntries: PlanEntry[];
  planLinks: Record<string, PlanEntryLink>;
  templateNames: Record<string, string>;
  /** Alle Läufe des Zeitraums, mit oder ohne Termin. */
  runs: { id: string; date: string }[];
  startedOn?: string;
  effectiveWeek: number;
  completedSessions: { id: string; templateId: string; templateName: string; completedAt: string }[];
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

/** Geplante und davon erledigte Einheiten einer Woche - für die Ansage der Zeile. */
export function countWeekProgress(row: CalendarWeekRow): { planned: number; done: number } {
  let planned = 0;
  let done = 0;

  for (const day of row.days) {
    planned += day.dated;
    done += day.datedDone;
  }

  return { planned, done };
}

export function buildTrainingCalendar({
  weeks,
  planEntries,
  planLinks,
  templateNames,
  runs,
  startedOn,
  effectiveWeek,
  completedSessions,
  testDates,
  now,
}: BuildTrainingCalendarInput): CalendarWeekRow[] {
  const today = startOfDay(now);

  /* Termine je Kalendertag, in der Reihenfolge des Tages. */
  const entriesByDay = new Map<string, PlanEntry[]>();

  for (const entry of [...planEntries].sort((a, b) => a.orderInDay - b.orderInDay)) {
    entriesByDay.set(entry.date, [...(entriesByDay.get(entry.date) ?? []), entry]);
  }

  const doneByDay = new Map<string, CalendarUnitRef[]>();
  const addDone = (day: string, unit: CalendarUnitRef) => {
    doneByDay.set(day, [...(doneByDay.get(day) ?? []), unit]);
  };

  for (const session of completedSessions) {
    const at = new Date(session.completedAt);

    if (!Number.isNaN(at.getTime())) {
      addDone(toDateInputValue(at), { id: session.id, name: session.templateName, kind: 'workout' });
    }
  }

  for (const run of runs) {
    addDone(run.date, { id: run.id, name: 'Lauf', kind: 'run' });
  }

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
        const date = start ? new Date(start.getTime()) : undefined;

        date?.setDate(date.getDate() + (day - 1));

        /* Ohne Datum kein Tag - und damit weder Termin noch erledigte Einheit. */
        if (!date) {
          return {
            isoWeekday: day,
            isToday: false,
            planned: [],
            plannedDone: 0,
            dated: 0,
            datedDone: 0,
            done: [],
            state: 'leer',
          };
        }

        const key = toDateInputValue(date);
        const datedEntries = entriesByDay.get(key) ?? [];
        const plannedEntries = datedEntries.filter((entry) => {
          const link = planLinks[entry.id];

          return planEntryState(entry.id, planLinks) !== 'erledigt' || (link && doneDayOf(link) === key);
        });
        const planned = plannedEntries.map<CalendarUnitRef>((entry) => ({
          id: entry.id,
          name: planEntryName(entry, templateNames, planLinks),
          kind: entry.kind,
        }));
        const openPlanned = plannedEntries.filter(
          (entry) => planEntryState(entry.id, planLinks) !== 'erledigt',
        ).length;
        const done = doneByDay.get(key) ?? [];

        return {
          isoWeekday: day,
          date,
          isToday: isSameDay(date, today),
          planned,
          plannedDone: planned.length - openPlanned,
          dated: datedEntries.length,
          datedDone: datedEntries.filter((entry) => planEntryState(entry.id, planLinks) === 'erledigt')
            .length,
          done,
          state: resolveDayState({ openPlanned, doneCount: done.length, date, today }),
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
  openPlanned,
  doneCount,
  date,
  today,
}: {
  openPlanned: number;
  doneCount: number;
  date: Date;
  today: Date;
}): CalendarDayState {
  if (doneCount > 0) {
    return openPlanned === 0 ? 'erledigt' : 'teilweise';
  }

  if (openPlanned === 0) {
    return 'leer';
  }

  return date.getTime() < today.getTime() ? 'verpasst' : 'geplant';
}
