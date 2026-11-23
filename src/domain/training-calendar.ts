import { parseLocalDate, startOfCalendarWeek } from '@/domain/calendar-week';
import type {
  ExerciseTest,
  PlanEntry,
  Program,
  ProgramWeek,
  RunLog,
  WorkoutTemplate,
} from '@/domain/models';
import {
  describeRunTarget,
  planEntryName,
  planEntryState,
  type PlanEntryLink,
} from '@/domain/plan';
import { describeWeekKind } from '@/domain/program-plan';
import { toDateInputValue } from '@/domain/program';
import { formatPace, formatRunDuration, paceSecondsPerKm } from '@/domain/run';
import {
  resolveWorkoutCategory,
  type WorkoutCategory,
} from '@/domain/workout-category';
import {
  formatDurationHours,
  formatNumber,
  formatShortDate,
} from '@/lib/format';

/**
 * Wann ist was dran?
 *
 * Das Raster läuft über Kalenderwochen (siehe "Kalenderwochen" weiter unten);
 * `Program.startedOn` liefert nur noch die "W..."-Beschriftung. Der Kalender
 * liest die datierten Termine (`PlanEntry`), die abgeschlossenen Sessions und
 * die Läufe, die tatsächlich stattfanden - pur und ohne Dexie.
 *
 * `WorkoutTemplate.scheduledWeekdays` ist nicht mehr der Plan - das Feld bleibt
 * im Datenmodell (und `normalizeScheduledWeekdays` für die Umwandlung in
 * `data-fix-actions` und `plan.ts`), aber der
 * Kalender fragt es nicht mehr.
 *
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

/** `Date.getDay()` zählt ab Sonntag - hier wird daraus der ISO-Tag. */
export function isoWeekday(date: Date): IsoWeekday {
  return (((date.getDay() + 6) % DAYS_PER_WEEK) + 1) as IsoWeekday;
}

