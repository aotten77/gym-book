import { parseLocalDate, startOfCalendarWeek } from '@/domain/calendar-week';
import { normalizeImportKey } from '@/domain/import-key';
import type {
  PlanEntry,
  PlanEntryKind,
  RunLog,
  RunPlanSnapshot,
  RunTarget,
  WorkoutSession,
  WorkoutTemplate,
  Program,
  ProgramWeek,
} from '@/domain/models';
import { toDateInputValue } from '@/domain/program';
import {
  RUN_HEART_RATE_MAX,
  RUN_HEART_RATE_MIN,
  RUN_MESSAGES,
  formatPace,
  formatRunDuration,
} from '@/domain/run';
import {
  normalizeScheduledWeekdays,
  programWeekStart,
  type IsoWeekday,
} from '@/domain/training-calendar';
import { formatNumber } from '@/lib/format';

/*
 * Reine Regeln für den datierten Trainingsplan: Termine prüfen, aus Sessions
 * und Läufen ableiten, ob sie offen, belegt oder erledigt sind, und Serien
 * auf Tage ausrollen. Nichts hier kennt Dexie oder React.
 */

export const PLAN_MESSAGES = {
  notFound: 'Termin nicht gefunden.',
  dateInvalid: 'Bitte ein gültiges Datum eintragen.',
  workoutMissing: 'Bitte ein Workout wählen.',
  workoutNotFound: 'Workout nicht gefunden.',
  titleMissing: 'Bitte einen Titel für den Lauf eintragen.',
  distance: 'Strecke bitte über 0 km.',
  duration: 'Dauer bitte über 0.',
  pace: 'Pace bitte über 0.',
  elevation: RUN_MESSAGES.elevation,
  heartRate: RUN_MESSAGES.heartRate,
  taken: 'Dieser Termin ist schon trainiert und lässt sich nicht mehr ändern.',
  notRun: 'Dieser Termin ist kein Lauf.',
  /** `date` ist schon formatiert - der Aufrufer übergibt `formatRunDate(date)`. */
  duplicate: (name: string, date: string) => `„${name}“ steht am ${date} schon im Plan.`,
} as const;

/** Die Werte eines Termins, wie sie geschrieben werden; `null` heißt "nicht gesetzt". */
export interface PlanEntryValues {
  date: string;
  kind: PlanEntryKind;
  templateId: string | null;
  title: string | null;
  targetDistanceKm: number | null;
  targetDurationSeconds: number | null;
  targetElevationGainM: number | null;
  targetAverageHeartRate: number | null;
  targetPaceSecondsPerKm: number | null;
  instructions: string | null;
  notes: string | null;
}

/** Nur ein Datum, das sich unverändert zurückschreibt, ist ein echter Kalendertag (`2026-02-30` rollt in den März). */
export function isValidLocalDate(value: string): boolean {
  const parsed = parseLocalDate(value);

  return parsed !== undefined && toDateInputValue(parsed) === value;
}

/** Identität eines Termins für die Dublettenprüfung: Tag, Art und Workout bzw. normalisierter Titel. */
export function planEntryKey(entry: {
  date: string;
  kind: PlanEntryKind;
  templateId?: string | null;
  title?: string | null;
}): string {
  return entry.kind === 'workout'
    ? `${entry.date}|workout|${entry.templateId ?? ''}`
    : `${entry.date}|run|${normalizeImportKey(entry.title ?? '')}`;
}

function isPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/** Die erste deutsche Meldung oder `undefined`; Felder der anderen Art werden ignoriert, nicht abgelehnt. */
export function validatePlanEntryValues(values: PlanEntryValues): string | undefined {
  if (!isValidLocalDate(values.date)) {
    return PLAN_MESSAGES.dateInvalid;
  }

  if (values.kind === 'workout') {
    return values.templateId ? undefined : PLAN_MESSAGES.workoutMissing;
  }

  if (!values.title || values.title.trim() === '') {
    return PLAN_MESSAGES.titleMissing;
  }

  if (values.targetDistanceKm !== null && !isPositive(values.targetDistanceKm)) {
    return PLAN_MESSAGES.distance;
  }

  if (
    values.targetDurationSeconds !== null &&
    (!Number.isInteger(values.targetDurationSeconds) || values.targetDurationSeconds <= 0)
  ) {
    return PLAN_MESSAGES.duration;
  }

  if (values.targetPaceSecondsPerKm !== null && !isPositive(values.targetPaceSecondsPerKm)) {
    return PLAN_MESSAGES.pace;
  }

  if (
    values.targetElevationGainM !== null &&
    (!Number.isInteger(values.targetElevationGainM) || values.targetElevationGainM < 0)
  ) {
    return PLAN_MESSAGES.elevation;
  }

  if (
    values.targetAverageHeartRate !== null &&
    (!Number.isInteger(values.targetAverageHeartRate) ||
      values.targetAverageHeartRate < RUN_HEART_RATE_MIN ||
      values.targetAverageHeartRate > RUN_HEART_RATE_MAX)
  ) {
    return PLAN_MESSAGES.heartRate;
  }

  return undefined;
}

