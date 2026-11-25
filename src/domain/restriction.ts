import { guidedSideSeconds } from '@/domain/guided-steps';
import { normalizeImportKey } from '@/domain/import-key';
import { formatNumber } from '@/lib/format';
import type {
  Exercise,
  ExerciseAdjustment,
  ExerciseTarget,
  GuidedProtocolEntry,
  GuidedRun,
  GuidedStep,
  Restriction,
  RestrictionKind,
  RestrictionNote,
  RestrictionReplacement,
  StepAdjustment,
  StepTarget,
  WorkoutSessionExercise,
  WorkoutTemplate,
  WorkoutTemplateExercise,
} from '@/domain/models';

/*
 * Die Regeln der Einschränkungen, pur: wann eine gilt, was sie an einer Übung
 * oder an einem Schritt bewirkt und welche Art eine Session-Zeile danach hat.
 * Ausgewertet wird beim Start einer Einheit; das Ergebnis friert als Snapshot
 * an der Session ein - siehe `docs/architecture/restrictions.md`.
 */

/** Die Zielwerte einer Session-Zeile, die eine Anpassung ändern kann. */
export type AdjustableTargets = Pick<
  WorkoutSessionExercise,
  'workSetCount' | 'targetReps' | 'targetRepsMax' | 'targetSeconds' | 'targetWeight' | 'targetHeightCm'
>;

const ADJUSTABLE_FIELDS = [
  'workSetCount',
  'targetReps',
  'targetRepsMax',
  'targetSeconds',
  'targetWeight',
  'targetHeightCm',
] as const satisfies readonly (keyof AdjustableTargets)[];

export function isStepTarget(target: ExerciseTarget | StepTarget): target is StepTarget {
  return 'stepName' in target;
}

export function isRestrictionActive(restriction: Restriction, day: string): boolean {
  return (
    !restriction.liftedAt &&
    restriction.from <= day &&
    (restriction.until === undefined || day <= restriction.until)
  );
}

export function describeRestrictionState(
  restriction: Restriction,
  day: string,
): 'aktiv' | 'angekündigt' | 'abgelaufen' | 'aufgehoben' {
  if (restriction.liftedAt) {
    return 'aufgehoben';
  }

  if (day < restriction.from) {
    return 'angekündigt';
  }

  return restriction.until !== undefined && day > restriction.until ? 'abgelaufen' : 'aktiv';
}

/** Die an `day` wirksamen Einschränkungen, nach Namen sortiert - so stapeln sich Notizen stabil. */
function activeByName(restrictions: Restriction[], day: string): Restriction[] {
  return restrictions
    .filter((restriction) => isRestrictionActive(restriction, day))
    .sort((left, right) => left.name.localeCompare(right.name, 'de'));
}

/** Ohne `templateId` trifft ein Ziel jedes Workout, sonst nur sein eigenes. */
function matchesTemplate(target: { templateId?: string }, templateId: string | undefined) {
  return target.templateId === undefined || target.templateId === templateId;
}

/** Das späteste Ende; eine offene Einschränkung macht das Ende offen. */
function latestUntil(restrictions: Restriction[]): string | undefined {
  if (restrictions.some((restriction) => restriction.until === undefined)) {
    return undefined;
  }

  return restrictions.map((restriction) => restriction.until as string).sort().at(-1);
}

export interface RestrictionEffect {
  pausedBy: string[];
  pausedUntil?: string;
  replacements: { restrictionName: string; replacement: RestrictionReplacement }[];
  adjustments: { restrictionName: string; adjustment: ExerciseAdjustment }[];
}

/**
 * Was die an `day` wirksamen Einschränkungen an einer Übung bewirken - für
 * eine Zuordnung oder eine in der Session hinzugefügte Übung. Ist die Übung
 * pausiert, kommen die Anpassungen trotzdem mit: sie gelten bei „Trotzdem
 * machen“. Schrittziele treffen keine Übung, auch nicht bei gleichem Namen.
 */
export function resolveRestrictionEffect(input: {
  restrictions: Restriction[];
  day: string;
  templateId?: string;
  exerciseId: string;
}): RestrictionEffect {
  const pausing: Restriction[] = [];
  const effect: RestrictionEffect = { pausedBy: [], replacements: [], adjustments: [] };

  for (const restriction of activeByName(input.restrictions, input.day)) {
    const hits = <T extends ExerciseTarget | StepTarget>(targets: T[]) =>
      targets.filter(
        (target): target is Exclude<T, StepTarget> =>
          !isStepTarget(target) &&
          target.exerciseId === input.exerciseId &&
          matchesTemplate(target, input.templateId),
      );
    const pauses = hits(restriction.pauses);

    if (pauses.length > 0) {
      pausing.push(restriction);
      effect.pausedBy.push(restriction.name);

      for (const pause of pauses) {
        if (pause.replacement) {
          effect.replacements.push({
            restrictionName: restriction.name,
            replacement: pause.replacement,
          });
        }
      }
    }

    for (const adjustment of hits(restriction.adjustments)) {
      effect.adjustments.push({ restrictionName: restriction.name, adjustment });
    }
  }

  const pausedUntil = latestUntil(pausing);

  return pausedUntil === undefined || pausing.length === 0
    ? effect
    : { ...effect, pausedUntil };
}

