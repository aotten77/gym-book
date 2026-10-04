import { z } from 'zod';
import type {
  BandLevel,
  Exercise,
  LoadKind,
  ProgressionRule,
  TrackingMode,
  WorkoutTemplate,
  WorkoutTemplateExercise,
} from '@/domain/models';
import { TRACKING_MODE_LABELS } from '@/domain/tracking';
import { createId } from '@/lib/id';
import { formatNumber } from '@/lib/format';

/*
 * Der Bibliotheks-Import: Übungen, Workouts, Zuordnungen und Bänder aus einer
 * JSON-Datei, ohne einen einzigen Trainingsdatensatz anzufassen.
 *
 * Drei Regeln tragen die ganze Datei:
 *
 * 1. Verglichen und verknüpft wird über den **Namen**, nicht über eine Id.
 *    Eine von Hand geschriebene Nutzlast kennt die UUIDs auf dem Gerät nicht,
 *    und derselbe Import zweimal ausgeführt darf keine Zwillinge erzeugen.
 * 2. Geschrieben werden **nur die angegebenen Felder**. Ein fehlender Schlüssel
 *    ist keine Löschung - dieselbe Regel wie in `updateSetLogValues`, wo Dexies
 *    Update-Semantik über `undefined` sonst gespeicherte Werte vernichtet.
 * 3. Gelöscht wird nur, was die Datei **ausdrücklich** verlangt: eine Zuordnung
 *    in einem Workout mit `replaceAssignments: true`, die die Datei nicht mehr
 *    nennt - samt ihrer Wochenregeln, wie beim Löschen von Hand. Übungen,
 *    Workouts und Bänder selbst entfernt der Import nie; das bleibt eine
 *    Handlung in der Oberfläche, wo man sieht, was daran hängt.
 *
 * Die Planung ist rein: sie bekommt den Bestand als Arrays und liefert
 * beschriebene Änderungen zurück. Das ist zugleich die Dry-Run-Vorschau und
 * die Arbeitsanweisung für `db/library-import-actions.ts` - zwei Formate
 * dafür wären zwei Gelegenheiten, auseinanderzulaufen.
 */

export const LIBRARY_IMPORT_SCHEMA_VERSION = 1;

const trackingModeSchema = z.enum(['reps_weight', 'time', 'time_weight']);
const loadKindSchema = z.enum(['weight', 'band']);

const importExerciseSchema = z.object({
  name: z.string().min(1),
  instructions: z.string().optional(),
  tempo: z.string().optional(),
  /*
   * Pflicht, obwohl sonst jedes Feld optional ist: ohne Erfassungsart und
   * Seitigkeit ließe sich eine *neue* Übung nicht anlegen, und ein Eintrag,
   * der nur manchmal funktioniert, ist schlechter als eine klare Vorgabe.
   */
  trackingMode: trackingModeSchema,
  unilateral: z.boolean(),
  loadKind: loadKindSchema.optional(),
  tracksHeight: z.boolean().optional(),
});

const importTemplateSchema = z.object({
  name: z.string().min(1),
  notes: z.string().optional(),
  /*
   * Die Zuordnungen dieses Workouts in der Datei sind der vollständige
   * Soll-Stand seiner Zusammensetzung: was fehlt, wird entfernt, Reihenfolge
   * und Supersätze kommen aus der Datei. Ohne das Flag bleibt der Import für
   * dieses Workout additiv. Gespeichert wird es nicht.
   */
  replaceAssignments: z.boolean().optional(),
});

const importAssignmentSchema = z.object({
  template: z.string().min(1),
  exercise: z.string().min(1),
  orderIndex: z.number().int().positive(),
  workSetCount: z.number().int().positive(),
  includeWarmup: z.boolean().optional(),
  /*
   * `null` leert ein Feld, ein fehlender Schlüssel lässt es stehen. Nur so
   * lässt sich beides ausdrücken: "unverändert" und "kein Ziel mehr".
   */
  targetReps: z.number().nonnegative().nullable().optional(),
  targetRepsMax: z.number().nonnegative().nullable().optional(),
  targetSeconds: z.number().nonnegative().nullable().optional(),
  targetWeight: z.number().nonnegative().nullable().optional(),
  targetHeightCm: z.number().nonnegative().nullable().optional(),
  restSeconds: z.number().nonnegative().nullable().optional(),
  notes: z.string().nullable().optional(),
  /** Gruppenname eines Supersatzes - nur in einem ersetzten Workout. */
  superset: z.string().min(1).optional(),
});

const importBandLevelSchema = z.object({
  name: z.string().min(1),
  orderIndex: z.number().int().positive(),
});

const libraryImportPayloadSchema = z.object({
  schemaVersion: z.literal(LIBRARY_IMPORT_SCHEMA_VERSION),
  // Alle vier Blöcke optional: eine Datei, die nur Bänder nachträgt, ist ein
  // gültiger Import und soll keine leeren Listen mitschleppen müssen.
  exercises: z.array(importExerciseSchema).optional().default([]),
  templates: z.array(importTemplateSchema).optional().default([]),
  templateAssignments: z.array(importAssignmentSchema).optional().default([]),
  bandLevels: z.array(importBandLevelSchema).optional().default([]),
});

export type ImportExerciseInput = z.infer<typeof importExerciseSchema>;
export type ImportTemplateInput = z.infer<typeof importTemplateSchema>;
export type ImportAssignmentInput = z.infer<typeof importAssignmentSchema>;
export type ImportBandLevelInput = z.infer<typeof importBandLevelSchema>;
export type LibraryImportPayload = z.infer<typeof libraryImportPayloadSchema>;