export function weekdayShortLabel(day: IsoWeekday): string {
  return SHORT_LABELS[day];
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

/** Geplante und davon erledigte Einheiten einer Woche - für die Ansage der Zeile. */
export function countWeekProgress(row: { days: { dated: number; datedDone: number }[] }): { planned: number; done: number } {
  let planned = 0;
  let done = 0;

  for (const day of row.days) {
    planned += day.dated;
    done += day.datedDone;
  }

  return { planned, done };
}

/*
 * ---------------------------------------------------------------------------
 * Kalenderwochen (Teil 3)
 *
 * Das Raster läuft nicht mehr über Programmwochen, sondern über Kalenderwochen
 * ab einem Fenster (`firstMonday`, `weeks` Zeilen). Eine Programmwoche ist
 * nur noch eine Beschriftung ("W3"), und sie gibt es nur, wo `Program.startedOn`
 * sie zu genau diesem Montag macht - `programWeekStart` bleibt die einzige
 * Umkehrung von `deriveProgramWeek`. Ohne Startdatum fehlen also nur die
 * "W..."-Beschriftungen; Termine, Sessions und Läufe tragen ihr Datum selbst.
 *
 * Eine Einheit ist entweder erledigt (aus dem Verlauf: abgeschlossene Session
 * am lokalen Tag ihres `completedAt`, Lauf an seinem `date`) oder geplant (ein
 * offener oder belegter Termin, heute oder später). Ein vergangener offener
 * Termin verschwindet (ein belegter nicht) - der Kalender zeigt, was war und was kommt.
 * ---------------------------------------------------------------------------
 */

/** Der Zeitstrahl beginnt so viele Wochen vor der laufenden und lädt so viele nach. */
export const TIMELINE_INITIAL_PAST_WEEKS = 4;
export const TIMELINE_LOAD_STEP_WEEKS = 4;

/** Eine abgeschlossene Session, so wie der Kalender sie braucht. */
export interface CalendarSession {
  id: string;
  templateId: string;
  templateName: string;
  startedAt: string;
  completedAt: string;
  templateCategorySnapshot?: WorkoutCategory;
  planEntryId?: string;
}

export type CalendarRun = Pick<
  RunLog,
  'id' | 'date' | 'distanceKm' | 'durationSeconds' | 'planEntryId' | 'runPlanSnapshot'
>;

/** Ein Seitenvergleich, so wie der Kalender ihn braucht. */
export type CalendarTest = Pick<
  ExerciseTest,
  'id' | 'recordedAt' | 'exerciseNameSnapshot' | 'asymmetryPercent'
>;

export type CalendarUnitKind = WorkoutCategory | 'run' | 'test';
export type CalendarUnitState = 'geplant' | 'erledigt';

/** Wohin ein Tipp auf die Einheit führt. */
export type CalendarUnitTarget =
  | { type: 'session'; sessionId: string }
  | { type: 'active-session'; sessionId: string }
  | { type: 'run'; runId: string }
  | { type: 'test'; testId: string }
  | { type: 'entry'; entry: PlanEntry };

export interface CalendarUnit {
  kind: CalendarUnitKind;
  state: CalendarUnitState;
  name: string;
  ref: CalendarUnitTarget;
  /** Fehlt nur bei ungeplant Erledigtem. */
  planEntryId?: string;
  durationSeconds?: number;
  distanceKm?: number;
  /** Nur bei Seitenvergleichen. */
  asymmetryPercent?: number;
}

export type CalendarDayStatus = 'leer' | 'geplant' | 'erledigt';

export interface CalendarWeekDay {
  date: Date;
  key: string;
  isoWeekday: IsoWeekday;
  isToday: boolean;
  isPast: boolean;
  /** Erledigte vor geplanten. */
  units: CalendarUnit[];
  state: CalendarDayStatus;
  /** Auf diesen Tag datierte Termine - auch ein anderswo erledigter. Grundlage von `countWeekProgress`. */
  dated: number;
  datedDone: number;
}

export interface CalendarWeek {
  start: Date;
  key: string;
  end: Date;
  isCurrent: boolean;
  /** Nur mit `Program.startedOn` und nur, wo eine geplante Programmwoche auf diesen Montag fällt. */
  programWeek?: { number: number; label?: string; kind?: ProgramWeek['kind'] };
  days: CalendarWeekDay[];
  /** Wird nur *angezeigt*; nichts verzweigt auf `ProgramWeek.kind`. */
  hasTestAppointment: boolean;
  testDone: boolean;
}

export interface BuildCalendarWeeksInput {
  firstMonday: Date;
  weeks: number;
  today: Date;
  program?: Pick<Program, 'startedOn'>;
  programWeeks: ProgramWeek[];
  planEntries: PlanEntry[];
  planLinks: Record<string, PlanEntryLink>;
  templates: Pick<WorkoutTemplate, 'id' | 'name' | 'category'>[];
  completedSessions: CalendarSession[];
  runs: CalendarRun[];
  /** Die Seitenvergleiche; sie stehen als erledigte Einheit am Tag ihres `recordedAt`. */
  tests: CalendarTest[];
}

export function buildCalendarWeeks({
  firstMonday,
  weeks,
  today,
  program,
  programWeeks,
  planEntries,
  planLinks,
  templates,
  completedSessions,
  runs,
  tests,
}: BuildCalendarWeeksInput): CalendarWeek[] {
  const todayKey = toDateInputValue(today);
  const templateNames: Record<string, string> = {};
  const templateById = new Map<string, Pick<WorkoutTemplate, 'id' | 'name' | 'category'>>();

  for (const template of templates) {
    templateNames[template.id] = template.name;
    templateById.set(template.id, template);
  }

  const entriesByDay = new Map<string, PlanEntry[]>();

  for (const entry of [...planEntries].sort((a, b) => a.orderInDay - b.orderInDay)) {
    entriesByDay.set(entry.date, [...(entriesByDay.get(entry.date) ?? []), entry]);
  }

  /* Erledigtes je Tag: Sessions nach `completedAt`, danach Läufe in Eingabereihenfolge, dann Tests nach `recordedAt`. */
  const doneByDay = new Map<string, CalendarUnit[]>();
  const addDone = (day: string, unit: CalendarUnit) => {
    doneByDay.set(day, [...(doneByDay.get(day) ?? []), unit]);
  };

  const datedSessions = completedSessions
    .map((session) => ({ session, at: new Date(session.completedAt) }))
    .filter(({ at }) => !Number.isNaN(at.getTime()))
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  for (const { session, at } of datedSessions) {
    const startedAt = new Date(session.startedAt).getTime();
    const seconds = Number.isNaN(startedAt)
      ? undefined
      : Math.max(0, Math.round((at.getTime() - startedAt) / 1000));

    addDone(toDateInputValue(at), {
      kind: resolveWorkoutCategory(session.templateCategorySnapshot),
      state: 'erledigt',
      name: session.templateName,
      ref: { type: 'session', sessionId: session.id },
      ...(session.planEntryId ? { planEntryId: session.planEntryId } : {}),
      ...(seconds !== undefined ? { durationSeconds: seconds } : {}),
    });
  }

  for (const run of runs) {
    addDone(run.date, {
      kind: 'run',
      state: 'erledigt',
      name: run.runPlanSnapshot?.title || 'Lauf',
      ref: { type: 'run', runId: run.id },
      ...(run.planEntryId ? { planEntryId: run.planEntryId } : {}),
      durationSeconds: run.durationSeconds,
      distanceKm: run.distanceKm,
    });
  }

  /* Programmwochen nach dem Montag, auf den sie fallen. */
  const programWeekByMonday = new Map<string, ProgramWeek>();

  if (program?.startedOn) {
    for (const programWeek of programWeeks) {
      const start = programWeekStart(program.startedOn, programWeek.weekNumber);

      if (start) {
        programWeekByMonday.set(toDateInputValue(start), programWeek);
      }
    }
  }

  const datedTests = tests
    .map((test) => ({ test, at: new Date(test.recordedAt) }))
    .filter(({ at }) => !Number.isNaN(at.getTime()))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  const testMoments = datedTests.map(({ at }) => at.getTime());

  for (const { test, at } of datedTests) {
    addDone(toDateInputValue(at), {
      kind: 'test',
      state: 'erledigt',
      name: test.exerciseNameSnapshot,
      ref: { type: 'test', testId: test.id },
      asymmetryPercent: test.asymmetryPercent,
    });
  }

  const rows: CalendarWeek[] = [];

  for (let index = 0; index < weeks; index += 1) {
    const start = new Date(firstMonday.getFullYear(), firstMonday.getMonth(), firstMonday.getDate());

    start.setDate(start.getDate() + index * DAYS_PER_WEEK);

    const key = toDateInputValue(start);
    const nextMonday = new Date(start.getTime());

    nextMonday.setDate(nextMonday.getDate() + DAYS_PER_WEEK);

    const end = new Date(start.getTime());

    end.setDate(end.getDate() + DAYS_PER_WEEK - 1);

    const days = ISO_WEEKDAYS.map<CalendarWeekDay>((weekday) => {
      const date = new Date(start.getTime());

      date.setDate(date.getDate() + (weekday - 1));

      const dayKey = toDateInputValue(date);
      const dated = entriesByDay.get(dayKey) ?? [];
      const doneUnits = doneByDay.get(dayKey) ?? [];
      /*
       * Offene Termine zählen ab heute; ein belegter (laufende Session) bleibt
       * auch dann auf seinem Tag stehen, wenn dieser zurückliegt - er läuft ja.
       */
      const plannedUnits = dated
        .filter((entry) => {
          const state = planEntryState(entry.id, planLinks);

          return state === 'belegt' || (state === 'offen' && dayKey >= todayKey);
        })
        .map<CalendarUnit>((entry) => {
          const link = planLinks[entry.id];
          const template = entry.templateId ? templateById.get(entry.templateId) : undefined;

          return {
            kind: entry.kind === 'run' ? 'run' : resolveWorkoutCategory(template?.category),
            state: 'geplant',
            name: planEntryName(entry, templateNames, planLinks),
            ref:
              link?.source === 'session' && !link.done
                ? { type: 'active-session', sessionId: link.sourceId }
                : { type: 'entry', entry },
            planEntryId: entry.id,
          };
        });
      const units = [...doneUnits, ...plannedUnits];

      return {
        date,
        key: dayKey,
        isoWeekday: weekday,
        isToday: dayKey === todayKey,
        isPast: dayKey < todayKey,
        units,
        state: doneUnits.length > 0 ? 'erledigt' : plannedUnits.length > 0 ? 'geplant' : 'leer',
        dated: dated.length,
        datedDone: dated.filter((entry) => planEntryState(entry.id, planLinks) === 'erledigt').length,
      };
    });

    const programWeek = programWeekByMonday.get(key);

    rows.push({
      start,
      key,
      end,
      isCurrent: todayKey >= key && todayKey <= toDateInputValue(end),
      ...(programWeek
        ? {
            programWeek: {
              number: programWeek.weekNumber,
              label: programWeek.label,
              kind: programWeek.kind,
            },
          }
        : {}),
      days,
      hasTestAppointment: programWeek?.kind === 'test',
      testDone: testMoments.some(
        (moment) => moment >= start.getTime() && moment < nextMonday.getTime(),
      ),
    });
  }

  return rows;
}

/** Das Fenster um `weeks` Wochen verschieben - über `setDate`, nie über Millisekunden. */
export function shiftWindow(firstMonday: Date, weeks: number): Date {
  const shifted = new Date(firstMonday.getFullYear(), firstMonday.getMonth(), firstMonday.getDate());

  shifted.setDate(shifted.getDate() + weeks * DAYS_PER_WEEK);

  return shifted;
}

/** Der erste Montag des Zeitstrahls: die laufende Woche minus `TIMELINE_INITIAL_PAST_WEEKS`. */
export function timelineFirstMonday(today: Date): Date {
  return shiftWindow(startOfCalendarWeek(today), -TIMELINE_INITIAL_PAST_WEEKS);
}

/**
 * Der letzte Montag des Zeitstrahls: der spätere von "nächste Woche" und der
 * Woche des letzten Termins. Ein fehlendes oder ungültiges Datum zählt nicht.
 */
export function timelineLastMonday(today: Date, lastPlanDate?: string): Date {
  const nextWeek = shiftWindow(startOfCalendarWeek(today), 1);
  const parsed = lastPlanDate ? parseLocalDate(lastPlanDate) : undefined;

  if (!parsed) {
    return nextWeek;
  }

  const planWeek = startOfCalendarWeek(parsed);

  return planWeek.getTime() > nextWeek.getTime() ? planWeek : nextWeek;
}

/** Wochen einschließlich beider Enden; `Math.round`, weil eine Woche an der Zeitumstellung 167 oder 169 Stunden hat. */
export function timelineWeekCount(firstMonday: Date, lastMonday: Date): number {
  const weekMs = DAYS_PER_WEEK * 24 * 60 * 60 * 1000;

  return Math.round((lastMonday.getTime() - firstMonday.getTime()) / weekMs) + 1;
}

/** Der Kopf einer Woche im Zeitstrahl: Titel, Zähler und die zusammengesetzte Ansage. */
export function describeTimelineWeekHead(week: CalendarWeek): {
  title: string;
  done: number;
  planned: number;
  label: string;
} {
  const { done, planned } = countWeekProgress(week);
  const parts = [describeWeekRange(week.start, week.end)];

  if (week.programWeek) {
    parts.push(`W${formatNumber(week.programWeek.number)}`);

    if (week.programWeek.kind) {
      parts.push(describeWeekKind(week.programWeek.kind));
    }
  }

  if (week.isCurrent) {
    parts.push('diese Woche');
  }

  const title = parts.join(' · ');

  return {
    title,
    done,
    planned,
    label: planned > 0 ? `${title} · ${formatNumber(done)} von ${formatNumber(planned)} erledigt` : title,
  };
}

/**
 * Der Kopf eines Tageskastens im Zeitstrahl: „Mo 23.“ und rechts der Stand.
 * Ist schon etwas erledigt, zählt er „1 von 4 erledigt“; sonst nennt er die
 * Einheiten und - wenn die Seite sie kennt - deren geplante Minuten.
 */
export function describeTimelineDayHead(
  day: Pick<CalendarWeekDay, 'date' | 'isoWeekday' | 'units'>,
  plannedMinutes?: number,
): { title: string; summary: string } {
  const title = `${weekdayShortLabel(day.isoWeekday)} ${formatNumber(day.date.getDate())}.`;
  const total = day.units.length;
  const done = day.units.filter((unit) => unit.state === 'erledigt').length;

  if (total === 0) {
    return { title, summary: 'nichts geplant' };
  }

  if (done > 0) {
    return { title, summary: `${formatNumber(done)} von ${formatNumber(total)} erledigt` };
  }

  const count = `${formatNumber(total)} ${total === 1 ? 'Einheit' : 'Einheiten'}`;

  return {
    title,
    summary: plannedMinutes && plannedMinutes > 0 ? `${count} · ~${formatNumber(plannedMinutes)} min` : count,
  };
}

/** Die Termin-Id, die heute "jetzt dran" ist: die erste Termin-Einheit, nur heute und nur ohne laufende Session. */
export function pickTodayNowEntryId(day: CalendarWeekDay, hasActiveSession: boolean): string | undefined {
  if (!day.isToday || hasActiveSession) {
    return undefined;
  }

  const unit = day.units.find((candidate) => candidate.ref.type === 'entry');

  return unit?.planEntryId;
}

/** `05.–11.10.`, bei Monats- oder Jahreswechsel `28.09.–04.10.`. */
export function describeWeekRange(start: Date, end: Date): string {
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return `${String(start.getDate()).padStart(2, '0')}.–${formatShortDate(end)}`;
  }

  return `${formatShortDate(start)}–${formatShortDate(end)}`;
}