function trimmedOrNull(value: string | null): string | null {
  const trimmed = value?.trim();

  return trimmed ? trimmed : null;
}

/** Die zu schreibenden Felder: ohne `null`, ohne Felder der anderen Art, Texte getrimmt und leer weggelassen. */
export function toPlanEntryFields(
  values: PlanEntryValues,
): Omit<PlanEntry, 'id' | 'orderInDay' | 'createdAt' | 'updatedAt'> {
  const fields: Omit<PlanEntry, 'id' | 'orderInDay' | 'createdAt' | 'updatedAt'> = {
    date: values.date,
    kind: values.kind,
  };
  const instructions = trimmedOrNull(values.instructions);
  const notes = trimmedOrNull(values.notes);

  if (values.kind === 'workout') {
    if (values.templateId) {
      fields.templateId = values.templateId;
    }
  } else {
    const title = trimmedOrNull(values.title);

    if (title) {
      fields.title = title;
    }

    if (values.targetDistanceKm !== null) fields.targetDistanceKm = values.targetDistanceKm;
    if (values.targetDurationSeconds !== null) {
      fields.targetDurationSeconds = values.targetDurationSeconds;
    }
    if (values.targetElevationGainM !== null) fields.targetElevationGainM = values.targetElevationGainM;
    if (values.targetAverageHeartRate !== null) {
      fields.targetAverageHeartRate = values.targetAverageHeartRate;
    }
    if (values.targetPaceSecondsPerKm !== null) {
      fields.targetPaceSecondsPerKm = values.targetPaceSecondsPerKm;
    }
  }

  if (instructions) fields.instructions = instructions;
  if (notes) fields.notes = notes;

  return fields;
}

/** Welche Session oder welcher Lauf einen Termin belegt. */
export interface PlanEntryLink {
  planEntryId: string;
  source: 'session' | 'run';
  sourceId: string;
  done: boolean;
  doneAt?: string;
  nameSnapshot?: string;
}

/**
 * Termin-Id → Verweis. Abgebrochene Sessions belegen nichts, eine laufende
 * belegt, ohne zu erledigen; ein Lauf ist immer erledigt. Eine abgeschlossene
 * Session gewinnt gegen eine laufende auf demselben Termin.
 */
export function buildPlanLinks(
  sessions: Pick<
    WorkoutSession,
    'id' | 'planEntryId' | 'status' | 'completedAt' | 'templateNameSnapshot'
  >[],
  runs: Pick<RunLog, 'id' | 'planEntryId' | 'date'>[],
): Record<string, PlanEntryLink> {
  const links: Record<string, PlanEntryLink> = {};

  const put = (link: PlanEntryLink) => {
    const existing = links[link.planEntryId];

    if (!existing || (link.done && !existing.done)) {
      links[link.planEntryId] = link;
    }
  };

  for (const session of sessions) {
    if (!session.planEntryId || session.status === 'aborted') {
      continue;
    }

    const done = session.status === 'completed';

    put({
      planEntryId: session.planEntryId,
      source: 'session',
      sourceId: session.id,
      done,
      ...(done && session.completedAt ? { doneAt: session.completedAt } : {}),
      nameSnapshot: session.templateNameSnapshot,
    });
  }

  for (const run of runs) {
    if (!run.planEntryId) {
      continue;
    }

    put({
      planEntryId: run.planEntryId,
      source: 'run',
      sourceId: run.id,
      done: true,
      doneAt: run.date,
    });
  }

  return links;
}

export type PlanEntryState = 'offen' | 'belegt' | 'erledigt';

export function planEntryState(
  entryId: string,
  links: Record<string, PlanEntryLink>,
): PlanEntryState {
  const link = links[entryId];

  if (!link) {
    return 'offen';
  }

  return link.done ? 'erledigt' : 'belegt';
}

/** Nach Tag, dann nach Reihenfolge im Tag; verändert das Argument nicht. */
export function sortPlanEntries(entries: PlanEntry[]): PlanEntry[] {
  return [...entries].sort(
    (a, b) => a.date.localeCompare(b.date) || a.orderInDay - b.orderInDay,
  );
}