/** Der Bestand, gegen den geplant wird - reine Daten, kein Dexie. */
export interface LibraryImportState {
  exercises: Exercise[];
  templates: WorkoutTemplate[];
  templateExercises: WorkoutTemplateExercise[];
  bandLevels: BandLevel[];
  /** Nur gezählt: welche Wochenregeln mit einer entfernten Zuordnung gehen. */
  progressionRules: ProgressionRule[];
}

/** `removed` gibt es nur für Zuordnungen eines ersetzten Workouts. */
export type ImportEntryKind = 'new' | 'update' | 'unchanged' | 'removed';

/** Eine Zeile der Vorschau: "Erfassung: Zeit → Wiederholungen + Gewicht". */
export interface ImportFieldChange {
  field: string;
  from: string;
  to: string;
}

interface PlanEntryBase {
  kind: ImportEntryKind;
  label: string;
  changes: ImportFieldChange[];
  /** Was sonst noch passiert, aber an keinem Feld dieses Eintrags hängt. */
  note?: string;
}

/*
 * Jeder Eintrag trägt beides: `record` für den Neuanlage-Fall (vollständig,
 * bis auf Id und Zeitstempel) und `values` für den Änderungsfall (nur die
 * Felder, die die Datei genannt hat). `record: null` heißt "gibt es schon" -
 * so muss die schreibende Schicht nichts erraten und nichts erzwingen.
 */
type NewExercise = Omit<Exercise, 'id' | 'createdAt' | 'updatedAt'>;
type NewTemplate = Omit<WorkoutTemplate, 'id' | 'createdAt' | 'updatedAt'>;
/** `orderIndex` fehlt bewusst: den setzt erst der Reihenfolge-Durchgang. */
type NewAssignment = Omit<WorkoutTemplateExercise, 'id' | 'orderIndex'>;
type NewBandLevel = Omit<BandLevel, 'id' | 'createdAt' | 'updatedAt'>;

export interface ExercisePlanEntry extends PlanEntryBase {
  id: string;
  record: NewExercise | null;
  values: Partial<Exercise>;
}

export interface TemplatePlanEntry extends PlanEntryBase {
  id: string;
  record: NewTemplate | null;
  values: Partial<WorkoutTemplate>;
}

export interface AssignmentPlanEntry extends PlanEntryBase {
  id: string;
  templateId: string;
  templateName: string;
  exerciseId: string;
  exerciseName: string;
  record: NewAssignment | null;
  values: Partial<WorkoutTemplateExercise>;
}

export interface BandLevelPlanEntry extends PlanEntryBase {
  id: string;
  record: NewBandLevel | null;
  values: Partial<BandLevel>;
}

/** Zielreihenfolge eines angefassten Workouts - Ids in Endposition. */
export interface TemplateOrderPlan {
  templateId: string;
  templateName: string;
  orderedIds: string[];
}

export interface LibraryImportSummary {
  createdExercises: number;
  updatedExercises: number;
  createdTemplates: number;
  updatedTemplates: number;
  createdAssignments: number;
  updatedAssignments: number;
  createdBandLevels: number;
  updatedBandLevels: number;
  removedAssignments: number;
}

export interface LibraryImportPlan {
  exercises: ExercisePlanEntry[];
  templates: TemplatePlanEntry[];
  assignments: AssignmentPlanEntry[];
  bandLevels: BandLevelPlanEntry[];
  templateOrder: TemplateOrderPlan[];
  /** Zielreihenfolge des Band-Katalogs, oder `null`, wenn er unberührt bleibt. */
  bandOrder: string[] | null;
  payloadHash: string;
  summary: LibraryImportSummary;
}

/**
 * Der Schlüssel, über den zugeordnet wird.
 *
 * Getrimmt und kleingeschrieben, an genau einer Stelle definiert: "Nordic
 * Curl" und "nordic curl " sind dieselbe Übung, sonst legt der zweite Import
 * eine zweite an. `toLocaleLowerCase('de')` statt `toLowerCase()`, damit auch
 * ein "Ü" verlässlich fällt.
 */
export function normalizeImportKey(name: string) {
  return name.trim().toLocaleLowerCase('de');
}

/**
 * Stabile Serialisierung für den Hash.
 *
 * Sortiert Schlüssel, damit dieselbe Nutzlast in anderer Feldreihenfolge oder
 * mit anderer Einrückung denselben Hash bekommt - sonst wäre der Wert im
 * Protokoll kein Wiedererkennungsmerkmal, sondern ein Zufall der Formatierung.
 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  }

  return JSON.stringify(value) ?? 'null';
}

/**
 * FNV-1a über die Nutzlast, 32 Bit, hex.
 *
 * Bewusst kein `crypto.subtle`: das ist asynchron und würde die Planung aus
 * der reinen Schicht heraustreiben. Der Hash beantwortet "ist das dieselbe
 * Datei wie neulich", nicht "hat jemand daran manipuliert".
 */
export function hashImportPayload(payload: LibraryImportPayload): string {
  const text = stableStringify(payload);
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
}

/**
 * Liest die Nutzlast und prüft Schema und Pflichtfelder.
 *
 * Meldet Block und Position statt eines zod-Pfads: "exercises.3.trackingMode"
 * hilft niemandem, der die Datei von Hand geschrieben hat.
 */
