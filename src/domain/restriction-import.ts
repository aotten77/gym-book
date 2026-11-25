import { z } from 'zod';
import { normalizeImportKey } from '@/domain/import-key';
import { diffImportField, type ImportFieldChange } from '@/domain/import-diff';
import type {
  AssignmentPlanEntry,
  ExercisePlanEntry,
  LibraryImportState,
  TemplatePlanEntry,
} from '@/domain/library-import';
import type {
  ExerciseAdjustment,
  ExerciseTarget,
  GuidedStep,
  Restriction,
  RestrictionAdjustment,
  RestrictionPause,
  RestrictionReplacement,
  StepAdjustment,
  StepTarget,
} from '@/domain/models';
import { isValidLocalDate } from '@/domain/plan';
import {
  describeAdjustmentLine,
  describePauseLine,
  describeRestrictionState,
  findAdjustmentConflicts,
  formatRestrictionDate,
  formatRestrictionDay,
  isStepTarget,
  type RestrictionNameLookup,
} from '@/domain/restriction';

/*
 * Der Block `restrictions` des Bibliotheks-Imports: Schema, Auflösung der
 * Namen auf Ids und die Vorschau. Wie die übrigen Blöcke rein - der Bestand
 * kommt als Daten, Probleme sammeln sich in `problems`, und ein einziges
 * bricht den ganzen Import ab.
 *
 * Alle Objekte des Blocks sind streng (`.strict()`): ein vertippter Feldname
 * („targetWieght“) bricht ab, statt still zu fehlen - eine Einschränkung, die
 * nicht wirkt, merkt man erst beim Training.
 */

const nonNegative = z.number().nonnegative();
const exerciseValueFields = {
  workSetCount: z.number().int().positive().optional(),
  targetReps: nonNegative.optional(),
  targetRepsMax: nonNegative.optional(),
  targetSeconds: nonNegative.optional(),
  targetWeight: nonNegative.optional(),
  targetHeightCm: nonNegative.optional(),
};
const targetFields = {
  exercise: z.string().min(1).optional(),
  template: z.string().min(1).optional(),
  step: z.string().min(1).optional(),
};

const importReplacementSchema = z
  .object({
    exercise: z.string().min(1),
    ...exerciseValueFields,
    restSeconds: nonNegative.optional(),
  })
  .strict();

const importPauseSchema = z
  .object({ ...targetFields, replacement: importReplacementSchema.optional() })
  .strict();

const importAdjustmentSchema = z
  .object({
    ...targetFields,
    ...exerciseValueFields,
    seconds: z.number().int().positive().optional(),
    note: z.string().optional(),
    holdProgression: z.boolean().optional(),
  })
  .strict();

export const importRestrictionSchema = z
  .object({
    name: z
      .string({ required_error: 'Der Name fehlt.', invalid_type_error: 'Der Name muss Text sein.' })
      .refine((value) => value.trim().length > 0, 'Der Name darf nicht leer sein.'),
    reason: z.string().nullable().optional(),
    from: z.string().optional(),
    until: z.string().nullable().optional(),
    lifted: z.boolean().optional(),
    pauses: z.array(importPauseSchema).optional(),
    adjustments: z.array(importAdjustmentSchema).optional(),
  })
  .strict();

export type ImportRestrictionInput = z.infer<typeof importRestrictionSchema>;
type ImportPauseInput = z.infer<typeof importPauseSchema>;
type ImportAdjustmentInput = z.infer<typeof importAdjustmentSchema>;

export type RestrictionPlanKind = 'new' | 'update' | 'unchanged' | 'lifted' | 'reactivated';

export interface RestrictionPlanEntry {
  kind: RestrictionPlanKind;
  id: string;
  label: string;
  changes: ImportFieldChange[];
  /** Vollständig bei `new`, sonst `null`. */
  record: Omit<Restriction, 'id' | 'createdAt' | 'updatedAt'> | null;
  /** Nur die genannten und geänderten Felder; ein Schlüssel mit `undefined` löscht das Feld. */
  values: Partial<Restriction>;
  /** `undefined`: unverändert, `null`: entfernen, Text: setzen (den Zeitpunkt setzt das Schreiben). */
  liftedAt: string | null | undefined;
  /** Die Ziele nach dem Import in Klarnamen. */
  targets: string[];
  stateAfter: 'aktiv' | 'angekündigt' | 'abgelaufen' | 'aufgehoben';
  note?: string;
}