/**
 * Welcher Termin zu einem Start gehört: der offene passende von heute, sonst
 * der früheste offene passende der laufenden Kalenderwoche - ausdrücklich
 * auch ein künftiger, denn wer vorzieht, trainiert trotzdem *diesen* Termin.
 * Schon belegte Termine zählen nicht; bei mehreren am selben Tag entscheidet
 * `orderInDay`. Passt nichts, `null`.
 */
export function findMatchingPlanEntry(
  entries: PlanEntry[],
  query: {
    kind: PlanEntryKind;
    templateId?: string;
    day: string;
    takenIds: ReadonlySet<string>;
  },
): PlanEntry | null {
  const candidates = sortPlanEntries(
    entries.filter(
      (entry) =>
        entry.kind === query.kind &&
        !query.takenIds.has(entry.id) &&
        (query.kind === 'run' || entry.templateId === query.templateId),
    ),
  );

  const sameDay = candidates.find((entry) => entry.date === query.day);

  if (sameDay) {
    return sameDay;
  }

  const parsedDay = parseLocalDate(query.day);

  if (!parsedDay) {
    return null;
  }

  const weekStart = startOfCalendarWeek(parsedDay);
  const nextWeekStart = new Date(weekStart.getTime());

  nextWeekStart.setDate(nextWeekStart.getDate() + 7);

  const from = toDateInputValue(weekStart);
  const until = toDateInputValue(nextWeekStart);

  return candidates.find((entry) => entry.date >= from && entry.date < until) ?? null;
}

/**
 * Alle Tage einer Serie: je Woche ab der Kalenderwoche von `startDate` ein
 * Datum je Wochentag, nur ab `startDate`, aufsteigend. Weiterzählen über
 * `setDate` - eine Woche über die Zeitumstellung hat 167 oder 169 Stunden.
 */
export function expandSeries(input: {
  weekdays: IsoWeekday[];
  startDate: string;
  weeks: number;
}): string[] {
  const start = parseLocalDate(input.startDate);

  if (!start) {
    return [];
  }

  const weekStart = startOfCalendarWeek(start);
  const days = [...new Set(input.weekdays)].sort((a, b) => a - b);
  const dates: string[] = [];

  for (let week = 0; week < input.weeks; week += 1) {
    for (const weekday of days) {
      const day = new Date(weekStart.getTime());

      day.setDate(day.getDate() + week * 7 + (weekday - 1));

      const value = toDateInputValue(day);

      if (value >= input.startDate) {
        dates.push(value);
      }
    }
  }

  return dates;
}

/** `8 km · 45:00 · 5:30 /km · 120 hm · Ø 145`; fehlende Teile fallen weg. */
export function describeRunTarget(target: RunTarget): string {
  const parts: string[] = [];

  if (target.targetDistanceKm !== undefined) {
    parts.push(`${formatNumber(target.targetDistanceKm)} km`);
  }

  if (target.targetDurationSeconds !== undefined) {
    parts.push(formatRunDuration(target.targetDurationSeconds));
  }

  if (target.targetPaceSecondsPerKm !== undefined) {
    parts.push(`${formatPace(target.targetPaceSecondsPerKm)} /km`);
  }

  if (target.targetElevationGainM !== undefined) {
    parts.push(`${formatNumber(target.targetElevationGainM)} hm`);
  }

  if (target.targetAverageHeartRate !== undefined) {
    parts.push(`Ø ${formatNumber(target.targetAverageHeartRate)}`);
  }

  return parts.join(' · ');
}

/** Was heute ansteht (offen, in Reihenfolge) und der erste offene Termin danach. */
export function pickTodayPlan(
  entries: PlanEntry[],
  links: Record<string, PlanEntryLink>,
  today: string,
): { todayOpen: PlanEntry[]; next?: PlanEntry } {
  const open = sortPlanEntries(entries).filter(
    (entry) => planEntryState(entry.id, links) === 'offen',
  );

  return {
    todayOpen: open.filter((entry) => entry.date === today),
    next: open.find((entry) => entry.date > today),
  };
}

/** Titel, sonst Workout-Name, sonst der Name aus der verknüpften Session, sonst ein Platzhalter. */
export function planEntryName(
  entry: PlanEntry,
  templateNames: Record<string, string>,
  links: Record<string, PlanEntryLink>,
): string {
  if (entry.title) {
    return entry.title;
  }

  if (entry.templateId && templateNames[entry.templateId]) {
    return templateNames[entry.templateId];
  }

  return links[entry.id]?.nameSnapshot ?? 'Gelöschtes Workout';
}

