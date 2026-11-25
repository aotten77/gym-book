import { db } from '@/db/appDb';
import { loadRestrictions } from '@/db/restriction-actions';
import { resolveSessionWeekContext } from '@/db/session-actions';
import { isGuidedTemplate } from '@/domain/guided-steps';
import type { Restriction, WorkoutTemplateExercise } from '@/domain/models';
import { toDateInputValue } from '@/domain/program';
import { foldProgressionRule } from '@/domain/progression-fold';
import {
  countRestrictionEffects,
  describeGuidedStepRestrictions,
  describePlannedRestriction,
  describeRestrictionCounts,
  describeRestrictionPeriod,
  describeRestrictionState,
  describeRestrictionTargets,
  resolveGuidedSteps,
  resolveRestrictionEffect,
  type AdjustableTargets,
  type GuidedStepRestriction,
  type PlannedRestriction,
  type RestrictionTargetStatus,
} from '@/domain/restriction';

/*
 * Leseseite der Einschränkungen außerhalb der Einheit: Plan-Karte,
 * Workout-Seite und Jetzt-Sheet. Gerechnet wird wie beim Start - Zuordnung,
 * Wochenregel der aktuellen Woche, dann die Einschränkungen von heute -,
 * damit hier nie etwas anderes steht, als der Start schreibt.
 */

/** Die Zielwerte einer Zuordnung nach Wochenregel, wie `materializeSession` sie faltet. */
async function loadWeekTargets(): Promise<(item: WorkoutTemplateExercise) => AdjustableTargets> {
  const { programWeek } = await resolveSessionWeekContext();
  const rules = programWeek
    ? await db.progressionRules.where('programWeekId').equals(programWeek.id).toArray()
    : [];
  const ruleByTemplateExerciseId = new Map(rules.map((rule) => [rule.templateExerciseId, rule]));

  return (item) => foldProgressionRule(item, ruleByTemplateExerciseId.get(item.id));
}

/**
 * Je Workout die Zeile für das Jetzt-Sheet („1 Übung pausiert · 1
 * angepasst“, „1 Schritt angepasst“), für den Tag von `now`. Workouts ohne
 * Wirkung fehlen.
 */
export async function loadRestrictionSummaries(now: Date = new Date()): Promise<Record<string, string>> {
  const restrictions = await loadRestrictions();
  const day = toDateInputValue(now);

  if (!restrictions.some((restriction) => describeRestrictionState(restriction, day) === 'aktiv')) {
    return {};
  }

  const [templates, templateExercises] = await Promise.all([
    db.workoutTemplates.toArray(),
    db.workoutTemplateExercises.toArray(),
  ]);
  const targetsOf = await loadWeekTargets();
  const summaries: Record<string, string> = {};

  for (const template of templates) {
    let summary: string | undefined;

    if (isGuidedTemplate(template)) {
      const resolved = resolveGuidedSteps({
        restrictions,
        day,
        templateId: template.id,
        steps: template.steps ?? [],
      });

      summary = describeRestrictionCounts(
        {
          paused: resolved.pausedSteps.length,
          adjusted: resolved.adjustedSteps.filter((step) => step.secondsBefore !== undefined).length,
        },
        'step',
      );
    } else {
      const items = templateExercises.filter((item) => item.templateId === template.id);

      summary = describeRestrictionCounts(
        countRestrictionEffects({
          restrictions,
          day,
          templateId: template.id,
          targetsByTemplateExerciseId: Object.fromEntries(
            items.map((item) => [
              item.id,
              { exerciseId: item.exerciseId, targets: targetsOf(item) },
            ]),
          ),
        }),
        'exercise',
      );
    }

    if (summary) {
      summaries[template.id] = summary;
    }
  }

  return summaries;
}

export interface TemplateRestrictionView {
  /** Je Zuordnung (`WorkoutTemplateExercise.id`) das Etikett für heute. */
  exercises: Record<string, PlannedRestriction>;
  /** Je Schritt-Position der geführten Vorlage das Etikett für heute. */
  steps: Map<number, GuidedStepRestriction>;
}

/** Die Etiketten der Workout-Seite: was die Einschränkungen heute an diesem Workout bewirken. */
export async function loadTemplateRestrictionView(
  templateId: string,
  now: Date = new Date(),
): Promise<TemplateRestrictionView> {
  const restrictions = await loadRestrictions();
  const day = toDateInputValue(now);
  const template = await db.workoutTemplates.get(templateId);

  if (!template || restrictions.length === 0) {
    return { exercises: {}, steps: new Map() };
  }

  if (isGuidedTemplate(template)) {
    return {
      exercises: {},
      steps: describeGuidedStepRestrictions(
        resolveGuidedSteps({ restrictions, day, templateId, steps: template.steps ?? [] }),
      ),
    };
  }

  const items = await db.workoutTemplateExercises.where('templateId').equals(templateId).toArray();
  const targetsOf = await loadWeekTargets();
  const exerciseNames = new Map((await db.exercises.toArray()).map((exercise) => [exercise.id, exercise.name]));
  const exercises: Record<string, PlannedRestriction> = {};

  for (const item of items) {
    const planned = describePlannedRestriction({
      effect: resolveRestrictionEffect({ restrictions, day, templateId, exerciseId: item.exerciseId }),
      targets: targetsOf(item),
      exerciseName: (id) => exerciseNames.get(id),
    });

    if (planned) {
      exercises[item.id] = planned;
    }
  }

  return { exercises, steps: new Map() };
}

export interface RestrictionCard {
  restriction: Restriction;
  state: 'aktiv' | 'angekündigt';
  /** `bis 14.12.`, `ab 01.12.` oder `ohne Enddatum`. */
  period: string;
  targets: { label: string; status: RestrictionTargetStatus }[];
  /** Nur Ziele, die es gibt und die etwas treffen. */
  liveTargetCount: number;
}

/**
 * Die Karte „Einschränkungen“ auf der Plan-Seite: aktive und angekündigte,
 * nach Beginn und Name. Aufgehobene und abgelaufene fehlen.
 */
export async function loadRestrictionCards(now: Date = new Date()): Promise<RestrictionCard[]> {
  const day = toDateInputValue(now);
  const shown = (await loadRestrictions()).filter((restriction) => {
    const state = describeRestrictionState(restriction, day);

    return state === 'aktiv' || state === 'angekündigt';
  });

  if (shown.length === 0) {
    return [];
  }

  const [exercises, templates, templateExercises] = await Promise.all([
    db.exercises.toArray(),
    db.workoutTemplates.toArray(),
    db.workoutTemplateExercises.toArray(),
  ]);

  return shown
    .sort(
      (left, right) =>
        left.from.localeCompare(right.from) || left.name.localeCompare(right.name, 'de'),
    )
    .map((restriction) => {
      const targets = describeRestrictionTargets(restriction, { exercises, templates, templateExercises });

      return {
        restriction,
        state: describeRestrictionState(restriction, day) === 'aktiv' ? 'aktiv' : 'angekündigt',
        period: describeRestrictionPeriod(restriction, day),
        targets,
        liveTargetCount: targets.filter((target) => target.status === 'ok').length,
      };
    });
}
