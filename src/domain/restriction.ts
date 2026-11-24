import { normalizeImportKey } from '@/domain/import-key';
import { formatNumber } from '@/lib/format';
import type {
  ExerciseAdjustment,
  ExerciseTarget,
  GuidedRun,
  GuidedStep,
  Restriction,
  RestrictionKind,
  RestrictionNote,
  RestrictionReplacement,
  StepAdjustment,
  StepTarget,
  WorkoutSessionExercise,
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
 * Wochenwert ist keine Abweichung. Leere Felder fehlen im Snapshot ganz.
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
    if (adjusted[field] !== targets[field] && targets[field] !== undefined) {
      before[field] = targets[field];
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

/**
 * Die Art einer Session-Zeile; die erste zutreffende gilt:
 * `pausiert` > `trotzdem` > `angepasst` > `ausgenommen` > `ersatz` > `gehalten` > `hinweis`.
 */
export function sessionRestrictionKind(row: WorkoutSessionExercise): RestrictionKind | undefined {
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
export function isRestrictedExecution(row: WorkoutSessionExercise): boolean {
  const kind = sessionRestrictionKind(row);

  return kind === 'trotzdem' || kind === 'angepasst' || kind === 'ausgenommen';
}

/**
 * Kein Steigerungshinweis in der laufenden Einheit: `trotzdem`, `angepasst`
 * und `gehalten`. Gefragt wird `progressionHeld` direkt, nicht nur die Art -
 * ein gehaltener Ersatz hat die Art `ersatz` und bekommt trotzdem keinen.
 */
export function suppressesProgressionHint(row: WorkoutSessionExercise): boolean {
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