const EXERCISE_VALUE_KEYS = [
  'workSetCount',
  'targetReps',
  'targetRepsMax',
  'targetSeconds',
  'targetWeight',
  'targetHeightCm',
] as const;

interface ResolveContext {
  exercisesByKey: Map<string, { id: string; name: string }>;
  templatesByKey: Map<string, { id: string; name: string }>;
  /** Die Schritte jeder Vorlage nach dem Import. */
  stepsByTemplateId: Map<string, GuidedStep[]>;
  /** `templateId::exerciseId` aller Zuordnungen nach dem Import. */
  pairs: Set<string>;
  names: RestrictionNameLookup;
}

function buildContext(input: {
  state: LibraryImportState;
  exercises: ExercisePlanEntry[];
  templates: TemplatePlanEntry[];
  assignments: AssignmentPlanEntry[];
}): ResolveContext {
  const exercisesByKey = new Map<string, { id: string; name: string }>();
  const templatesByKey = new Map<string, { id: string; name: string }>();
  const exerciseNames = new Map<string, string>();
  const templateNames = new Map<string, string>();
  const stepsByTemplateId = new Map<string, GuidedStep[]>();

  for (const exercise of input.state.exercises) {
    exercisesByKey.set(normalizeImportKey(exercise.name), { id: exercise.id, name: exercise.name });
    exerciseNames.set(exercise.id, exercise.name);
  }

  for (const entry of input.exercises) {
    exercisesByKey.set(normalizeImportKey(entry.label), { id: entry.id, name: entry.label });
    exerciseNames.set(entry.id, entry.label);
  }

  for (const template of input.state.templates) {
    templatesByKey.set(normalizeImportKey(template.name), { id: template.id, name: template.name });
    templateNames.set(template.id, template.name);

    if (template.steps?.length) {
      stepsByTemplateId.set(template.id, template.steps);
    }
  }

  for (const entry of input.templates) {
    templatesByKey.set(normalizeImportKey(entry.label), { id: entry.id, name: entry.label });
    templateNames.set(entry.id, entry.label);

    const steps = entry.record?.steps ?? entry.values.steps;

    if (steps?.length) {
      stepsByTemplateId.set(entry.id, steps);
    }
  }

  const removedIds = new Set(
    input.assignments.filter((entry) => entry.kind === 'removed').map((entry) => entry.id),
  );
  const pairs = new Set<string>();

  for (const item of input.state.templateExercises) {
    if (!removedIds.has(item.id)) {
      pairs.add(`${item.templateId}::${item.exerciseId}`);
    }
  }

  for (const entry of input.assignments) {
    if (entry.kind !== 'removed') {
      pairs.add(`${entry.templateId}::${entry.exerciseId}`);
    }
  }

  return {
    exercisesByKey,
    templatesByKey,
    stepsByTemplateId,
    pairs,
    names: {
      exerciseName: (id) => exerciseNames.get(id),
      templateName: (id) => templateNames.get(id),
    },
  };
}

function hasStep(steps: readonly GuidedStep[] | undefined, stepName: string) {
  const key = normalizeImportKey(stepName);

  return steps?.some((step) => normalizeImportKey(step.name) === key) ?? false;
}

/**
 * Die Schrittziele ohne Vorlage, die eine Liste schon trägt - normalisiert.
 * Trifft so ein Ziel derzeit nichts, bleibt es stehen (Spec §2); der Bestand
 * nennt es, und sein Rückimport darf daran nicht scheitern.
 */
function storedStepNames(targets: readonly (ExerciseTarget | StepTarget)[] | undefined) {
  return new Set(
    (targets ?? [])
      .filter((target): target is StepTarget => isStepTarget(target) && !target.templateId)
      .map((target) => normalizeImportKey(target.stepName)),
  );
}

