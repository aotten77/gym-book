import { z } from 'zod';
import {
  describeImportValue,
  diffImportField,
  type ImportFieldChange,
} from '@/domain/import-diff';
import { normalizeImportKey } from '@/domain/import-key';
// Nur Typen: `library-import.ts` ruft diese Datei zur Laufzeit auf.
import type { ImportEntryKind } from '@/domain/library-import';
import type { PlanEntry } from '@/domain/models';
import {
  type PlanEntryValues,
  isValidLocalDate,
  planEntryKey,
  planEntryName,
  planEntryToValues,
  sortPlanEntries,
  toPlanEntryFields,
  validatePlanEntryValues,
} from '@/domain/plan';
import { formatPace, formatRunDuration } from '@/domain/run';
import { formatRunDate } from '@/lib/format';
import { createId } from '@/lib/id';

/*
 * Termine im Bibliotheks-Import: der Block `planEntries`, wahlweise mit
 * `planRange`. Dieselben Regeln wie im übrigen Import:
 *
 * - Identität über `planEntryKey` (Tag + Workout bzw. normalisierter
 *   Lauftitel), nie über eine Id - dieselbe Datei zweimal ergibt
 *   "unverändert".
 * - Ein fehlender Schlüssel ändert nichts, `null` leert.
 * - Abbruch statt Warnung, mit benannter Zeile ("Termin 3: …").
 * - Mit `planRange` ist die Datei der vollständige Plan dieses Zeitraums
 *   (beide Grenzen eingeschlossen): offene Termine darin, die die Datei nicht
 *   nennt, werden entfernt. Ohne `planRange` wird nur ergänzt und geändert.
 * - Belegte Termine sind Geschichte: weder geändert noch entfernt, egal was
 *   die Datei sagt.
 */

export const planRangeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

/*
 * Die Grenzen der Vorgaben prüft `validatePlanEntryValues` - mit denselben
 * Meldungen wie das Termin-Sheet und mit der Zeilennummer davor, statt eines
 * zod-Pfads, den beim Schreiben von Hand niemand zuordnen kann.
 */
const importRunSchema = z.object({
  title: z.string().min(1),
  targetDistanceKm: z.number().nullable().optional(),
  targetDurationSeconds: z.number().nullable().optional(),
  targetElevationGainM: z.number().nullable().optional(),
  targetAverageHeartRate: z.number().nullable().optional(),
  targetPaceSecondsPerKm: z.number().nullable().optional(),
  instructions: z.string().nullable().optional(),
});

/** Genau eines von `workout` und `run` - geprüft in `planPlanEntries`, damit die Meldung die Zeile nennt. */
export const importPlanEntrySchema = z.object({
  date: z.string().min(1),
  workout: z.string().min(1).optional(),
  run: importRunSchema.optional(),
  notes: z.string().nullable().optional(),
});

export type ImportPlanRangeInput = z.infer<typeof planRangeSchema>;
export type ImportPlanEntryInput = z.infer<typeof importPlanEntrySchema>;

export interface PlanEntryPlanEntry {
  kind: ImportEntryKind;
  id: string;
  /** `planEntryKey` - die Identität, über die zugeordnet wird. */
  key: string;
  /** `Di., 06.10. · Intervalle 6×400` */
  label: string;
  changes: ImportFieldChange[];
  /** Die vollständigen Zielwerte; fehlt bei `removed` und bei belegten Terminen. */
  values?: PlanEntryValues;
  /** Zielposition am Tag (dicht ab 1); bei `removed` die bisherige. */
  orderInDay: number;
  /** Belegt durch eine Session oder einen Lauf - bleibt, wie es ist. */
  taken: boolean;
}

type RunField =
  | 'targetDistanceKm'
  | 'targetDurationSeconds'
  | 'targetElevationGainM'
  | 'targetAverageHeartRate'
  | 'targetPaceSecondsPerKm';

const RUN_FIELDS: Array<{ key: RunField; label: string; format: (value: number) => string }> = [
  { key: 'targetDistanceKm', label: 'Strecke (km)', format: describeImportValue },
  { key: 'targetDurationSeconds', label: 'Dauer', format: formatRunDuration },
  { key: 'targetPaceSecondsPerKm', label: 'Pace (/km)', format: formatPace },
  { key: 'targetElevationGainM', label: 'Höhenmeter', format: describeImportValue },
  { key: 'targetAverageHeartRate', label: 'Puls', format: describeImportValue },
];