/** Der Termin, wie ihn ein Lauf festhält: Titel, Datum, Vorgaben, Anleitung - fehlende Felder ohne Schlüssel. */
export function toRunPlanSnapshot(entry: PlanEntry): RunPlanSnapshot {
  return {
    title: entry.title ?? '',
    date: entry.date,
    ...(entry.targetDistanceKm !== undefined ? { targetDistanceKm: entry.targetDistanceKm } : {}),
    ...(entry.targetDurationSeconds !== undefined
      ? { targetDurationSeconds: entry.targetDurationSeconds }
      : {}),
    ...(entry.targetElevationGainM !== undefined
      ? { targetElevationGainM: entry.targetElevationGainM }
      : {}),
    ...(entry.targetAverageHeartRate !== undefined
      ? { targetAverageHeartRate: entry.targetAverageHeartRate }
      : {}),
    ...(entry.targetPaceSecondsPerKm !== undefined
      ? { targetPaceSecondsPerKm: entry.targetPaceSecondsPerKm }
      : {}),
    ...(entry.instructions !== undefined ? { instructions: entry.instructions } : {}),
  };
}

/**
 * Was die Umwandlung der festen Wochentage in Termine schreiben würde.
 *
 * Von heute an bis zum Ende der letzten Programmwoche - ohne Startdatum oder
 * bei abgelaufenem Programm gibt es kein Ende, dann nennt der Nutzer die
 * Wochenzahl (`needsWeeks`), gezählt ab der laufenden Kalenderwoche. Ohne
 * `weeks` bleibt `entries` dann leer. Je Tag stehen die Workouts nach Name;
 * was schon im Plan steht, zählt in `skipped`.
 */
export function planWeekdayMigration(input: {
  templates: WorkoutTemplate[];
  program?: Program;
  programWeeks: ProgramWeek[];
  weeks?: number;
  today: string;
  existingKeys: ReadonlySet<string>;
}): { from: string; to: string; needsWeeks: boolean; entries: PlanEntryValues[]; skipped: number } {
  const from = input.today;
  const today = parseLocalDate(input.today);
  let to = from;
  let needsWeeks = true;
  let lastDay: Date | undefined;

  const maxWeek = input.programWeeks.reduce((max, week) => Math.max(max, week.weekNumber), 0);

  if (input.program?.startedOn && maxWeek > 0) {
    const start = programWeekStart(input.program.startedOn, maxWeek);

    if (start) {
      start.setDate(start.getDate() + 6);

      if (today && toDateInputValue(start) >= from) {
        lastDay = start;
        needsWeeks = false;
      }
    }
  }

  if (lastDay) {
    to = toDateInputValue(lastDay);
  } else if (input.weeks !== undefined && today) {
    const end = startOfCalendarWeek(today);

    end.setDate(end.getDate() + input.weeks * 7 - 1);
    to = toDateInputValue(end);
  }

  if (!today || (needsWeeks && input.weeks === undefined)) {
    return { from, to, needsWeeks, entries: [], skipped: 0 };
  }

  const toDate = parseLocalDate(to);
  const weeks = lastDay
    ? Math.round(
        (startOfCalendarWeek(lastDay).getTime() - startOfCalendarWeek(today).getTime()) /
          (7 * 24 * 3600 * 1000),
      ) + 1
    : (input.weeks ?? 0);
  const templates = input.templates
    .filter((template) => normalizeScheduledWeekdays(template.scheduledWeekdays) !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const candidates: PlanEntryValues[] = [];

  for (const template of templates) {
    const weekdays = normalizeScheduledWeekdays(template.scheduledWeekdays) as IsoWeekday[];

    for (const date of expandSeries({ weekdays, startDate: from, weeks })) {
      if (toDate && date > to) {
        continue;
      }

      candidates.push({
        date,
        kind: 'workout',
        templateId: template.id,
        title: null,
        targetDistanceKm: null,
        targetDurationSeconds: null,
        targetElevationGainM: null,
        targetAverageHeartRate: null,
        targetPaceSecondsPerKm: null,
        instructions: null,
        notes: null,
      });
    }
  }

  // Stabil nach Tag; innerhalb eines Tages bleibt die Namensreihenfolge.
  candidates.sort((a, b) => a.date.localeCompare(b.date));

  const entries: PlanEntryValues[] = [];
  let skipped = 0;

  for (const candidate of candidates) {
    if (input.existingKeys.has(planEntryKey(candidate))) {
      skipped += 1;
    } else {
      entries.push(candidate);
    }
  }

  return { from, to, needsWeeks, entries, skipped };
}
