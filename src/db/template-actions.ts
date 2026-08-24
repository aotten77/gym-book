import { db } from '@/db/appDb';
import type { WorkoutTemplateExercise } from '@/domain/models';
import {
  areGroupsContiguous,
  planGroupWithPrevious,
  planNormalizeGroups,
  planUngroup,
  type SupersetAssignment,
} from '@/domain/superset';
import { normalizeOptionalNumber, normalizeOptionalText } from '@/db/normalize';
import { createId } from '@/lib/id';

interface TemplateInput {
  name: string;
  notes?: string;
}

interface SaveTemplateExerciseInput {
  id?: string;
  templateId: string;
  /** Immer eine bestehende Übung - angelegt wird sie in `exercise-actions.ts`. */
  exerciseId: string;
  orderIndex: number;
  workSetCount: number;
  includeWarmup?: boolean;
  targetReps?: number;
  targetSeconds?: number;
  targetWeight?: number;
  targetBandId?: string;
  targetHeightCm?: number;
  restSeconds?: number;
  notes?: string;
}

interface SaveProgressionRuleInput {
  templateExerciseId: string;
  programWeekId: string;
  targetReps?: number;
  targetSeconds?: number;
  targetWeight?: number;
  targetBandId?: string;
  targetHeightCm?: number;
  notes?: string;
}

async function normalizeTemplateExerciseOrder(templateId: string) {
  const items = await db.workoutTemplateExercises
    .where('templateId')
    .equals(templateId)
    .sortBy('orderIndex');

  await Promise.all(
    items.map((item, index) =>
      db.workoutTemplateExercises.update(item.id, {
        orderIndex: index + 1,
      }),
    ),
  );

  // Nach einer Löschung kann ein Supersatz auf ein einziges Mitglied
  // zusammenschrumpfen - das ist keiner mehr.
  await Promise.all(
    planNormalizeGroups(items).map((entry) =>
      db.workoutTemplateExercises.update(entry.id, { supersetGroupId: entry.supersetGroupId }),
    ),
  );
}

export async function createTemplate(input: TemplateInput) {
  const now = new Date().toISOString();
  const templateId = createId();

  await db.workoutTemplates.add({
    id: templateId,
    name: input.name.trim(),
    notes: normalizeOptionalText(input.notes),
    createdAt: now,
    updatedAt: now,
  });

  return templateId;
}

export async function updateTemplate(templateId: string, input: TemplateInput) {
  await db.workoutTemplates.update(templateId, {
    name: input.name.trim(),
    notes: normalizeOptionalText(input.notes),
    updatedAt: new Date().toISOString(),
  });
}

export async function deleteTemplate(templateId: string) {
  const templateExercises = await db.workoutTemplateExercises.where('templateId').equals(templateId).toArray();
  const templateExerciseIds = templateExercises.map((item) => item.id);

  await db.transaction(
    'rw',
    db.workoutTemplates,
    db.workoutTemplateExercises,
    db.progressionRules,
    async () => {
      if (templateExerciseIds.length > 0) {
        await db.progressionRules.where('templateExerciseId').anyOf(templateExerciseIds).delete();
        await db.workoutTemplateExercises.where('templateId').equals(templateId).delete();
      }

      await db.workoutTemplates.delete(templateId);
    },
  );
}

export async function saveTemplateExercise(input: SaveTemplateExerciseInput) {
  const templateExerciseId = input.id ?? createId();

  await db.transaction('rw', db.exercises, db.workoutTemplateExercises, async () => {
    if (!(await db.exercises.get(input.exerciseId))) {
      throw new Error('Übung nicht gefunden');
    }

    const templateExercisePayload = {
      templateId: input.templateId,
      exerciseId: input.exerciseId,
      orderIndex: Math.max(1, input.orderIndex),
      workSetCount: Math.max(1, input.workSetCount),
      // Immer als echter Boolean schreiben: `undefined` würde die Property
      // über Dexies Update-Semantik löschen statt sie zu setzen.
      includeWarmup: input.includeWarmup !== false,
      targetReps: normalizeOptionalNumber(input.targetReps),
      targetSeconds: normalizeOptionalNumber(input.targetSeconds),
      targetWeight: normalizeOptionalNumber(input.targetWeight),
      targetBandId: normalizeOptionalText(input.targetBandId),
      targetHeightCm: normalizeOptionalNumber(input.targetHeightCm),
      restSeconds: normalizeOptionalNumber(input.restSeconds),
      notes: normalizeOptionalText(input.notes),
    };

    if (input.id) {
      await db.workoutTemplateExercises.update(input.id, templateExercisePayload);
    } else {
      await db.workoutTemplateExercises.add({
        id: templateExerciseId,
        ...templateExercisePayload,
      });
    }
  });

  await normalizeTemplateExerciseOrder(input.templateId);

  return {
    exerciseId: input.exerciseId,
    templateExerciseId,
  };
}