function emptyValues(date: string, kind: PlanEntryValues['kind']): PlanEntryValues {
  return {
    date,
    kind,
    templateId: null,
    title: null,
    targetDistanceKm: null,
    targetDurationSeconds: null,
    targetElevationGainM: null,
    targetAverageHeartRate: null,
    targetPaceSecondsPerKm: null,
    instructions: null,
    notes: null,
  };
}

/** Leerer Text heißt "kein Wert" - wie `optionalText` im übrigen Import. */
function importedText(value: string | null): string | null {
  const trimmed = value?.trim();

  return trimmed ? trimmed : null;
}

/** Legt die genannten Felder der Datei über die Werte; ein fehlender Schlüssel bleibt, `null` leert. */
function mergeInput(base: PlanEntryValues, input: ImportPlanEntryInput): PlanEntryValues {
  const merged: PlanEntryValues = { ...base };

  if (input.notes !== undefined) {
    merged.notes = importedText(input.notes);
  }

  if (input.run) {
    merged.title = input.run.title.trim();

    for (const { key } of RUN_FIELDS) {
      const value = input.run[key];

      if (value !== undefined) {
        merged[key] = value;
      }
    }

    if (input.run.instructions !== undefined) {
      merged.instructions = importedText(input.run.instructions);
    }
  }

  return merged;
}

function describeNumber(format: (value: number) => string) {
  return (value: unknown) => (typeof value === 'number' ? format(value) : describeImportValue(value));
}

function diffValues(current: PlanEntryValues, next: PlanEntryValues, isNew: boolean) {
  const changes: ImportFieldChange[] = [];

  // Beim neuen Termin steht der Titel schon im Label.
  if (!isNew && next.kind === 'run') {
    diffImportField(changes, 'Titel', current.title, next.title);
  }

  if (next.kind === 'run') {
    for (const { key, label, format } of RUN_FIELDS) {
      diffImportField(changes, label, current[key], next[key], describeNumber(format));
    }

    diffImportField(changes, 'Anleitung', current.instructions, next.instructions);
  }

  diffImportField(changes, 'Notiz', current.notes, next.notes);

  return changes;
}

/**
 * Die Zielreihenfolge eines Tages.
 *
 * Belegte Termine sind Geschichte und bleiben, wo sie stehen: ihr Platz unter
 * den bleibenden Terminen des Tages ist fest, auch wenn die Datei sie an
 * anderer Stelle nennt. Die übrigen Plätze füllen, in dieser Reihenfolge, die
 * offenen Termine, die die Datei nicht nennt (bisherige Reihenfolge), und die
 * offenen und neuen Termine der Datei (Dateireihenfolge).
 *
 * `existing` ist der Bestand **vor** dem Import, `planned` der Plan in
 * Dateireihenfolge. Planung und Schreiben rufen beide diese Funktion mit
 * denselben Daten, damit die Vorschau genau die Reihenfolge nennt, die
 * hinterher steht.
 */
export function orderPlanDay(
  date: string,
  existing: PlanEntry[],
  planned: PlanEntryPlanEntry[],
  takenIds: ReadonlySet<string>,
): string[] {
  const removed = new Set(planned.filter((entry) => entry.kind === 'removed').map((entry) => entry.id));
  const survivors = sortPlanEntries(
    existing.filter((entry) => entry.date === date && !removed.has(entry.id)),
  );
  const fileIds = planned
    .filter((entry) => !entry.taken && entry.kind !== 'removed' && entry.values?.date === date)
    .map((entry) => entry.id);
  const fromFile = new Set(fileIds);
  const pinned = survivors
    .map((entry, index) => ({ id: entry.id, index }))
    .filter(({ id }) => takenIds.has(id));
  const flowing = [
    ...survivors
      .filter((entry) => !takenIds.has(entry.id) && !fromFile.has(entry.id))
      .map((entry) => entry.id),
    ...fileIds,
  ];
  const total = pinned.length + flowing.length;
  const slots: Array<string | undefined> = new Array<string | undefined>(total).fill(undefined);
  let last = -1;

  pinned.forEach(({ id, index }, position) => {
    // Aufsteigend und mit Platz für die belegten dahinter - bei dichter
    // Nummerierung ist das genau der bisherige Platz.
    const slot = Math.min(Math.max(index, last + 1), total - (pinned.length - position));

    slots[slot] = id;
    last = slot;
  });

  let next = 0;

  for (const id of flowing) {
    while (slots[next] !== undefined) {
      next += 1;
    }

    slots[next] = id;
  }

  return slots.filter((id): id is string => id !== undefined);
}