/** Löst eine der vier Zielformen auf; meldet, was nicht passt. */
function resolveTarget(
  item: ImportPauseInput | ImportAdjustmentInput,
  context: ResolveContext,
  line: string,
  problems: string[],
  stored: Set<string>,
): ExerciseTarget | StepTarget | undefined {
  if ((item.exercise === undefined) === (item.step === undefined)) {
    problems.push(
      `${line}: braucht genau eine Zielform: "exercise", "template" + "exercise", "template" + "step" oder "step".`,
    );
    return undefined;
  }

  let template: { id: string; name: string } | undefined;

  if (item.template !== undefined) {
    template = context.templatesByKey.get(normalizeImportKey(item.template));

    if (!template) {
      problems.push(`${line}: Workout "${item.template.trim()}" gibt es nicht.`);
      return undefined;
    }
  }

  const scope = template ? { templateId: template.id } : {};

  if (item.step !== undefined) {
    const stepName = item.step.trim();

    if (template) {
      const steps = context.stepsByTemplateId.get(template.id);

      if (!steps) {
        problems.push(`${line}: Workout "${template.name}" hat keine Schritte.`);
        return undefined;
      }

      if (!hasStep(steps, stepName)) {
        problems.push(`${line}: Schritt "${stepName}" gibt es in "${template.name}" nicht.`);
        return undefined;
      }
    } else if (
      !stored.has(normalizeImportKey(stepName)) &&
      ![...context.stepsByTemplateId.values()].some((steps) => hasStep(steps, stepName))
    ) {
      problems.push(`${line}: Schritt "${stepName}" kommt in keiner geführten Vorlage vor.`);
      return undefined;
    }

    return { stepName, ...scope };
  }

  const exerciseName = (item.exercise as string).trim();
  const exercise = context.exercisesByKey.get(normalizeImportKey(exerciseName));

  if (!exercise) {
    problems.push(`${line}: Übung "${exerciseName}" gibt es nicht.`);
    return undefined;
  }

  if (template && !context.pairs.has(`${template.id}::${exercise.id}`)) {
    problems.push(`${line}: Workout "${template.name}" enthält "${exercise.name}" nicht.`);
    return undefined;
  }

  return { exerciseId: exercise.id, ...scope };
}

function targetKey(target: ExerciseTarget | StepTarget) {
  return isStepTarget(target)
    ? `step::${normalizeImportKey(target.stepName)}::${target.templateId ?? ''}`
    : `exercise::${target.exerciseId}::${target.templateId ?? ''}`;
}

/** Ein Ziel zweimal in derselben Liste wäre eine Regel, die sich selbst widerspricht. */
function rejectDuplicateTarget(
  keys: Map<string, number>,
  target: ExerciseTarget | StepTarget,
  index: number,
  label: string,
  line: string,
  problems: string[],
) {
  const key = targetKey(target);
  const first = keys.get(key);

  if (first !== undefined) {
    problems.push(`${line}: dasselbe Ziel steht schon in ${label} ${first + 1}.`);
    return true;
  }

  keys.set(key, index);
  return false;
}

function pickValues<T extends object>(input: T, keys: readonly (keyof T)[]): Partial<T> {
  const values: Partial<T> = {};

  for (const key of keys) {
    if (input[key] !== undefined) {
      values[key] = input[key];
    }
  }

  return values;
}

function resolvePauses(
  items: ImportPauseInput[],
  context: ResolveContext,
  prefix: string,
  problems: string[],
  existing: RestrictionPause[] | undefined,
): RestrictionPause[] {
  const keys = new Map<string, number>();
  const pauses: RestrictionPause[] = [];
  const stored = storedStepNames(existing);

  items.forEach((item, index) => {
    const line = `${prefix}, Pause ${index + 1}`;
    const target = resolveTarget(item, context, line, problems, stored);

    if (!target || rejectDuplicateTarget(keys, target, index, 'Pause', line, problems)) {
      return;
    }

    if (!item.replacement) {
      pauses.push(target);
      return;
    }

    if (isStepTarget(target)) {
      problems.push(`${line}: Einen Ersatz gibt es nur für eine Übung, nicht für einen Schritt.`);
      return;
    }

    if (item.replacement.workSetCount === undefined) {
      problems.push(`${line}: Der Ersatz braucht "workSetCount".`);
      return;
    }

    const replacementName = item.replacement.exercise.trim();
    const exercise = context.exercisesByKey.get(normalizeImportKey(replacementName));

    if (!exercise) {
      problems.push(`${line}: Ersatzübung "${replacementName}" gibt es nicht.`);
      return;
    }

    const replacement: RestrictionReplacement = {
      exerciseId: exercise.id,
      workSetCount: item.replacement.workSetCount,
      ...pickValues(item.replacement, [...EXERCISE_VALUE_KEYS.slice(1), 'restSeconds']),
    };

    pauses.push({ ...target, replacement });
  });

  return pauses;
}

