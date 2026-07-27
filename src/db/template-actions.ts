import { db } from '@/db/appDb';
import type { TrackingMode } from '@/domain/models';
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
  targetReps?: number;
  targetSeconds?: number;
  targetWeight?: number;
  restSeconds?: number;
  notes?: string;
  exerciseId?: string;
  exerciseName?: string;
  instructions?: string;
  tempo?: string;
  trackingMode: TrackingMode;
  unilateral: boolean;
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

  await db.transaction(
    'rw',
    db.exercises,
    db.workoutTemplateExercises,
    async () => {
      if (!input.exerciseId) {
        await db.exercises.add({
          id: exerciseId,
          name: input.exerciseName?.trim() ?? 'Neue Uebung',
          instructions: normalizeOptionalText(input.instructions),
          tempo: normalizeOptionalText(input.tempo),
          trackingMode: input.trackingMode,
          unilateral: input.unilateral,
          createdAt: now,
          updatedAt: now,
        });
      }

      const templateExercisePayload = {
        templateId: input.templateId,
        exerciseId,
        orderIndex: Math.max(1, input.orderIndex),
        workSetCount: Math.max(1, input.workSetCount),
        targetReps: normalizeOptionalNumber(input.targetReps),
        targetSeconds: normalizeOptionalNumber(input.targetSeconds),
        targetWeight: normalizeOptionalNumber(input.targetWeight),
        restSeconds: normalizeOptionalNumber(input.restSeconds),
        notes: normalizeOptionalText(input.notes),
      };

      if (input.id) {
        await db.workoutTemplateExercises.update(input.id, templateExercisePayload);
      } else {
        await db.workoutTemplateExercises.add({
          id: createId(),
          ...templateExercisePayload,
        });
      }
    },
  );

  await normalizeTemplateExerciseOrder(input.templateId);
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