const VALUE_KEYS = Object.keys(emptyValues('', 'workout')) as Array<keyof PlanEntryValues>;

/**
 * Der zu schreibende Datensatz eines neuen oder geänderten Termins: auf dem
 * bestehenden aufgebaut (Felder, die diese Version nicht kennt, bleiben), die
 * Felder der Werte vollständig ersetzt - was `null` ist, fehlt danach. Für
 * `put`, nie für `Table.update`.
 */
export function buildImportedPlanEntryRecord(
  entry: PlanEntryPlanEntry,
  existing: PlanEntry | undefined,
  now: string,
): PlanEntry {
  if (!entry.values) {
    throw new Error('Termin ohne Werte kann nicht geschrieben werden.');
  }

  const fields = toPlanEntryFields(entry.values);
  const record: Record<string, unknown> = { ...existing, ...fields };

  for (const key of VALUE_KEYS) {
    if (!(key in fields)) {
      delete record[key];
    }
  }

  record.id = entry.id;
  record.orderInDay = entry.orderInDay;
  record.createdAt = existing?.createdAt ?? now;
  record.updatedAt = now;

  return record as unknown as PlanEntry;
}

/** Prüft `planRange`; gibt den Bereich nur zurück, wenn er brauchbar ist. */
function checkRange(
  range: ImportPlanRangeInput | undefined,
  entryCount: number,
  problems: string[],
): ImportPlanRangeInput | undefined {
  if (!range) {
    return undefined;
  }

  let valid = true;

  for (const value of [range.from, range.to]) {
    if (!isValidLocalDate(value)) {
      problems.push(`planRange: "${value}" ist kein gültiges Datum (JJJJ-MM-TT).`);
      valid = false;
    }
  }

  if (valid && range.from > range.to) {
    problems.push(`planRange: "from" (${range.from}) liegt nach "to" (${range.to}).`);
    valid = false;
  }

  // Wie ein ersetztes Workout ohne Zeilen: ein Tippfehler darf keinen Zeitraum leeren.
  if (entryCount === 0) {
    problems.push(
      'planRange braucht "planEntries" – ohne sie würde der Import alle offenen Termine im Zeitraum entfernen.',
    );
    valid = false;
  }

  return valid ? range : undefined;
}

/**
 * Plant die Termine der Datei gegen den Bestand.
 *
 * `templateIdByKey` (normalisierter Name → Id) enthält bestehende **und** in
 * derselben Datei neu angelegte Workouts. Probleme landen in `problems`; der
 * Aufrufer bricht ab, sobald dort etwas steht.
 */