export async function deleteTemplateExercise(templateExerciseId: string) {
  const templateExercise = await db.workoutTemplateExercises.get(templateExerciseId);

  if (!templateExercise) {
    return;
  }

  await db.transaction(
    'rw',
    db.workoutTemplateExercises,
    db.progressionRules,
    async () => {
      await db.progressionRules.where('templateExerciseId').equals(templateExerciseId).delete();
      await db.workoutTemplateExercises.delete(templateExerciseId);
    },
  );

  await normalizeTemplateExerciseOrder(templateExercise.templateId);
}

export async function reorderTemplateExercises(templateId: string, orderedTemplateExerciseIds: string[]) {
  const currentExercises = await db.workoutTemplateExercises.where('templateId').equals(templateId).sortBy('orderIndex');

  if (currentExercises.length !== orderedTemplateExerciseIds.length) {
    return;
  }

  const knownIds = new Set(currentExercises.map((item) => item.id));

  if (orderedTemplateExerciseIds.some((id) => !knownIds.has(id))) {
    return;
  }

  // Eine Reihenfolge, die einen Supersatz zerreißt, entstünde stumm und ließe
  // sich danach weder darstellen noch am Stück bewegen.
  const exerciseById = new Map(currentExercises.map((item) => [item.id, item]));
  const nextOrder = orderedTemplateExerciseIds
    .map((id) => exerciseById.get(id))
    .filter((item): item is WorkoutTemplateExercise => Boolean(item));

  if (!areGroupsContiguous(nextOrder)) {
    return;
  }

  await db.transaction('rw', db.workoutTemplateExercises, async () => {
    await Promise.all(
      orderedTemplateExerciseIds.map((id, index) =>
        db.workoutTemplateExercises.update(id, {
          orderIndex: index + 1,
        }),
      ),
    );
  });
}

/**
 * Verbindet zwei geplante Übungen zu einem Supersatz bzw. löst sie wieder.
 *
 * Spiegelbild zu den gleichnamigen Aktionen auf der Session-Seite: dieselben
 * reinen Regeln, nur eine andere Tabelle.
 */
async function applyTemplateSupersetPlan(
  templateExerciseId: string,
  plan: (
    items: WorkoutTemplateExercise[],
    id: string,
  ) => SupersetAssignment[] | null,
) {
  const current = await db.workoutTemplateExercises.get(templateExerciseId);

  if (!current) {
    return;
  }

  await db.transaction('rw', db.workoutTemplateExercises, async () => {
    const items = await db.workoutTemplateExercises
      .where('templateId')
      .equals(current.templateId)
      .sortBy('orderIndex');
    const assignments = plan(items, templateExerciseId);

    if (!assignments) {
      return;
    }

    await Promise.all(
      assignments.map((entry) =>
        // `undefined` löscht die Property über Dexies Update-Semantik - beim
        // Lösen ist genau das gemeint.
        db.workoutTemplateExercises.update(entry.id, { supersetGroupId: entry.supersetGroupId }),
      ),
    );
  });
}

export async function groupTemplateExerciseWithPrevious(templateExerciseId: string) {
  await applyTemplateSupersetPlan(templateExerciseId, planGroupWithPrevious);
}

export async function ungroupTemplateExercise(templateExerciseId: string) {
  await applyTemplateSupersetPlan(templateExerciseId, planUngroup);
}

export async function saveProgressionRule(input: SaveProgressionRuleInput) {
  const targetReps = normalizeOptionalNumber(input.targetReps);
  const targetSeconds = normalizeOptionalNumber(input.targetSeconds);
  const targetWeight = normalizeOptionalNumber(input.targetWeight);
  const targetBandId = normalizeOptionalText(input.targetBandId);
  const targetHeightCm = normalizeOptionalNumber(input.targetHeightCm);
  const notes = normalizeOptionalText(input.notes);

  const existingRule = await db.progressionRules
    .where('templateExerciseId')
    .equals(input.templateExerciseId)
    .filter((rule) => rule.programWeekId === input.programWeekId)
    .first();

  // Eine Regel ohne jede Vorgabe ist keine Regel - dann verschwindet sie
  // wieder. Ziel-Band und Ziel-Höhe zählen dabei mit, sonst überlebte eine
  // reine Band- oder Höhen-Progression das Speichern nicht.
  if (
    targetReps === undefined &&
    targetSeconds === undefined &&
    targetWeight === undefined &&
    targetBandId === undefined &&
    targetHeightCm === undefined &&
    notes === undefined
  ) {
    if (existingRule) {
      await db.progressionRules.delete(existingRule.id);
    }
    return;
  }

  const payload = {
    templateExerciseId: input.templateExerciseId,
    programWeekId: input.programWeekId,
    targetReps,
    targetSeconds,
    targetWeight,
    targetBandId,
    targetHeightCm,
    notes,
  };

  if (existingRule) {
    await db.progressionRules.put({
      id: existingRule.id,
      ...payload,
    });
    return;
  }

  await db.progressionRules.add({
    id: createId(),
    ...payload,
  });
}

export async function clearProgressionRule(templateExerciseId: string, programWeekId: string) {
  const existingRule = await db.progressionRules
    .where('templateExerciseId')
    .equals(templateExerciseId)
    .filter((rule) => rule.programWeekId === programWeekId)
    .first();

  if (!existingRule) {
    return;
  }

  await db.progressionRules.delete(existingRule.id);
}