export function parseLibraryImportPayload(json: string): LibraryImportPayload {
  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Die JSON-Datei konnte nicht gelesen werden.');
  }

  const version = (parsed as { schemaVersion?: unknown } | null)?.schemaVersion;

  if (typeof version === 'number' && version !== LIBRARY_IMPORT_SCHEMA_VERSION) {
    throw new Error(
      `Diese Datei nutzt das Import-Format ${version}, unterstützt wird ${LIBRARY_IMPORT_SCHEMA_VERSION}.`,
    );
  }

  const result = libraryImportPayloadSchema.safeParse(parsed);

  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`Import-Datei ungültig bei ${describeIssuePath(issue.path)}: ${issue.message}`);
  }

  return result.data;
}

const BLOCK_LABELS: Record<string, string> = {
  exercises: 'Übung',
  templates: 'Workout',
  templateAssignments: 'Zuordnung',
  bandLevels: 'Band',
};

function describeIssuePath(path: Array<string | number>) {
  const [block, index, field] = path;

  if (typeof block !== 'string') {
    return 'der Datei';
  }

  const label = BLOCK_LABELS[block] ?? block;

  if (typeof index !== 'number') {
    return label;
  }

  return field ? `${label} ${index + 1}, Feld "${String(field)}"` : `${label} ${index + 1}`;
}

function describeValue(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return '—';
  }

  if (typeof value === 'boolean') {
    return value ? 'ja' : 'nein';
  }

  if (typeof value === 'number') {
    return formatNumber(value);
  }

  return String(value);
}

/**
 * Sammelt eine Änderung, wenn sich der Wert unterscheidet.
 *
 * Gibt zurück, ob geschrieben werden muss - so entstehen Vorschauzeile und
 * Schreibwert aus einer Entscheidung statt aus zwei.
 */
function diffField(
  changes: ImportFieldChange[],
  field: string,
  current: unknown,
  next: unknown,
  format: (value: unknown) => string = describeValue,
) {
  if (current === next) {
    return false;
  }

  changes.push({ field, from: format(current), to: format(next) });
  return true;
}

function describeTrackingMode(value: unknown) {
  return typeof value === 'string' && value in TRACKING_MODE_LABELS
    ? TRACKING_MODE_LABELS[value as TrackingMode]
    : describeValue(value);
}