function resolveAdjustments(
  items: ImportAdjustmentInput[],
  context: ResolveContext,
  prefix: string,
  problems: string[],
  existing: RestrictionAdjustment[] | undefined,
): RestrictionAdjustment[] {
  const keys = new Map<string, number>();
  const adjustments: RestrictionAdjustment[] = [];
  const stored = storedStepNames(existing);

  items.forEach((item, index) => {
    const line = `${prefix}, Anpassung ${index + 1}`;
    const target = resolveTarget(item, context, line, problems, stored);

    if (!target || rejectDuplicateTarget(keys, target, index, 'Anpassung', line, problems)) {
      return;
    }

    const note = item.note?.trim() || undefined;
    const exerciseValues = pickValues(item, EXERCISE_VALUE_KEYS);

    if (isStepTarget(target)) {
      if (Object.keys(exerciseValues).length > 0 || item.holdProgression !== undefined) {
        problems.push(`${line}: An einem Schritt gibt es nur "seconds" und "note".`);
        return;
      }

      if (item.seconds === undefined && !note) {
        problems.push(`${line}: braucht "seconds" oder eine Notiz.`);
        return;
      }

      const adjustment: StepAdjustment = {
        ...target,
        ...(item.seconds === undefined ? {} : { seconds: item.seconds }),
        ...(note ? { note } : {}),
      };

      adjustments.push(adjustment);
      return;
    }

    if (item.seconds !== undefined) {
      problems.push(`${line}: "seconds" gibt es nur an einem Schritt.`);
      return;
    }

    if (Object.keys(exerciseValues).length === 0 && !note && item.holdProgression !== true) {
      problems.push(`${line}: braucht einen Wert, eine Notiz oder "holdProgression".`);
      return;
    }

    const adjustment: ExerciseAdjustment = {
      ...target,
      ...exerciseValues,
      ...(note ? { note } : {}),
      ...(item.holdProgression ? { holdProgression: true } : {}),
    };

    adjustments.push(adjustment);
  });

  return adjustments;
}

/** Vergleich ohne Rücksicht auf die Reihenfolge der Schlüssel. */
function sameValue(left: unknown, right: unknown) {
  const sorted = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sorted)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .filter(([, item]) => item !== undefined)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, item]) => [key, sorted(item)]),
          )
        : value;

  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
}

function describeDay(value: unknown) {
  return typeof value === 'string' ? formatRestrictionDate(value) : 'ohne Enddatum';
}

function describeTargetLines(restriction: Pick<Restriction, 'pauses' | 'adjustments'>, names: RestrictionNameLookup) {
  return [
    ...restriction.pauses.map((pause) => describePauseLine(pause, names)),
    ...restriction.adjustments.map((adjustment) => describeAdjustmentLine(adjustment, names)),
  ];
}

function describeConflictTarget(
  target: ExerciseTarget | StepTarget,
  names: RestrictionNameLookup,
): string {
  if (isStepTarget(target)) {
    return `Schritt ${target.stepName}`;
  }

  return names.exerciseName(target.exerciseId) ?? target.exerciseId;
}

/**
 * Plant den Block `restrictions` gegen den Bestand. Übungen, Workouts und
 * Zuordnungen derselben Datei zählen mit; `problems` sammelt jeden
 * Abbruchgrund mit benannter Zeile.
 */