export type RestrictionSnapshot = Pick<
  WorkoutSessionExercise,
  | 'pausedBy'
  | 'pausedUntil'
  | 'adjustedBy'
  | 'adjustmentNotes'
  | 'targetsBeforeAdjustment'
  | 'progressionHeld'
>;

function uniqueInOrder(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * Wendet die Anpassungen auf die Zielwerte an. `targets` sind die Werte nach
 * Zuordnung und Wochenregel; `targetsBeforeAdjustment` hält **nur** die Felder,
 * deren Wert sich dadurch tatsächlich geändert hat - eine Anpassung gleich dem
 * Wochenwert ist keine Abweichung. Setzt erst die Anpassung einen Wert, steht
 * dort `null`. Leere Felder fehlen im Snapshot ganz.
 */
export function applyRestrictionEffect(
  targets: AdjustableTargets,
  effect: RestrictionEffect,
): { targets: AdjustableTargets; snapshot: RestrictionSnapshot } {
  const adjusted: AdjustableTargets = { ...targets };
  const snapshot: RestrictionSnapshot = {};

  for (const { adjustment } of effect.adjustments) {
    for (const field of ADJUSTABLE_FIELDS) {
      const value = adjustment[field];

      if (value !== undefined) {
        adjusted[field] = value;
      }
    }
  }

  if (effect.pausedBy.length > 0) {
    snapshot.pausedBy = [...effect.pausedBy];

    if (effect.pausedUntil !== undefined) {
      snapshot.pausedUntil = effect.pausedUntil;
    }
  }

  if (effect.adjustments.length > 0) {
    snapshot.adjustedBy = uniqueInOrder(effect.adjustments.map((entry) => entry.restrictionName));
  }

  const notes: RestrictionNote[] = effect.adjustments.flatMap(({ restrictionName, adjustment }) =>
    adjustment.note ? [{ by: restrictionName, note: adjustment.note }] : [],
  );

  if (notes.length > 0) {
    snapshot.adjustmentNotes = notes;
  }

  const before: NonNullable<RestrictionSnapshot['targetsBeforeAdjustment']> = {};

  for (const field of ADJUSTABLE_FIELDS) {
    if (adjusted[field] !== targets[field]) {
      before[field] = targets[field] ?? null;
    }
  }

  if (Object.keys(before).length > 0) {
    snapshot.targetsBeforeAdjustment = before;
  }

  if (effect.adjustments.some(({ adjustment }) => adjustment.holdProgression)) {
    snapshot.progressionHeld = true;
  }

  return { targets: adjusted, snapshot };
}

/**
 * Teilt die Schritte einer geführten Vorlage in abgespielte und pausierte und
 * setzt die angepassten Sekunden. Pause schlägt Anpassung. Schritte werden
 * über den Namen getroffen (`normalizeImportKey`); ein Ziel ohne `templateId`
 * trifft den Namen in jeder Vorlage.
 */
export function resolveGuidedSteps(input: {
  restrictions: Restriction[];
  day: string;
  templateId: string;
  steps: readonly GuidedStep[];
}): {
  steps: GuidedStep[];
  pausedSteps: NonNullable<GuidedRun['pausedSteps']>;
  adjustedSteps: NonNullable<GuidedRun['adjustedSteps']>;
} {
  const active = activeByName(input.restrictions, input.day);
  const steps: GuidedStep[] = [];
  const pausedSteps: NonNullable<GuidedRun['pausedSteps']> = [];
  const adjustedSteps: NonNullable<GuidedRun['adjustedSteps']> = [];

  input.steps.forEach((step, index) => {
    const key = normalizeImportKey(step.name);
    const hits = (target: ExerciseTarget | StepTarget) =>
      isStepTarget(target) &&
      normalizeImportKey(target.stepName) === key &&
      matchesTemplate(target, input.templateId);
    const pausing = active.filter((restriction) => restriction.pauses.some(hits));

    if (pausing.length > 0) {
      const pausedUntil = latestUntil(pausing);

      pausedSteps.push({
        index,
        step,
        pausedBy: pausing.map((restriction) => restriction.name),
        ...(pausedUntil === undefined ? {} : { pausedUntil }),
      });
      return;
    }

    const adjustments = active.flatMap((restriction) =>
      restriction.adjustments
        .filter((adjustment): adjustment is StepAdjustment => hits(adjustment))
        .map((adjustment) => ({ restrictionName: restriction.name, adjustment })),
    );

    if (adjustments.length === 0) {
      steps.push(step);
      return;
    }

    let seconds = step.seconds;

    for (const { adjustment } of adjustments) {
      if (adjustment.seconds !== undefined) {
        seconds = adjustment.seconds;
      }
    }

    const notes = adjustments.flatMap(({ restrictionName, adjustment }) =>
      adjustment.note ? [{ by: restrictionName, note: adjustment.note }] : [],
    );

    adjustedSteps.push({
      index: steps.length,
      adjustedBy: uniqueInOrder(adjustments.map((entry) => entry.restrictionName)),
      ...(seconds === step.seconds ? {} : { secondsBefore: step.seconds }),
      ...(notes.length > 0 ? { notes } : {}),
    });
    steps.push(seconds === step.seconds ? step : { ...step, seconds });
  });

  return { steps, pausedSteps, adjustedSteps };
}

/**
 * Das Protokoll einer geführten Einheit mit ihren Einschränkungen: `stepIndex`
 * zählt danach in der Vorlage, nicht in den abgespielten Schritten, damit
 * `schritt_nr` im Export stabil bleibt. Jeder pausierte Schritt bekommt an
 * seinem Platz eine Zeile `paused` (je Seite bei einem beidseitigen), auch
 * nach einem Abbruch - die Pause stand beim Start fest. Pausierte und
 * angepasste Zeilen tragen `restrictedBy`. `guided-run.ts` bleibt unberührt.
 */
export function withRestrictionProtocol(
  protocol: readonly GuidedProtocolEntry[],
  run: GuidedRun,
): GuidedProtocolEntry[] {
  const pausedSteps = run.pausedSteps ?? [];
  const adjustedSteps = run.adjustedSteps ?? [];
  const templateIndexes = findTemplateIndexes(run);
  const played = protocol.map((entry): GuidedProtocolEntry => {
    const adjusted = adjustedSteps.find((step) => step.index === entry.stepIndex);

    return {
      ...entry,
      stepIndex: templateIndexes[entry.stepIndex] ?? entry.stepIndex,
      ...(adjusted ? { restrictedBy: adjusted.adjustedBy } : {}),
    };
  });
  const paused = pausedSteps.flatMap(({ index, step, pausedBy }) =>
    (step.bothSides ? (['left', 'right'] as const) : [undefined]).map(
      (side): GuidedProtocolEntry => ({
        stepIndex: index,
        name: step.name,
        ...(side ? { side } : {}),
        status: 'paused',
        plannedSeconds: guidedSideSeconds(step),
        actualSeconds: 0,
        restrictedBy: pausedBy,
      }),
    ),
  );

  // Stabil sortiert: links vor rechts, abgespielte Zeilen in ihrer Reihenfolge.
  return [...played, ...paused].sort((left, right) => left.stepIndex - right.stepIndex);
}

/** Die Vorlagen-Position je abgespieltem Schritt: die Lücken sind die pausierten. */
function findTemplateIndexes(run: Pick<GuidedRun, 'steps' | 'pausedSteps'>): number[] {
  const pausedIndexes = new Set((run.pausedSteps ?? []).map((paused) => paused.index));
  const templateIndexes: number[] = [];

  for (let index = 0; templateIndexes.length < run.steps.length; index += 1) {
    if (!pausedIndexes.has(index)) {
      templateIndexes.push(index);
    }
  }

  return templateIndexes;
}

/** Was eine Einschränkung an einem Schritt einer geführten Vorlage bewirkt. */
export interface GuidedStepRestriction {
  kind: 'pausiert' | 'angepasst';
  /** „Pausiert bis 14.12. · Beispiel A“, „30 s statt 45 · Beispiel A“, „Hinweis · Beispiel A“. */
  label: string;
  notes: string[];
}

/**
 * Die Etiketten der Schritte für den Start-Screen, je Position in der
 * **Vorlage**. Schritte ohne Einschränkung fehlen. Geänderte Sekunden stehen
 * als „statt“, eine Anpassung nur mit Notiz heißt „Hinweis“.
 */
export function describeGuidedStepRestrictions(
  run: Pick<GuidedRun, 'steps' | 'pausedSteps' | 'adjustedSteps'>,
): Map<number, GuidedStepRestriction> {
  const view = new Map<number, GuidedStepRestriction>();
  const templateIndexes = findTemplateIndexes(run);

  for (const { index, pausedBy, pausedUntil } of run.pausedSteps ?? []) {
    view.set(index, {
      kind: 'pausiert',
      label: pausedUntil
        ? `Pausiert bis ${formatRestrictionDay(pausedUntil)} · ${pausedBy.join(', ')}`
        : `Pausiert · ${pausedBy.join(', ')}`,
      notes: [],
    });
  }

  for (const { index, adjustedBy, secondsBefore, notes } of run.adjustedSteps ?? []) {
    const step = run.steps[index];
    const change =
      secondsBefore === undefined || !step
        ? 'Hinweis'
        : `${formatNumber(step.seconds)} s statt ${formatNumber(secondsBefore)}`;

    view.set(templateIndexes[index], {
      kind: 'angepasst',
      label: `${change} · ${adjustedBy.join(', ')}`,
      notes: (notes ?? []).map((note) => note.note),
    });
  }

  return view;
}

export interface RestrictionConflict {
  names: [string, string];
  target: ExerciseTarget | StepTarget;
  field: keyof AdjustableTargets | 'seconds' | 'replacement';
}

function periodsOverlap(left: Restriction, right: Restriction): boolean {
  return (
    (right.until === undefined || left.from <= right.until) &&
    (left.until === undefined || right.from <= left.until)
  );
}

/** Zwei Ziele überschneiden sich: dasselbe Ding, und eins gilt überall oder beide im selben Workout. */
function targetsOverlap(left: ExerciseTarget | StepTarget, right: ExerciseTarget | StepTarget) {
  const sameScope =
    left.templateId === undefined ||
    right.templateId === undefined ||
    left.templateId === right.templateId;

  if (isStepTarget(left) || isStepTarget(right)) {
    return (
      isStepTarget(left) &&
      isStepTarget(right) &&
      sameScope &&
      normalizeImportKey(left.stepName) === normalizeImportKey(right.stepName)
    );
  }

  return sameScope && left.exerciseId === right.exerciseId;
}

/** Das Ziel ohne die Werte - so steht es in einer Konfliktmeldung. */
function bareTarget(target: ExerciseTarget | StepTarget): ExerciseTarget | StepTarget {
  const scope = target.templateId === undefined ? {} : { templateId: target.templateId };

  return isStepTarget(target)
    ? { stepName: target.stepName, ...scope }
    : { exerciseId: target.exerciseId, ...scope };
}

/** Ein Wert einer Anpassung; ein Feld, das die Zielform nicht kennt, fehlt. */
function adjustmentValue(
  adjustment: ExerciseAdjustment | StepAdjustment,
  field: RestrictionConflict['field'],
): unknown {
  return field in adjustment ? (adjustment as unknown as Record<string, unknown>)[field] : undefined;
}

/**
 * Zwei nicht aufgehobene Einschränkungen mit sich überschneidendem Zeitraum,
 * die am selben Ziel **denselben Wert** setzen, oder zwei Ersatzübungen für
 * dieselbe Übung. Notizen und `holdProgression` stapeln sich und sind kein
 * Konflikt. Grundlage des Import-Abbruchs: eine erfundene Regel „der kleinere
 * Wert gewinnt“ sähe niemand.
 */
export function findAdjustmentConflicts(restrictions: Restriction[]): RestrictionConflict[] {
  const live = restrictions.filter((restriction) => !restriction.liftedAt);
  const conflicts: RestrictionConflict[] = [];

  for (let i = 0; i < live.length; i += 1) {
    for (let j = i + 1; j < live.length; j += 1) {
      const left = live[i];
      const right = live[j];

      if (!periodsOverlap(left, right)) {
        continue;
      }

      const names: [string, string] = [left.name, right.name];

      for (const a of left.adjustments) {
        for (const b of right.adjustments) {
          if (!targetsOverlap(a, b)) {
            continue;
          }

          const fields: RestrictionConflict['field'][] = isStepTarget(a)
            ? ['seconds']
            : [...ADJUSTABLE_FIELDS];

          for (const field of fields) {
            const valueA = adjustmentValue(a, field);
            const valueB = adjustmentValue(b, field);

            if (valueA !== undefined && valueB !== undefined) {
              conflicts.push({ names, target: bareTarget(a), field });
            }
          }
        }
      }

      for (const a of left.pauses) {
        for (const b of right.pauses) {
          if (
            !isStepTarget(a) &&
            !isStepTarget(b) &&
            a.replacement &&
            b.replacement &&
            targetsOverlap(a, b)
          ) {
            conflicts.push({ names, target: bareTarget(a), field: 'replacement' });
          }
        }
      }
    }
  }

  return conflicts;
}

/** Pausiert und nicht per „Trotzdem machen“ freigegeben. */
export function isPausedSessionExercise(row: WorkoutSessionExercise): boolean {
  return (row.pausedBy?.length ?? 0) > 0 && !row.pauseOverriddenAt;
}

/** Wird beim Durchgehen übersprungen: echt ausgelassen oder pausiert. */
export function isInactiveSessionExercise(row: WorkoutSessionExercise): boolean {
  return row.wasSkipped || isPausedSessionExercise(row);
}

/** Die Felder einer Session-Zeile, aus denen ihre Art folgt. */
export type RestrictionKindFields = Pick<
  WorkoutSessionExercise,
  | 'pausedBy'
  | 'pauseOverriddenAt'
  | 'targetsBeforeAdjustment'
  | 'excludedFromProgressAt'
  | 'replacementFor'
  | 'progressionHeld'
  | 'adjustmentNotes'
>;

/**
 * Die Art einer Session-Zeile; die erste zutreffende gilt:
 * `pausiert` > `trotzdem` > `angepasst` > `ausgenommen` > `ersatz` > `gehalten` > `hinweis`.
 */
export function sessionRestrictionKind(row: RestrictionKindFields): RestrictionKind | undefined {
  if ((row.pausedBy?.length ?? 0) > 0) {
    return row.pauseOverriddenAt ? 'trotzdem' : 'pausiert';
  }

  if (row.targetsBeforeAdjustment && Object.keys(row.targetsBeforeAdjustment).length > 0) {
    return 'angepasst';
  }

  if (row.excludedFromProgressAt) {
    return 'ausgenommen';
  }

  if (row.replacementFor) {
    return 'ersatz';
  }

  if (row.progressionHeld) {
    return 'gehalten';
  }

  return (row.adjustmentNotes?.length ?? 0) > 0 ? 'hinweis' : undefined;
}

/**
 * Zählt nicht als letzte Werte und nicht für den Steigerungshinweis:
 * `trotzdem`, `angepasst`, `ausgenommen`. Die einzige Stelle, die das entscheidet.
 */
export function isRestrictedExecution(row: RestrictionKindFields): boolean {
  const kind = sessionRestrictionKind(row);

  return kind === 'trotzdem' || kind === 'angepasst' || kind === 'ausgenommen';
}

/**
 * Kein Steigerungshinweis in der laufenden Einheit: `trotzdem`, `angepasst`
 * und `gehalten`. Gefragt wird `progressionHeld` direkt, nicht nur die Art -
 * ein gehaltener Ersatz hat die Art `ersatz` und bekommt trotzdem keinen.
 */
export function suppressesProgressionHint(row: RestrictionKindFields): boolean {
  const kind = sessionRestrictionKind(row);

  return kind === 'trotzdem' || kind === 'angepasst' || row.progressionHeld === true;
}

/** `2026-12-14` → `14.12.`, für Etiketten und Hinweise. */
export function formatRestrictionDay(day: string): string {
  const [, month, date] = day.split('-');

  return `${date}.${month}.`;
}

/** `2026-12-14` → `14.12.2026`, für die Vorschau „alt → neu“. */
export function formatRestrictionDate(day: string): string {
  const [year] = day.split('-');

  return `${formatRestrictionDay(day)}${year}`;
}

/** Wie Ziele in Klarnamen heißen; fehlt ein Name, gibt es das Ding nicht mehr. */
export interface RestrictionNameLookup {
  exerciseName: (id: string) => string | undefined;
  templateName: (id: string) => string | undefined;
}

type TargetValues = Partial<AdjustableTargets> & { restSeconds?: number };

/** `3 Sätze, 8–10 Wdh., 40 kg` - die gesetzten Werte, in fester Reihenfolge. */
export function describeTargetValues(values: TargetValues): string[] {
  const parts: string[] = [];

  if (values.workSetCount !== undefined) {
    parts.push(`${formatNumber(values.workSetCount)} ${values.workSetCount === 1 ? 'Satz' : 'Sätze'}`);
  }

  if (values.targetReps !== undefined) {
    parts.push(
      values.targetRepsMax !== undefined
        ? `${formatNumber(values.targetReps)}–${formatNumber(values.targetRepsMax)} Wdh.`
        : `${formatNumber(values.targetReps)} Wdh.`,
    );
  } else if (values.targetRepsMax !== undefined) {
    parts.push(`bis ${formatNumber(values.targetRepsMax)} Wdh.`);
  }

  if (values.targetSeconds !== undefined) {
    parts.push(`${formatNumber(values.targetSeconds)} s`);
  }

  if (values.targetWeight !== undefined) {
    parts.push(`${formatNumber(values.targetWeight)} kg`);
  }

  if (values.targetHeightCm !== undefined) {
    parts.push(`${formatNumber(values.targetHeightCm)} cm`);
  }

  if (values.restSeconds !== undefined) {
    parts.push(`Pause ${formatNumber(values.restSeconds)} s`);
  }

  return parts;
}

const UNKNOWN_NAME = '(gibt es nicht mehr)';

/** `Kniebeuge (LH) in Einheit B` bzw. `Schritt Taubenpose in allen geführten Vorlagen`. */
export function describeRestrictionTarget(
  target: ExerciseTarget | StepTarget,
  names: RestrictionNameLookup,
): string {
  const template =
    target.templateId === undefined
      ? undefined
      : (names.templateName(target.templateId) ?? UNKNOWN_NAME);

  if (isStepTarget(target)) {
    return `Schritt ${target.stepName} in ${template ?? 'allen geführten Vorlagen'}`;
  }

  const exercise = names.exerciseName(target.exerciseId) ?? UNKNOWN_NAME;

  return template === undefined ? exercise : `${exercise} in ${template}`;
}

/** `Pause: Sprungkniebeuge → Ersatz Step-up, 3 Sätze, 8 Wdh.` */
export function describePauseLine(
  pause: Restriction['pauses'][number],
  names: RestrictionNameLookup,
): string {
  const line = `Pause: ${describeRestrictionTarget(pause, names)}`;

  if (isStepTarget(pause) || !pause.replacement) {
    return line;
  }

  const { exerciseId, ...values } = pause.replacement;
  const replacement = names.exerciseName(exerciseId) ?? UNKNOWN_NAME;

  return `${line} → ${[`Ersatz ${replacement}`, ...describeTargetValues(values)].join(', ')}`;
}

/** `Anpassung: Kniebeuge (LH) – 40 kg, Notiz „nur bis Parallel“` */
export function describeAdjustmentLine(
  adjustment: Restriction['adjustments'][number],
  names: RestrictionNameLookup,
): string {
  const parts = isStepTarget(adjustment)
    ? adjustment.seconds === undefined
      ? []
      : [`${formatNumber(adjustment.seconds)} s`]
    : [
        ...describeTargetValues(adjustment),
        ...(adjustment.holdProgression ? ['Steigerung gehalten'] : []),
      ];

  if (adjustment.note) {
    parts.push(`Notiz „${adjustment.note}“`);
  }

  return `Anpassung: ${describeRestrictionTarget(adjustment, names)} – ${parts.join(', ')}`;
}

/**
 * Das Etikett unter dem Namen einer Session-Zeile, in Liste, Fokus-Sheet und
 * Historie. Angepasste Werte und Notizen stehen nicht hier, sondern als eigene
 * Zeilen (`describeAdjustedTargets`, `adjustmentNotes`). `originalName` ist
 * beim Ersatz der Name der pausierten Übung.
 */
export function describeRestrictionLabel(
  row: RestrictionKindFields & Pick<WorkoutSessionExercise, 'pausedUntil' | 'adjustedBy'>,
  originalName?: string,
): string | undefined {
  const names = (list: string[] | undefined) => (list ?? []).join(', ');

  switch (sessionRestrictionKind(row)) {
    case 'pausiert':
      return row.pausedUntil
        ? `Pausiert bis ${formatRestrictionDay(row.pausedUntil)} · ${names(row.pausedBy)}`
        : `Pausiert · ${names(row.pausedBy)}`;
    case 'trotzdem':
      return `Trotzdem · ${names(row.pausedBy)}`;
    case 'ausgenommen':
      return 'Nicht als Leistungsstand';
    case 'ersatz':
      return `Ersatz für ${originalName ?? 'eine pausierte Übung'} · ${row.replacementFor?.restrictionName}`;
    case 'gehalten':
      return `Steigerung gehalten · ${names(row.adjustedBy)}`;
    case 'angepasst':
      // Die „statt“-Zeile sagt schon, dass angepasst wurde.
      return row.excludedFromProgressAt ? 'Nicht als Leistungsstand' : undefined;
    default:
      return undefined;
  }
}

const ADJUSTED_FIELD_LABELS: Record<(typeof ADJUSTABLE_FIELDS)[number], (value: number) => string> = {
  workSetCount: (value) => `${formatNumber(value)} ${value === 1 ? 'Satz' : 'Sätze'}`,
  targetReps: (value) => `${formatNumber(value)} Wdh.`,
  targetRepsMax: (value) => `bis ${formatNumber(value)} Wdh.`,
  targetSeconds: (value) => `${formatNumber(value)} s`,
  targetWeight: (value) => `${formatNumber(value)} kg`,
  targetHeightCm: (value) => `${formatNumber(value)} cm`,
};

/**
 * `40 kg statt 45 · Beispiel A` - nur die Werte, die die Anpassung
 * tatsächlich geändert hat. Hatte der Plan keinen Wert, steht er ohne „statt“.
 * Ohne echte Abweichung `undefined`: eine Anpassung nur mit Notiz zeigt nur
 * die Notiz.
 */
export function describeAdjustedTargets(
  row: Pick<WorkoutSessionExercise, 'targetsBeforeAdjustment' | 'adjustedBy'> & AdjustableTargets,
): string | undefined {
  const before = row.targetsBeforeAdjustment ?? {};
  const parts = ADJUSTABLE_FIELDS.flatMap((field) => {
    const previous = before[field];
    const current = row[field];

    if (previous === undefined || current === undefined) {
      return [];
    }

    const label = ADJUSTED_FIELD_LABELS[field];

    return previous === null
      ? [label(current)]
      : [`${label(current)} statt ${formatNumber(previous)}`];
  });

  return parts.length > 0 ? `${parts.join(', ')} · ${(row.adjustedBy ?? []).join(', ')}` : undefined;
}

export type RestrictionTargetStatus = 'ok' | 'gibt es nicht mehr' | 'trifft derzeit nichts';

/** Was es in der Bibliothek gibt - für Klarnamen und tote Ziele. */
export interface RestrictionTargetLookup {
  exercises: Pick<Exercise, 'id' | 'name'>[];
  templates: Pick<WorkoutTemplate, 'id' | 'name' | 'steps'>[];
  templateExercises: Pick<WorkoutTemplateExercise, 'templateId' | 'exerciseId'>[];
}

/**
 * Die Ziele einer Einschränkung in Klarnamen, für ihr Sheet: erst die Pausen
 * (mit Ersatz), dann die Anpassungen (mit Werten). Ein Ziel, dessen Übung,
 * Workout, Zuordnung oder Schritt es nicht mehr gibt, ist „gibt es nicht
 * mehr“; ein Ziel ohne Workout, das derzeit nirgends vorkommt, „trifft
 * derzeit nichts“. Beide trifft beim Start nichts, gelöscht wird nichts.
 */
export function describeRestrictionTargets(
  restriction: Pick<Restriction, 'pauses' | 'adjustments'>,
  lookup: RestrictionTargetLookup,
): { label: string; status: RestrictionTargetStatus }[] {
  const exercises = new Map(lookup.exercises.map((exercise) => [exercise.id, exercise.name]));
  const templates = new Map(lookup.templates.map((template) => [template.id, template]));
  const names: RestrictionNameLookup = {
    exerciseName: (id) => exercises.get(id),
    templateName: (id) => templates.get(id)?.name,
  };
  const hasStep = (template: Pick<WorkoutTemplate, 'steps'>, stepName: string) =>
    (template.steps ?? []).some(
      (step) => normalizeImportKey(step.name) === normalizeImportKey(stepName),
    );

  const statusOf = (target: ExerciseTarget | StepTarget): RestrictionTargetStatus => {
    if (isStepTarget(target)) {
      if (target.templateId === undefined) {
        return lookup.templates.some((template) => hasStep(template, target.stepName))
          ? 'ok'
          : 'trifft derzeit nichts';
      }

      const template = templates.get(target.templateId);

      return template && hasStep(template, target.stepName) ? 'ok' : 'gibt es nicht mehr';
    }

    if (!exercises.has(target.exerciseId)) {
      return 'gibt es nicht mehr';
    }

    const assigned = lookup.templateExercises.some(
      (item) =>
        item.exerciseId === target.exerciseId &&
        (target.templateId === undefined || item.templateId === target.templateId),
    );

    if (target.templateId === undefined) {
      return assigned ? 'ok' : 'trifft derzeit nichts';
    }

    return templates.has(target.templateId) && assigned ? 'ok' : 'gibt es nicht mehr';
  };

  return [
    ...restriction.pauses.map((pause) => ({
      label: describePauseLine(pause, names),
      status: statusOf(pause),
    })),
    ...restriction.adjustments.map((adjustment) => ({
      label: describeAdjustmentLine(adjustment, names),
      status: statusOf(adjustment),
    })),
  ];
}

/**
 * Wie viele Übungen eines Workouts an `day` pausiert und wie viele
 * tatsächlich angepasst sind. `targets` sind die Werte nach Zuordnung und
 * Wochenregel; eine Anpassung gleich dem Wochenwert, eine reine Notiz und
 * „Steigerung gehalten“ zählen nicht als angepasst.
 */
export function countRestrictionEffects(input: {
  restrictions: Restriction[];
  day: string;
  templateId: string;
  targetsByTemplateExerciseId: Record<string, { exerciseId: string; targets: AdjustableTargets }>;
}): { paused: number; adjusted: number } {
  let paused = 0;
  let adjusted = 0;

  for (const { exerciseId, targets } of Object.values(input.targetsByTemplateExerciseId)) {
    const effect = resolveRestrictionEffect({
      restrictions: input.restrictions,
      day: input.day,
      templateId: input.templateId,
      exerciseId,
    });

    if (effect.pausedBy.length > 0) {
      paused += 1;
    } else if (applyRestrictionEffect(targets, effect).snapshot.targetsBeforeAdjustment) {
      adjusted += 1;
    }
  }

  return { paused, adjusted };
}

/** `1 Übung pausiert · 1 angepasst`, `2 Schritte angepasst`; ohne beides `undefined`. */
export function describeRestrictionCounts(
  counts: { paused: number; adjusted: number },
  unit: 'exercise' | 'step',
): string | undefined {
  const noun = (count: number) =>
    unit === 'exercise' ? (count === 1 ? 'Übung' : 'Übungen') : count === 1 ? 'Schritt' : 'Schritte';

  if (counts.paused > 0) {
    const pausedText = `${formatNumber(counts.paused)} ${noun(counts.paused)} pausiert`;

    return counts.adjusted > 0
      ? `${pausedText} · ${formatNumber(counts.adjusted)} angepasst`
      : pausedText;
  }

  return counts.adjusted > 0
    ? `${formatNumber(counts.adjusted)} ${noun(counts.adjusted)} angepasst`
    : undefined;
}

/** `bis 14.12.`, `ab 01.12.` (angekündigt) oder `ohne Enddatum`, für die Karte. */
export function describeRestrictionPeriod(
  restriction: Pick<Restriction, 'from' | 'until'>,
  day: string,
): string {
  if (day < restriction.from) {
    return `ab ${formatRestrictionDay(restriction.from)}`;
  }

  return restriction.until === undefined
    ? 'ohne Enddatum'
    : `bis ${formatRestrictionDay(restriction.until)}`;
}

/** Was eine Einschränkung heute an einer Übung eines Workouts bewirken würde. */
export interface PlannedRestriction {
  kind: 'pausiert' | 'angepasst' | 'gehalten' | 'hinweis';
  label: string;
  notes: string[];
}

/**
 * Das Etikett einer Übung auf der Workout-Seite, für heute: „Pausiert bis
 * 14.12. · Ersatz: Step-up · Beispiel A“, „Angepasst: 40 kg statt 45 · …“,
 * „Steigerung gehalten · …“ oder „Hinweis · …“, dazu die Notizen. Ohne
 * Wirkung `undefined`.
 */
export function describePlannedRestriction(input: {
  effect: RestrictionEffect;
  targets: AdjustableTargets;
  exerciseName: (id: string) => string | undefined;
}): PlannedRestriction | undefined {
  const { effect } = input;

  if (effect.pausedBy.length > 0) {
    const parts = [
      effect.pausedUntil ? `Pausiert bis ${formatRestrictionDay(effect.pausedUntil)}` : 'Pausiert',
      ...(effect.replacements.length > 0
        ? [
            `Ersatz: ${effect.replacements
              .map(({ replacement }) => input.exerciseName(replacement.exerciseId) ?? UNKNOWN_NAME)
              .join(', ')}`,
          ]
        : []),
      effect.pausedBy.join(', '),
    ];

    return { kind: 'pausiert', label: parts.join(' · '), notes: [] };
  }

  if (effect.adjustments.length === 0) {
    return undefined;
  }

  const { targets, snapshot } = applyRestrictionEffect(input.targets, effect);
  const notes = (snapshot.adjustmentNotes ?? []).map((note) => note.note);
  const by = (snapshot.adjustedBy ?? []).join(', ');
  const changed = describeAdjustedTargets({ ...targets, ...snapshot });

  if (changed) {
    return { kind: 'angepasst', label: `Angepasst: ${changed}`, notes };
  }

  return snapshot.progressionHeld
    ? { kind: 'gehalten', label: `Steigerung gehalten · ${by}`, notes }
    : { kind: 'hinweis', label: `Hinweis · ${by}`, notes };
}
