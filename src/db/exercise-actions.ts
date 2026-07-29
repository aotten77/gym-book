import { db } from '@/db/appDb';
import type { Exercise, TrackingMode } from '@/domain/models';
import { createId } from '@/lib/id';

/*
 * Bis hierher entstanden Uebungen nur als Nebeneffekt beim Anlegen einer
 * Template- oder Session-Uebung, waren danach nicht mehr editierbar und liessen
 * sich ueberhaupt nicht loeschen - ein Tippfehler im Namen war permanent.
 */

export interface ExerciseInput {
  name: string;
  instructions?: string;
  tempo?: string;
  trackingMode: TrackingMode;
  unilateral: boolean;
}

export interface ExerciseUsage {
  templateNames: string[];
  sessionCount: number;
  /** In Vorlagen verwendete Uebungen zu loeschen wuerde diese Vorlagen zerstoeren. */
  canDelete: boolean;
}

function normalizeOptionalText(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function assertName(name: string) {
  const trimmed = name.trim();

  if (!trimmed) {
    throw new Error('Die Uebung braucht einen Namen.');
  }

  return trimmed;
}

export async function createExercise(input: ExerciseInput) {
  const name = assertName(input.name);
  const now = new Date().toISOString();
  const id = createId();

  await db.exercises.add({
    id,
    name,
    instructions: normalizeOptionalText(input.instructions),
    tempo: normalizeOptionalText(input.tempo),
    trackingMode: input.trackingMode,
    unilateral: input.unilateral,
    createdAt: now,
    updatedAt: now,
  });

  return id;
}

/**
 * Aendert die Stammdaten einer Uebung.
 *
 * Laufende und historische Sessions sind davon nicht betroffen: sie tragen
 * eigene Snapshots von Name, Tracking-Modus und Unilateral-Flag.
 */
export async function updateExercise(exerciseId: string, input: ExerciseInput) {
  const name = assertName(input.name);

  await db.transaction('rw', db.exercises, async () => {
    const existing = await db.exercises.get(exerciseId);

    if (!existing) {
      throw new Error('Uebung nicht gefunden.');
    }

    await db.exercises.update(exerciseId, {
      name,
      instructions: normalizeOptionalText(input.instructions),
      tempo: normalizeOptionalText(input.tempo),
      trackingMode: input.trackingMode,
      unilateral: input.unilateral,
      updatedAt: new Date().toISOString(),
    });
  });
}

export async function getExerciseUsage(exerciseId: string): Promise<ExerciseUsage> {
  const templateExercises = await db.workoutTemplateExercises
    .where('exerciseId')
    .equals(exerciseId)
    .toArray();

  const templates = await db.workoutTemplates.bulkGet([
    ...new Set(templateExercises.map((item) => item.templateId)),
  ]);

  const sessionCount = await db.workoutSessionExercises
    .where('exerciseId')
    .equals(exerciseId)
    .count();

  const templateNames = templates
    .filter((template): template is NonNullable<typeof template> => Boolean(template))
    .map((template) => template.name);

  return {
    templateNames,
    sessionCount,
    canDelete: templateNames.length === 0,
  };
}

/**
 * Loescht eine Uebung samt verwaistem Bild.
 *
 * Historische Sessions bleiben erhalten - sie arbeiten mit Snapshots und
 * verlieren dadurch keine Aussagekraft. In einer Vorlage verwendete Uebungen
 * werden dagegen abgelehnt, sonst laesst sich die Vorlage nie wieder starten
 * (`materializeSession` wirft bei fehlender Uebung).
 */
export async function deleteExercise(exerciseId: string) {
  await db.transaction('rw', db.exercises, db.workoutTemplateExercises, db.mediaAssets, async () => {
    const exercise = await db.exercises.get(exerciseId);

    if (!exercise) {
      throw new Error('Uebung nicht gefunden.');
    }

    const usedInTemplates = await db.workoutTemplateExercises
      .where('exerciseId')
      .equals(exerciseId)
      .count();

    if (usedInTemplates > 0) {
      throw new Error(
        'Diese Uebung wird noch in einer Vorlage verwendet. Entferne sie dort zuerst.',
      );
    }

    await db.exercises.delete(exerciseId);

    if (exercise.mediaAssetId) {
      const stillReferenced = await db.exercises
        .where('mediaAssetId')
        .equals(exercise.mediaAssetId)
        .count();

      if (stillReferenced === 0) {
        await db.mediaAssets.delete(exercise.mediaAssetId);
      }
    }
  });
}

export async function listExercises(): Promise<Exercise[]> {
  return db.exercises.orderBy('name').toArray();
}