export function planRestrictions(input: {
  restrictions: ImportRestrictionInput[];
  state: LibraryImportState;
  exercises: ExercisePlanEntry[];
  templates: TemplatePlanEntry[];
  assignments: AssignmentPlanEntry[];
  problems: string[];
}): RestrictionPlanEntry[] {
  const { state, problems } = input;
  const context = buildContext(input);
  const existingByKey = new Map(
    state.restrictions.map((item) => [normalizeImportKey(item.name), item]),
  );
  const seen = new Set<string>();
  const entries: RestrictionPlanEntry[] = [];
  /** Der Bestand nach dem Import, für die Konfliktsuche. */
  const resultById = new Map(state.restrictions.map((item) => [item.id, item]));
  const fileIds = new Set<string>();

  input.restrictions.forEach((item, index) => {
    const line = `Einschränkung ${index + 1}`;
    const name = item.name.trim();
    const key = normalizeImportKey(name);

    if (seen.has(key)) {
      problems.push(`${line}: "${name}" steht mehrfach in dieser Datei.`);
      return;
    }

    seen.add(key);

    const existing = existingByKey.get(key);
    let datesValid = true;

    for (const value of [item.from, item.until]) {
      if (typeof value === 'string' && !isValidLocalDate(value)) {
        problems.push(`${line}: "${value}" ist kein gültiges Datum (JJJJ-MM-TT).`);
        datesValid = false;
      }
    }

    if (!existing && item.from === undefined) {
      problems.push(`${line}: Eine neue Einschränkung braucht "from".`);
      datesValid = false;
    }

    const from = item.from ?? existing?.from ?? '';
    const until = item.until === undefined ? existing?.until : (item.until ?? undefined);

    if (datesValid && until !== undefined && until < from) {
      problems.push(`${line}: "until" (${until}) liegt vor "from" (${from}).`);
    }

    const pauses = item.pauses
      ? resolvePauses(item.pauses, context, line, problems, existing?.pauses)
      : undefined;
    const adjustments = item.adjustments
      ? resolveAdjustments(item.adjustments, context, line, problems, existing?.adjustments)
      : undefined;

    if (!existing && (pauses?.length ?? 0) + (adjustments?.length ?? 0) === 0) {
      if (!item.pauses?.length && !item.adjustments?.length) {
        problems.push(
          `${line}: Eine neue Einschränkung braucht mindestens eine Pause oder Anpassung.`,
        );
      }

      return;
    }

    const reason =
      item.reason === undefined ? existing?.reason : item.reason?.trim() || undefined;
    let entry: RestrictionPlanEntry;
    let result: Restriction;

    if (!existing) {
      const record: RestrictionPlanEntry['record'] = {
        name,
        ...(reason ? { reason } : {}),
        from,
        ...(until === undefined ? {} : { until }),
        pauses: pauses ?? [],
        adjustments: adjustments ?? [],
      };
      const liftedAt = item.lifted ? state.today : undefined;

      result = { ...record, id: `neu-${index}`, createdAt: '', updatedAt: '', ...(liftedAt ? { liftedAt } : {}) };
      entry = {
        kind: 'new',
        id: result.id,
        label: name,
        changes: [],
        record,
        values: {},
        liftedAt,
        targets: [],
        stateAfter: 'aktiv',
      };
    } else {
      const changes: ImportFieldChange[] = [];
      const values: Partial<Restriction> = {};

      if (diffImportField(changes, 'Name', existing.name, name)) {
        values.name = name;
      }

      if (item.reason !== undefined && diffImportField(changes, 'Grund', existing.reason, reason)) {
        values.reason = reason;
      }

      if (item.from !== undefined && diffImportField(changes, 'Von', existing.from, from, describeDay)) {
        values.from = from;
      }

      if (item.until !== undefined && diffImportField(changes, 'Bis', existing.until, until, describeDay)) {
        // `undefined` löscht das Feld über `Table.update` - gewollt: das Ende wird offen.
        values.until = until;
      }

      if (pauses && !sameValue(existing.pauses, pauses)) {
        changes.push({
          field: 'Pausen',
          from: describeTargetLines({ pauses: existing.pauses, adjustments: [] }, context.names).join(' · ') || '—',
          to: describeTargetLines({ pauses, adjustments: [] }, context.names).join(' · ') || '—',
        });
        values.pauses = pauses;
      }

      if (adjustments && !sameValue(existing.adjustments, adjustments)) {
        changes.push({
          field: 'Anpassungen',
          from: describeTargetLines({ pauses: [], adjustments: existing.adjustments }, context.names).join(' · ') || '—',
          to: describeTargetLines({ pauses: [], adjustments }, context.names).join(' · ') || '—',
        });
        values.adjustments = adjustments;
      }

      let liftedAt: string | null | undefined;
      let kind: RestrictionPlanKind = changes.length > 0 ? 'update' : 'unchanged';

      if (item.lifted === true && !existing.liftedAt) {
        liftedAt = state.today;
        kind = 'lifted';
      } else if (item.lifted === false && existing.liftedAt) {
        liftedAt = null;
        kind = 'reactivated';
      }

      result = { ...existing, ...values };

      if (liftedAt === null) {
        delete result.liftedAt;
      } else if (liftedAt !== undefined) {
        result.liftedAt = liftedAt;
      }

      if ('until' in values && values.until === undefined) {
        delete result.until;
      }

      entry = {
        kind,
        id: existing.id,
        label: name,
        changes,
        record: null,
        values,
        liftedAt,
        targets: [],
        stateAfter: 'aktiv',
      };
    }

    entry.targets = describeTargetLines(result, context.names);
    entry.stateAfter = describeRestrictionState(result, state.today);

    const fromChanged = entry.kind === 'new' || entry.values.from !== undefined;

    if (fromChanged && from < state.today && entry.stateAfter !== 'aufgehoben') {
      entry.note = `gilt ab ${formatRestrictionDay(from)}; bereits gespeicherte Einheiten ändern sich nicht – in der Historie ausnehmen`;
    }

    resultById.set(result.id, result);
    fileIds.add(result.id);
    entries.push(entry);
  });

  for (const conflict of findAdjustmentConflicts([...resultById.values()])) {
    const [left, right] = conflict.names;
    const involvesFile = [...resultById.values()].some(
      (item) => fileIds.has(item.id) && (item.name === left || item.name === right),
    );

    if (!involvesFile) {
      continue;
    }

    const target = describeConflictTarget(conflict.target, context.names);

    problems.push(
      conflict.field === 'replacement'
        ? `Einschränkungen "${left}" und "${right}" setzen beide einen Ersatz für ${target} im selben Zeitraum.`
        : `Einschränkungen "${left}" und "${right}" setzen beide "${conflict.field}" an ${target} im selben Zeitraum.`,
    );
  }

  return entries;
}