export function planPlanEntries(input: {
  range?: ImportPlanRangeInput;
  entries: ImportPlanEntryInput[];
  existing: PlanEntry[];
  takenIds: ReadonlySet<string>;
  templateIdByKey: Map<string, string>;
  /** Id → Name, für die Labels nicht genannter Termine. */
  templateNames?: Record<string, string>;
  problems: string[];
}): PlanEntryPlanEntry[] {
  const { problems, takenIds } = input;
  const templateNames = input.templateNames ?? {};
  const range = checkRange(input.range, input.entries.length, problems);
  const existingByKey = new Map<string, PlanEntry>();

  for (const entry of sortPlanEntries(input.existing)) {
    const key = planEntryKey(entry);

    if (!existingByKey.has(key)) {
      existingByKey.set(key, entry);
    }
  }

  const seenKeys = new Set<string>();
  const planned: PlanEntryPlanEntry[] = [];

  input.entries.forEach((item, index) => {
    const line = `Termin ${index + 1}`;

    if ((item.workout === undefined) === (item.run === undefined)) {
      problems.push(`${line}: braucht genau eines von "workout" oder "run".`);
      return;
    }

    if (!isValidLocalDate(item.date)) {
      problems.push(`${line}: "${item.date}" ist kein gültiges Datum (JJJJ-MM-TT).`);
      return;
    }

    if (range && (item.date < range.from || item.date > range.to)) {
      problems.push(
        `${line}: ${formatRunDate(item.date)} liegt außerhalb von planRange (${range.from} bis ${range.to}).`,
      );
      return;
    }

    const base = emptyValues(item.date, item.run ? 'run' : 'workout');
    let name: string;

    if (item.workout !== undefined) {
      const workoutName = item.workout.trim();
      const templateId = input.templateIdByKey.get(normalizeImportKey(workoutName));

      if (!templateId) {
        problems.push(
          `${line}: Workout "${workoutName}" gibt es nicht und es wird auch in dieser Datei nicht angelegt.`,
        );
        return;
      }

      base.templateId = templateId;
      name = templateNames[templateId] ?? workoutName;
    } else {
      base.title = item.run?.title.trim() ?? '';
      name = base.title;
    }

    const key = planEntryKey(base);

    if (seenKeys.has(key)) {
      problems.push(`${line}: "${name}" steht am ${formatRunDate(item.date)} mehrfach in dieser Datei.`);
      return;
    }

    seenKeys.add(key);

    const existing = existingByKey.get(key);
    const label = `${formatRunDate(item.date)} · ${name}`;

    if (existing && takenIds.has(existing.id)) {
      planned.push({
        kind: 'unchanged',
        id: existing.id,
        key,
        label,
        changes: [],
        orderInDay: existing.orderInDay,
        taken: true,
      });
      return;
    }

    const current = existing ? planEntryToValues(existing) : base;
    const values = mergeInput(current, item);
    const message = validatePlanEntryValues(values);

    if (message) {
      problems.push(`${line}: ${message}`);
      return;
    }

    const changes = diffValues(current, values, !existing);

    planned.push({
      kind: existing ? (changes.length > 0 ? 'update' : 'unchanged') : 'new',
      id: existing?.id ?? createId(),
      key,
      label,
      changes,
      values,
      orderInDay: 0,
      taken: false,
    });
  });

  const matched = new Set(planned.map((entry) => entry.id));

  if (range) {
    for (const entry of sortPlanEntries(input.existing)) {
      if (matched.has(entry.id) || entry.date < range.from || entry.date > range.to) {
        continue;
      }

      const taken = takenIds.has(entry.id);

      planned.push({
        kind: taken ? 'unchanged' : 'removed',
        id: entry.id,
        key: planEntryKey(entry),
        label: `${formatRunDate(entry.date)} · ${planEntryName(entry, templateNames, {})}`,
        changes: [],
        orderInDay: entry.orderInDay,
        taken,
      });
    }
  }

  assignDayOrder(planned, input.entries, input.existing, takenIds);

  return planned;
}

/**
 * Setzt `orderInDay` jedes geplanten Termins auf den Tagen der Datei nach
 * `orderPlanDay` und meldet bei bestehenden offenen Terminen, wenn sie dabei
 * die Position wechseln. Gezählt wird gegen den Tag ohne die entfernten
 * Termine - deren Lücke ist keine Verschiebung.
 */
function assignDayOrder(
  planned: PlanEntryPlanEntry[],
  inputs: ImportPlanEntryInput[],
  existing: PlanEntry[],
  takenIds: ReadonlySet<string>,
) {
  const removed = new Set(planned.filter((entry) => entry.kind === 'removed').map((entry) => entry.id));
  const byId = new Map(planned.map((entry) => [entry.id, entry]));

  for (const date of new Set(inputs.map((item) => item.date))) {
    const current = sortPlanEntries(existing.filter((entry) => entry.date === date))
      .filter((entry) => !removed.has(entry.id))
      .map((entry) => entry.id);

    orderPlanDay(date, existing, planned, takenIds).forEach((id, index) => {
      const entry = byId.get(id);

      if (!entry) {
        return;
      }

      const position = index + 1;

      if (entry.kind !== 'new' && !entry.taken) {
        if (diffImportField(entry.changes, 'Position', current.indexOf(id) + 1, position)) {
          entry.kind = 'update';
        }
      }

      entry.orderInDay = position;
    });
  }
}