/** Leerer Text zählt als "nicht angegeben" - wie `normalizeOptionalText`. */
function optionalText(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function planExercises(
  payload: LibraryImportPayload,
  state: LibraryImportState,
  problems: string[],
) {
  const existingByKey = new Map(state.exercises.map((item) => [normalizeImportKey(item.name), item]));
  const seen = new Set<string>();
  const entries: ExercisePlanEntry[] = [];

  payload.exercises.forEach((input, index) => {
    const name = input.name.trim();
    const key = normalizeImportKey(name);

    if (seen.has(key)) {
      problems.push(`Übung ${index + 1}: "${name}" steht mehrfach in dieser Datei.`);
      return;
    }

    seen.add(key);

    const existing = existingByKey.get(key);
    const changes: ImportFieldChange[] = [];
    const values: Partial<Exercise> = {};

    if (!existing) {
      entries.push({
        id: createId(),
        kind: 'new',
        label: name,
        changes: [
          { field: 'Erfassung', from: '—', to: describeTrackingMode(input.trackingMode) },
          { field: 'Seiten', from: '—', to: input.unilateral ? 'links/rechts' : 'beidseitig' },
        ],
        record: {
          name,
          instructions: optionalText(input.instructions),
          tempo: optionalText(input.tempo),
          trackingMode: input.trackingMode,
          unilateral: input.unilateral,
          loadKind: input.loadKind === 'band' ? 'band' : undefined,
          tracksHeight: input.tracksHeight ? true : undefined,
        },
        values: {},
      });
      return;
    }

    if (diffField(changes, 'Name', existing.name, name)) {
      values.name = name;
    }

    if (diffField(changes, 'Erfassung', existing.trackingMode, input.trackingMode, describeTrackingMode)) {
      values.trackingMode = input.trackingMode;
    }

    if (diffField(changes, 'Seiten', existing.unilateral, input.unilateral, (value) =>
      value ? 'links/rechts' : 'beidseitig',
    )) {
      values.unilateral = input.unilateral;
    }

    const instructions = optionalText(input.instructions);

    if (instructions !== undefined && diffField(changes, 'Anleitung', existing.instructions, instructions)) {
      values.instructions = instructions;
    }

    const tempo = optionalText(input.tempo);

    if (tempo !== undefined && diffField(changes, 'Tempo', existing.tempo, tempo)) {
      values.tempo = tempo;
    }

    if (input.loadKind !== undefined) {
      const loadKind: LoadKind | undefined = input.loadKind === 'band' ? 'band' : undefined;

      if (diffField(changes, 'Belastung', existing.loadKind, loadKind, (value) =>
        value === 'band' ? 'Band' : 'Gewicht',
      )) {
        values.loadKind = loadKind;
      }
    }

    if (input.tracksHeight !== undefined) {
      const tracksHeight = input.tracksHeight ? true : undefined;

      if (diffField(changes, 'Höhe', existing.tracksHeight ? true : undefined, tracksHeight)) {
        values.tracksHeight = tracksHeight;
      }
    }

    entries.push({
      id: existing.id,
      kind: changes.length > 0 ? 'update' : 'unchanged',
      label: name,
      changes,
      record: null,
      values,
    });
  });

  return entries;
}

function planTemplates(
  payload: LibraryImportPayload,
  state: LibraryImportState,
  problems: string[],
) {
  const existingByKey = new Map(state.templates.map((item) => [normalizeImportKey(item.name), item]));
  const seen = new Set<string>();
  const entries: TemplatePlanEntry[] = [];

  payload.templates.forEach((input, index) => {
    const name = input.name.trim();
    const key = normalizeImportKey(name);

    if (seen.has(key)) {
      problems.push(`Workout ${index + 1}: "${name}" steht mehrfach in dieser Datei.`);
      return;
    }

    seen.add(key);

    const existing = existingByKey.get(key);

    if (!existing) {
      entries.push({
        id: createId(),
        kind: 'new',
        label: name,
        changes: [],
        record: { name, notes: optionalText(input.notes) },
        values: {},
      });
      return;
    }

    const changes: ImportFieldChange[] = [];
    const values: Partial<WorkoutTemplate> = {};

    if (diffField(changes, 'Name', existing.name, name)) {
      values.name = name;
    }

    const notes = optionalText(input.notes);

    if (notes !== undefined && diffField(changes, 'Notiz', existing.notes, notes)) {
      values.notes = notes;
    }

    entries.push({
      id: existing.id,
      kind: changes.length > 0 ? 'update' : 'unchanged',
      label: name,
      changes,
      record: null,
      values,
    });
  });

  return entries;
}

/** Ein Platz in der Reihenfolge eines Workouts - bestehend oder neu. */
interface OrderSlot {
  id: string;
  supersetGroupId?: string;
}

/**
 * Wohin eine neue Zuordnung wirklich kommt.
 *
 * Der Wunschindex wird auf die Liste geklemmt und dann an einem Supersatz
 * vorbeigeschoben: Mitglieder einer Gruppe liegen immer zusammenhängend im
 * `orderIndex` (siehe [superset.ts]), und eine Einfügung mittendrin würde
 * genau das brechen - der Block ließe sich danach weder darstellen noch am
 * Stück bewegen. Der Eintrag rutscht deshalb ans Ende des Laufs.
 */
function resolveInsertPosition(slots: OrderSlot[], desiredIndex: number) {
  let position = Math.min(Math.max(desiredIndex - 1, 0), slots.length);

  const before = slots[position - 1];
  const after = slots[position];

  if (before?.supersetGroupId && before.supersetGroupId === after?.supersetGroupId) {
    const groupId = before.supersetGroupId;

    while (slots[position]?.supersetGroupId === groupId) {
      position += 1;
    }

    return { position, movedPastSuperset: true };
  }

  return { position, movedPastSuperset: false };
}

function planAssignments(
  payload: LibraryImportPayload,
  state: LibraryImportState,
  exerciseEntries: ExercisePlanEntry[],
  templateEntries: TemplatePlanEntry[],
  problems: string[],
) {
  const exerciseIdByKey = new Map<string, { id: string; name: string }>();

  for (const exercise of state.exercises) {
    exerciseIdByKey.set(normalizeImportKey(exercise.name), { id: exercise.id, name: exercise.name });
  }

  for (const entry of exerciseEntries) {
    exerciseIdByKey.set(normalizeImportKey(entry.label), { id: entry.id, name: entry.label });
  }

  const templateIdByKey = new Map<string, { id: string; name: string }>();

  for (const template of state.templates) {
    templateIdByKey.set(normalizeImportKey(template.name), { id: template.id, name: template.name });
  }

  for (const entry of templateEntries) {
    templateIdByKey.set(normalizeImportKey(entry.label), { id: entry.id, name: entry.label });
  }

  // Ausgangsreihenfolge je Workout, die im Verlauf der Planung mitwächst.
  const slotsByTemplateId = new Map<string, OrderSlot[]>();

  for (const template of state.templates) {
    const items = state.templateExercises
      .filter((item) => item.templateId === template.id)
      .sort((left, right) => left.orderIndex - right.orderIndex)
      .map((item) => ({ id: item.id, supersetGroupId: item.supersetGroupId }));

    slotsByTemplateId.set(template.id, items);
  }

  const existingByPair = new Map<string, WorkoutTemplateExercise>();

  for (const item of state.templateExercises) {
    existingByPair.set(`${item.templateId}::${item.exerciseId}`, item);
  }

  /*
   * Workouts, deren Zusammensetzung die Datei vollständig beschreibt. Ihre
   * Zuordnungen laufen nicht über die Einfügelogik, sondern werden gesammelt
   * und nach der Schleife als Ganzes gegen den Bestand gelegt.
   */
  const replacedTemplateIds = new Set<string>();

  for (const input of payload.templates) {
    const template = templateIdByKey.get(normalizeImportKey(input.name));

    if (input.replaceAssignments && template) {
      replacedTemplateIds.add(template.id);
    }
  }

  const replacedRows = new Map<string, ReplacedRow[]>();

  // Nur Workouts, in die etwas eingefügt wurde, werden neu durchnummeriert.
  // Eine reine Wertänderung soll die Reihenfolge nicht stillschweigend
  // verdichten - die gehört den Pfeilen in der Workout-Ansicht.
  const reorderedTemplateIds = new Set<string>();
  const seenPairs = new Set<string>();
  const entries: AssignmentPlanEntry[] = [];

  payload.templateAssignments.forEach((input, index) => {
    const position = index + 1;
    const templateName = input.template.trim();
    const exerciseName = input.exercise.trim();
    const template = templateIdByKey.get(normalizeImportKey(templateName));
    const exercise = exerciseIdByKey.get(normalizeImportKey(exerciseName));

    if (!template) {
      problems.push(
        `Zuordnung ${position}: Workout "${templateName}" gibt es nicht und es wird auch in dieser Datei nicht angelegt.`,
      );
      return;
    }

    if (!exercise) {
      problems.push(
        `Zuordnung ${position}: Übung "${exerciseName}" gibt es nicht und sie wird auch in dieser Datei nicht angelegt.`,
      );
      return;
    }

    const pairKey = `${template.id}::${exercise.id}`;

    if (seenPairs.has(pairKey)) {
      problems.push(
        `Zuordnung ${position}: "${exerciseName}" steht für "${templateName}" mehrfach in dieser Datei.`,
      );
      return;
    }

    seenPairs.add(pairKey);

    const slots = slotsByTemplateId.get(template.id) ?? [];
    slotsByTemplateId.set(template.id, slots);

    const existing = existingByPair.get(pairKey);
    const changes: ImportFieldChange[] = [];
    const replaced = replacedTemplateIds.has(template.id);

    if (input.superset !== undefined && !replaced) {
      // Wie sich eine Gruppe zu einem Bestand verhält, den die Datei nicht
      // vollständig beschreibt, ist nicht zu entscheiden - also kein Raten.
      problems.push(
        `Zuordnung ${position}: "superset" geht nur bei einem Workout mit "replaceAssignments": true.`,
      );
      return;
    }

    if (!existing && replaced) {
      const entry: AssignmentPlanEntry = {
        id: createId(),
        kind: 'new',
        label: exerciseName,
        templateId: template.id,
        templateName: template.name,
        exerciseId: exercise.id,
        exerciseName,
        changes: [
          { field: 'Arbeitssätze', from: '—', to: formatNumber(input.workSetCount) },
          { field: 'Warmup', from: '—', to: input.includeWarmup === false ? 'nein' : 'ja' },
        ],
        record: {
          templateId: template.id,
          exerciseId: exercise.id,
          ...buildAssignmentValues(input),
        },
        values: {},
      };

      entries.push(entry);
      pushReplacedRow(replacedRows, template.id, { entry, input, position });
      return;
    }

    if (!existing) {
      const { position: insertAt, movedPastSuperset } = resolveInsertPosition(slots, input.orderIndex);
      const shifted = slots.length - insertAt;
      const id = createId();

      slots.splice(insertAt, 0, { id });
      reorderedTemplateIds.add(template.id);

      const notes: string[] = [`Position ${insertAt + 1}`];

      if (movedPastSuperset) {
        notes.push('hinter den Supersatz gesetzt, damit der Block zusammenbleibt');
      }

      if (shifted > 0) {
        notes.push(`${shifted} bestehende Übung${shifted === 1 ? '' : 'en'} rückt nach hinten`);
      }

      entries.push({
        id,
        kind: 'new',
        label: exerciseName,
        templateId: template.id,
        templateName: template.name,
        exerciseId: exercise.id,
        exerciseName,
        note: notes.join(' · '),
        changes: [
          { field: 'Arbeitssätze', from: '—', to: formatNumber(input.workSetCount) },
          { field: 'Warmup', from: '—', to: input.includeWarmup === false ? 'nein' : 'ja' },
        ],
        record: {
          templateId: template.id,
          exerciseId: exercise.id,
          ...buildAssignmentValues(input),
        },
        values: {},
      });
      return;
    }

    const values: Partial<WorkoutTemplateExercise> = {};

    if (diffField(changes, 'Arbeitssätze', existing.workSetCount, input.workSetCount)) {
      values.workSetCount = input.workSetCount;
    }

    if (input.includeWarmup !== undefined) {
      // `undefined` zählt gespeichert wie `true` - verglichen wird deshalb der
      // Sinn, nicht der Schlüssel.
      const includeWarmup = input.includeWarmup !== false;

      if (diffField(changes, 'Warmup', existing.includeWarmup !== false, includeWarmup)) {
        values.includeWarmup = includeWarmup;
      }
    }

    diffAssignmentNumber(changes, values, 'Ziel-Wdh.', 'targetReps', existing, input.targetReps);
    diffAssignmentNumber(changes, values, 'Ziel-Wdh. max.', 'targetRepsMax', existing, input.targetRepsMax);
    diffAssignmentNumber(changes, values, 'Ziel-Sekunden', 'targetSeconds', existing, input.targetSeconds);
    diffAssignmentNumber(changes, values, 'Ziel-Gewicht', 'targetWeight', existing, input.targetWeight);
    diffAssignmentNumber(changes, values, 'Ziel-Höhe', 'targetHeightCm', existing, input.targetHeightCm);
    diffAssignmentNumber(changes, values, 'Pause', 'restSeconds', existing, input.restSeconds);

    if (input.notes === null) {
      if (existing.notes !== undefined && diffField(changes, 'Notiz', existing.notes, undefined)) {
        values.notes = undefined;
      }
    } else {
      const notes = optionalText(input.notes);

      if (notes !== undefined && diffField(changes, 'Notiz', existing.notes, notes)) {
        values.notes = notes;
      }
    }

    /*
     * Die Position einer bestehenden Zuordnung bleibt, wie sie ist. Der
     * Wunschindex sagt, wo etwas *Neues* hinsoll; eine von Hand mit den
     * Pfeilen sortierte Reihenfolge darf ein wiederholter Import nicht wieder
     * einreißen. Sichtbar gemacht wird die Abweichung trotzdem.
     */
    const currentPosition = slots.findIndex((slot) => slot.id === existing.id) + 1;
    const note =
      !replaced && currentPosition > 0 && currentPosition !== input.orderIndex
        ? `Position ${currentPosition} bleibt (Datei nennt ${input.orderIndex})`
        : undefined;

    const entry: AssignmentPlanEntry = {
      id: existing.id,
      kind: changes.length > 0 ? 'update' : 'unchanged',
      label: exerciseName,
      templateId: template.id,
      templateName: template.name,
      exerciseId: exercise.id,
      exerciseName,
      note,
      changes,
      record: null,
      values,
    };

    entries.push(entry);

    if (replaced) {
      pushReplacedRow(replacedRows, template.id, { entry, input, position });
    }
  });

  const replacedOrder = planReplacedTemplates(
    replacedTemplateIds,
    replacedRows,
    slotsByTemplateId,
    state,
    templateIdByKey,
    entries,
    problems,
  );

  const templateOrder: TemplateOrderPlan[] = [];

  for (const templateId of reorderedTemplateIds) {
    const slots = slotsByTemplateId.get(templateId);
    const template = state.templates.find((item) => item.id === templateId);
    const created = templateEntries.find((item) => item.id === templateId);

    if (!slots) {
      continue;
    }

    templateOrder.push({
      templateId,
      templateName: template?.name ?? created?.label ?? '',
      orderedIds: slots.map((slot) => slot.id),
    });
  }

  return { entries, templateOrder: [...templateOrder, ...replacedOrder] };
}

/** Eine Dateizeile eines ersetzten Workouts, samt ihrem Planeintrag. */
interface ReplacedRow {
  entry: AssignmentPlanEntry;
  input: ImportAssignmentInput;
  /** 1-basierte Zeile in `templateAssignments` - für Fehlermeldungen. */
  position: number;
}

function pushReplacedRow(rows: Map<string, ReplacedRow[]>, templateId: string, row: ReplacedRow) {
  const list = rows.get(templateId) ?? [];
  list.push(row);
  rows.set(templateId, list);
}

function describeRuleCount(count: number) {
  return count === 1 ? '1 Wochenregel geht mit' : `${formatNumber(count)} Wochenregeln gehen mit`;
}

function describePartners(names: string[]) {
  if (names.length === 0) {
    return 'allein';
  }

  if (names.length === 1) {
    return `mit ${names[0]}`;
  }

  return `mit ${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`;
}

/**
 * Supersätze eines ersetzten Workouts aus den Gruppennamen der Datei.
 *
 * Eine Gruppe behält ihre bisherige `supersetGroupId`, wenn alle Mitglieder
 * sie schon tragen und keine andere bleibende Zuordnung des Workouts sie
 * trägt; sonst bekommt sie eine neue. Nur so ist der zweite Lauf derselben
 * Datei "unverändert". Die Vorschau nennt die Partner, nie die Id - eine
 * UUID sagt niemandem etwas.
 *
 * Bricht ab, wenn eine Gruppe nicht zusammenhängend steht oder nur eine
 * Übung hat: Mitglieder liegen immer am Stück im `orderIndex` (siehe
 * [superset.ts]), und ein Supersatz aus einer Übung ist keiner.
 */
function planReplacedSupersets(
  sorted: ReplacedRow[],
  templateName: string,
  existingById: Map<string, WorkoutTemplateExercise>,
  exerciseNameById: Map<string, string>,
  problems: string[],
) {
  const labelOf = (row: ReplacedRow) =>
    row.input.superset !== undefined ? normalizeImportKey(row.input.superset) : undefined;
  const members = new Map<string, ReplacedRow[]>();
  const closed = new Set<string>();
  let previous: string | undefined;

  for (const row of sorted) {
    const label = labelOf(row);

    if (label !== previous && previous !== undefined) {
      closed.add(previous);
    }

    if (label !== undefined) {
      if (closed.has(label)) {
        problems.push(
          `Supersatz "${row.input.superset?.trim()}" in "${templateName}" ist nicht zusammenhängend – seine Übungen müssen direkt hintereinander stehen.`,
        );
        return;
      }

      members.set(label, [...(members.get(label) ?? []), row]);
    }

    previous = label;
  }

  const keptIds = new Set(sorted.filter((row) => row.entry.kind !== 'new').map((row) => row.entry.id));
  const targetGroupByEntryId = new Map<string, string>();

  for (const group of members.values()) {
    if (group.length === 1) {
      problems.push(
        `Supersatz "${group[0].input.superset?.trim()}" in "${templateName}" hat nur eine Übung.`,
      );
      return;
    }

    const groupIds = group.map((row) => existingById.get(row.entry.id)?.supersetGroupId);
    const candidate = groupIds[0];
    const memberIds = new Set(group.map((row) => row.entry.id));
    const reusable =
      candidate !== undefined &&
      groupIds.every((id) => id === candidate) &&
      [...keptIds].every(
        (id) => memberIds.has(id) || existingById.get(id)?.supersetGroupId !== candidate,
      );
    const groupId = reusable ? candidate : createId();

    for (const row of group) {
      targetGroupByEntryId.set(row.entry.id, groupId);
    }
  }

  const targetPartners = (row: ReplacedRow) => {
    const label = labelOf(row);
    const group = label !== undefined ? members.get(label) ?? [] : [];
    return group.filter((other) => other !== row).map((other) => other.entry.exerciseName);
  };

  const currentPartners = (id: string) => {
    const groupId = existingById.get(id)?.supersetGroupId;

    if (!groupId) {
      return [];
    }

    return [...existingById.values()]
      .filter((other) => other.id !== id && other.supersetGroupId === groupId)
      .sort((left, right) => left.orderIndex - right.orderIndex)
      .map((other) => exerciseNameById.get(other.exerciseId) ?? '');
  };

  for (const row of sorted) {
    const { entry } = row;
    const targetGroupId = targetGroupByEntryId.get(entry.id);

    if (entry.kind === 'new') {
      if (entry.record && targetGroupId) {
        entry.record.supersetGroupId = targetGroupId;
        entry.changes.push({ field: 'Supersatz', from: '—', to: describePartners(targetPartners(row)) });
      }

      continue;
    }

    const currentGroupId = existingById.get(entry.id)?.supersetGroupId;

    if (currentGroupId === targetGroupId) {
      continue;
    }

    entry.changes.push({
      field: 'Supersatz',
      from: describePartners(currentPartners(entry.id)),
      to: describePartners(targetPartners(row)),
    });
    // `undefined` als Wert löst die Gruppe auf - `Table.update` entfernt die
    // Property, und genau das ist hier gemeint.
    entry.values.supersetGroupId = targetGroupId;
    entry.kind = 'update';
  }
}

/**
 * Legt die Dateizeilen jedes ersetzten Workouts als Ganzes gegen den Bestand.
 *
 * Die Reihenfolge der Datei gilt (dicht ab 1, Lücken im `orderIndex` sind
 * erlaubt), eine bleibende Zuordnung behält ihre Id - und damit ihre
 * Wochenregeln -, und was die Datei nicht nennt, wird ein `removed`-Eintrag.
 * Ergänzt die Einträge in `entries` an Ort und Stelle und gibt die
 * Zielreihenfolgen zurück, aber nur für Workouts, an deren Reihenfolge sich
 * etwas ändert: ein zweiter Lauf derselben Datei soll nichts schreiben.
 */
function planReplacedTemplates(
  replacedTemplateIds: Set<string>,
  replacedRows: Map<string, ReplacedRow[]>,
  slotsByTemplateId: Map<string, OrderSlot[]>,
  state: LibraryImportState,
  templateIdByKey: Map<string, { id: string; name: string }>,
  entries: AssignmentPlanEntry[],
  problems: string[],
): TemplateOrderPlan[] {
  const templateNameById = new Map([...templateIdByKey.values()].map((item) => [item.id, item.name]));
  const exerciseNameById = new Map(state.exercises.map((item) => [item.id, item.name]));
  const existingById = new Map(state.templateExercises.map((item) => [item.id, item]));
  const orders: TemplateOrderPlan[] = [];

  for (const templateId of replacedTemplateIds) {
    const templateName = templateNameById.get(templateId) ?? '';
    const rows = replacedRows.get(templateId) ?? [];

    if (rows.length === 0) {
      problems.push(
        `Workout "${templateName}" soll ersetzt werden, die Datei nennt aber keine Übung dafür.`,
      );
      continue;
    }

    const seenIndexes = new Set<number>();

    for (const row of rows) {
      if (seenIndexes.has(row.input.orderIndex)) {
        problems.push(
          `Zuordnung ${row.position}: orderIndex ${row.input.orderIndex} steht für "${templateName}" mehrfach in dieser Datei.`,
        );
      }

      seenIndexes.add(row.input.orderIndex);
    }

    const sorted = [...rows].sort((left, right) => left.input.orderIndex - right.input.orderIndex);
    const targetIds = sorted.map((row) => row.entry.id);
    const currentIds = (slotsByTemplateId.get(templateId) ?? []).map((slot) => slot.id);

    planReplacedSupersets(sorted, templateName, existingById, exerciseNameById, problems);

    sorted.forEach((row, index) => {
      const { entry } = row;

      if (entry.kind === 'new') {
        entry.note = `Position ${index + 1}`;
        return;
      }

      const currentPosition = currentIds.indexOf(entry.id) + 1;

      if (diffField(entry.changes, 'Position', currentPosition, index + 1)) {
        entry.kind = 'update';
      }
    });

    const kept = new Set(targetIds);

    for (const id of currentIds) {
      if (kept.has(id)) {
        continue;
      }

      const existing = existingById.get(id);

      if (!existing) {
        continue;
      }

      const ruleCount = state.progressionRules.filter((rule) => rule.templateExerciseId === id).length;
      const exerciseName = exerciseNameById.get(existing.exerciseId) ?? '';

      entries.push({
        id,
        kind: 'removed',
        label: exerciseName,
        templateId,
        templateName,
        exerciseId: existing.exerciseId,
        exerciseName,
        note: ruleCount > 0 ? describeRuleCount(ruleCount) : undefined,
        changes: [],
        record: null,
        values: {},
      });
    }

    const unchangedOrder =
      targetIds.length === currentIds.length && targetIds.every((id, index) => id === currentIds[index]);

    if (!unchangedOrder) {
      orders.push({ templateId, templateName, orderedIds: targetIds });
    }
  }

  return orders;
}

type AssignmentNumberField =
  | 'targetReps'
  | 'targetRepsMax'
  | 'targetSeconds'
  | 'targetWeight'
  | 'targetHeightCm'
  | 'restSeconds';

function diffAssignmentNumber(
  changes: ImportFieldChange[],
  values: Partial<WorkoutTemplateExercise>,
  label: string,
  field: AssignmentNumberField,
  existing: WorkoutTemplateExercise,
  next?: number | null,
) {
  if (next === undefined) {
    return;
  }

  if (next === null) {
    /*
     * Die einzige Stelle, an der Dexies Eigenheit gewollt ist: `Table.update`
     * entfernt eine Property, deren Wert `undefined` ist. Der Schlüssel muss
     * deshalb in `values` stehen - ein fehlender Schlüssel ließe das Feld
     * stehen. Ein `null` auf ein ohnehin leeres Feld ist keine Änderung.
     */
    if (existing[field] !== undefined && diffField(changes, label, existing[field], undefined)) {
      values[field] = undefined;
    }

    return;
  }

  if (diffField(changes, label, existing[field], next)) {
    values[field] = next;
  }
}

function buildAssignmentValues(
  input: ImportAssignmentInput,
): Omit<NewAssignment, 'templateId' | 'exerciseId'> {
  return {
    workSetCount: input.workSetCount,
    // Immer als echter Boolean: `undefined` löschte die Property beim Update.
    includeWarmup: input.includeWarmup !== false,
    // `null` heißt bei einer neuen Zuordnung schlicht: kein Wert.
    targetReps: input.targetReps ?? undefined,
    targetRepsMax: input.targetRepsMax ?? undefined,
    targetSeconds: input.targetSeconds ?? undefined,
    targetWeight: input.targetWeight ?? undefined,
    targetHeightCm: input.targetHeightCm ?? undefined,
    restSeconds: input.restSeconds ?? undefined,
    notes: optionalText(input.notes ?? undefined),
  };
}

function planBandLevels(
  payload: LibraryImportPayload,
  state: LibraryImportState,
  problems: string[],
) {
  const existingByKey = new Map(state.bandLevels.map((item) => [normalizeImportKey(item.name), item]));
  const slots = [...state.bandLevels]
    .sort((left, right) => left.orderIndex - right.orderIndex)
    .map((item) => ({ id: item.id }));

  const seen = new Set<string>();
  const entries: BandLevelPlanEntry[] = [];
  let touched = false;

  payload.bandLevels.forEach((input, index) => {
    const name = input.name.trim();
    const key = normalizeImportKey(name);

    if (seen.has(key)) {
      problems.push(`Band ${index + 1}: "${name}" steht mehrfach in dieser Datei.`);
      return;
    }

    seen.add(key);

    const existing = existingByKey.get(key);

    if (!existing) {
      const { position } = resolveInsertPosition(slots, input.orderIndex);
      const shifted = slots.length - position;
      const id = createId();

      slots.splice(position, 0, { id });
      touched = true;

      entries.push({
        id,
        kind: 'new',
        label: name,
        note:
          shifted > 0
            ? `Stufe ${position + 1} · ${shifted} Band${shifted === 1 ? '' : 'stufen'} rückt nach hinten`
            : `Stufe ${position + 1}`,
        changes: [],
        record: { name, orderIndex: position + 1 },
        values: {},
      });
      return;
    }

    /*
     * Ein bestehendes Band behält seine Stufe - genau wie eine bestehende
     * Zuordnung ihre Position behält. `orderIndex` ist hier der Inhalt (er
     * allein macht "grün leichter als rot"), und den einer wiederholten Datei
     * zu opfern, hieße die Reihenfolge im Katalog stillschweigend umzubauen.
     */
    const changes: ImportFieldChange[] = [];
    const values: Partial<BandLevel> = {};

    if (diffField(changes, 'Name', existing.name, name)) {
      values.name = name;
      touched = true;
    }

    entries.push({
      id: existing.id,
      kind: changes.length > 0 ? 'update' : 'unchanged',
      label: name,
      note: `Stufe ${slots.findIndex((slot) => slot.id === existing.id) + 1}`,
      changes,
      record: null,
      values,
    });
  });

  return { entries, bandOrder: touched ? slots.map((slot) => slot.id) : null };
}

function countKind(entries: PlanEntryBase[], kind: ImportEntryKind) {
  return entries.filter((entry) => entry.kind === kind).length;
}

/**
 * Vergleicht die Nutzlast mit dem Bestand und beschreibt, was passieren würde.
 *
 * Wirft bei jedem Problem, das erst im Zusammenspiel sichtbar wird - ein
 * Verweis auf ein Workout, das es weder gibt noch in dieser Datei entsteht,
 * ist keine Warnung, sondern ein Abbruch: der halbe Import wäre schlechter als
 * gar keiner. Reine Formfehler hat `parseLibraryImportPayload` vorher gefangen.
 */
export function planLibraryImport(
  payload: LibraryImportPayload,
  state: LibraryImportState,
): LibraryImportPlan {
  const problems: string[] = [];
  const exercises = planExercises(payload, state, problems);
  const templates = planTemplates(payload, state, problems);
  const { entries: assignments, templateOrder } = planAssignments(
    payload,
    state,
    exercises,
    templates,
    problems,
  );
  const { entries: bandLevels, bandOrder } = planBandLevels(payload, state, problems);

  if (problems.length > 0) {
    throw new Error(problems.slice(0, 5).join('\n'));
  }

  return {
    exercises,
    templates,
    assignments,
    bandLevels,
    templateOrder,
    bandOrder,
    payloadHash: hashImportPayload(payload),
    summary: {
      createdExercises: countKind(exercises, 'new'),
      updatedExercises: countKind(exercises, 'update'),
      createdTemplates: countKind(templates, 'new'),
      updatedTemplates: countKind(templates, 'update'),
      createdAssignments: countKind(assignments, 'new'),
      updatedAssignments: countKind(assignments, 'update'),
      createdBandLevels: countKind(bandLevels, 'new'),
      updatedBandLevels: countKind(bandLevels, 'update'),
      removedAssignments: countKind(assignments, 'removed'),
    },
  };
}

/** Ob der Plan überhaupt etwas schreiben würde. */
export function planHasChanges(plan: LibraryImportPlan) {
  return (
    plan.exercises.some((entry) => entry.kind !== 'unchanged') ||
    plan.templates.some((entry) => entry.kind !== 'unchanged') ||
    plan.assignments.some((entry) => entry.kind !== 'unchanged') ||
    plan.bandLevels.some((entry) => entry.kind !== 'unchanged')
  );
}