/**
 * Ein `steps`-Import, der einen Schritt verliert, den eine noch geltende
 * Einschränkung über `template` + `step` pausiert oder anpasst, bricht ab -
 * sonst wirkte die Pause still nicht mehr. Ausnahme: dieselbe Datei ändert
 * die Liste dieser Einschränkung mit. Ein Schritt ohne Vorlage gilt in allen
 * Vorlagen und wird nie geprüft.
 */
export function findLostRestrictedSteps(input: {
  state: LibraryImportState;
  templates: TemplatePlanEntry[];
  restrictionEntries: RestrictionPlanEntry[];
}): string[] {
  const changedSteps = new Map(
    input.templates
      .filter((entry) => entry.values.steps !== undefined)
      .map((entry) => [entry.id, { name: entry.label, steps: entry.values.steps as GuidedStep[] }]),
  );
  const entryById = new Map(input.restrictionEntries.map((entry) => [entry.id, entry]));
  const problems: string[] = [];

  for (const restriction of input.state.restrictions) {
    const entry = entryById.get(restriction.id);

    if (entry?.liftedAt) {
      continue;
    }

    const state = describeRestrictionState(
      { ...restriction, ...entry?.values, ...(entry?.liftedAt === null ? { liftedAt: undefined } : {}) },
      input.state.today,
    );

    if (state === 'abgelaufen' || state === 'aufgehoben') {
      continue;
    }

    const lists: [string, (ExerciseTarget | StepTarget)[]][] = [
      ['pausiert', entry?.values.pauses ?? restriction.pauses],
      ['anpasst', entry?.values.adjustments ?? restriction.adjustments],
    ];

    for (const [verb, targets] of lists) {
      for (const target of targets) {
        if (!isStepTarget(target) || target.templateId === undefined) {
          continue;
        }

        const template = changedSteps.get(target.templateId);

        if (template && !hasStep(template.steps, target.stepName)) {
          problems.push(
            `Workout "${template.name}" verliert Schritt "${target.stepName}", den Einschränkung "${restriction.name}" ${verb} – ändere die Einschränkung in derselben Datei mit.`,
          );
        }
      }
    }
  }

  return problems;
}