/** Die Detailzeile einer Einheit; Teile mit " · " verbunden, leere entfallen. */
export function describeCalendarUnitDetail(
  unit: CalendarUnit,
  context: {
    volumeKg?: number;
    exerciseCount?: number;
    minutes?: number;
    activeProgress?: { completedCount: number; totalCount: number };
  },
): string {
  const parts: string[] = [];

  if (unit.state === 'erledigt') {
    if (unit.kind === 'run') {
      if (unit.distanceKm !== undefined) {
        parts.push(`${formatNumber(unit.distanceKm)} km`);
      }

      if (unit.durationSeconds !== undefined) {
        parts.push(formatRunDuration(unit.durationSeconds));
      }

      const pace =
        unit.distanceKm !== undefined && unit.durationSeconds !== undefined
          ? paceSecondsPerKm(unit.distanceKm, unit.durationSeconds)
          : undefined;

      if (pace !== undefined) {
        parts.push(`${formatPace(pace)} /km`);
      }
    } else if (unit.kind === 'test') {
      if (unit.asymmetryPercent !== undefined) {
        parts.push(`Seitenvergleich · ${formatNumber(unit.asymmetryPercent)} %`);
      }
    } else {
      if (unit.kind === 'strength' && context.volumeKg !== undefined && context.volumeKg > 0) {
        parts.push(`${formatNumber(Math.round(context.volumeKg))} kg`);
      }

      if (unit.durationSeconds !== undefined) {
        parts.push(formatDurationHours(unit.durationSeconds));
      }
    }

    if (!unit.planEntryId && unit.kind !== 'test') {
      parts.push('spontan');
    }
  } else if (unit.ref.type === 'active-session') {
    const progress = context.activeProgress;

    if (progress && progress.totalCount > 0) {
      parts.push(
        `läuft · Satz ${formatNumber(Math.min(progress.completedCount + 1, progress.totalCount))} von ${formatNumber(progress.totalCount)}`,
      );
    } else {
      parts.push('Läuft gerade');
    }
  } else if (unit.ref.type === 'entry') {
    if (unit.kind === 'run') {
      const text = describeRunTarget(unit.ref.entry) || unit.ref.entry.notes || '';

      if (text) {
        parts.push(text);
      }
    } else {
      /* Die Art trägt das Icon, nicht der Text. */
      if (context.exerciseCount !== undefined) {
        parts.push(
          context.exerciseCount === 1 ? '1 Übung' : `${formatNumber(context.exerciseCount)} Übungen`,
        );
      }

      if (context.minutes !== undefined && context.minutes > 0) {
        parts.push(`~${formatNumber(context.minutes)} min`);
      }
    }
  }

  return parts.join(' · ');
}
