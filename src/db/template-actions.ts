import { db } from '@/db/appDb';
import type { LoadKind, TrackingMode, WorkoutTemplateExercise } from '@/domain/models';
import {
  areGroupsContiguous,
  planGroupWithPrevious,
  planNormalizeGroups,
  planUngroup,
  type SupersetAssignment,
} from '@/domain/superset';
import { createId } from '@/lib/id';

interface TemplateInput {
  name: string;
  notes?: string;
}

interface SaveTemplateExerciseInput {
  id?: string;
  templateId: string;
  orderIndex: number;
  workSetCount: number;
  includeWarmup?: boolean;
  targetReps?: number;
  targetSeconds?: number;
  targetWeight?: number;
  targetBandId?: string;
  restSeconds?: number;
  notes?: string;
  exerciseId?: string;
  exerciseName?: string;
  instructions?: string;
  tempo?: string;
  mediaAssetId?: string;
  trackingMode: TrackingMode;
  loadKind?: LoadKind;
  unilateral: boolean;
}

interface SaveProgressionRuleInput {
  templateExerciseId: string;
  programWeekId: string;
  targetReps?: number;
  targetSeconds?: number;
  targetWeight?: number;
  targetBandId?: string;
  notes?: string;
}

function normalizeOptionalText(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeOptionalNumber(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return undefined;
  }

  return value >= 0 ? value : undefined;
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
  const now = new Date().toISOString();
  const exerciseId = input.exerciseId ?? createId();
  const templateExerciseId = input.id ?? createId();

  await db.transaction(
    'rw',
    db.exercises,
    db.workoutTemplateExercises,
    async () => {
      if (!input.exerciseId) {
        await db.exercises.add({
          id: exerciseId,
          name: input.exerciseName?.trim() ?? 'Neue Übung',
          instructions: normalizeOptionalText(input.instructions),
          tempo: normalizeOptionalText(input.tempo),
          trackingMode: input.trackingMode,
          loadKind: input.loadKind,
          unilateral: input.unilateral,
          mediaAssetId: input.mediaAssetId,
          createdAt: now,
          updatedAt: now,
        });
      }

      const templateExercisePayload = {
        templateId: input.templateId,
        exerciseId,
        orderIndex: Math.max(1, input.orderIndex),
        workSetCount: Math.max(1, input.workSetCount),
        // Immer als echter Boolean schreiben: `undefined` würde die Property
        // über Dexies Update-Semantik löschen statt sie zu setzen.
        includeWarmup: input.includeWarmup !== false,
        targetReps: normalizeOptionalNumber(input.targetReps),
        targetSeconds: normalizeOptionalNumber(input.targetSeconds),
        targetWeight: normalizeOptionalNumber(input.targetWeight),
        targetBandId: normalizeOptionalText(input.targetBandId),
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
    },
  );

  await normalizeTemplateExerciseOrder(input.templateId);

  return {
    exerciseId,
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
  const notes = normalizeOptionalText(input.notes);

  const existingRule = await db.progressionRules
    .where('templateExerciseId')
    .equals(input.templateExerciseId)
    .filter((rule) => rule.programWeekId === input.programWeekId)
    .first();

  // Eine Regel ohne jede Vorgabe ist keine Regel - dann verschwindet sie
  // wieder. Das Ziel-Band zählt dabei mit, sonst überlebte eine reine
  // Band-Progression das Speichern nicht.
  if (
    targetReps === undefined &&
    targetSeconds === undefined &&
    targetWeight === undefined &&
    targetBandId === undefined &&
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
