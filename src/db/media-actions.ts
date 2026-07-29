import { db } from '@/db/appDb';
import { createId } from '@/lib/id';
import { isSupportedMediaType } from '@/lib/media';

async function deleteOrphanedMediaAsset(mediaAssetId?: string) {
  if (!mediaAssetId) {
    return;
  }

  const stillReferenced = await db.exercises.filter((exercise) => exercise.mediaAssetId === mediaAssetId).count();

  if (stillReferenced === 0) {
    await db.mediaAssets.delete(mediaAssetId);
  }
}

async function createMediaAsset(file: Blob, fileName: string, mimeType: string) {
  if (!isSupportedMediaType(mimeType)) {
    throw new Error('Nur JPG, PNG, GIF und WebP werden unterstützt.');
  }

  const mediaAssetId = createId();

  await db.mediaAssets.add({
    id: mediaAssetId,
    mimeType,
    fileName,
    byteSize: file.size,
    blob: file,
    createdAt: new Date().toISOString(),
  });

  return mediaAssetId;
}

export async function replaceExerciseMedia(input: {
  exerciseId: string;
  file: Blob;
  fileName: string;
  mimeType: string;
}) {
  const exercise = await db.exercises.get(input.exerciseId);

  if (!exercise) {
    throw new Error('Übung nicht gefunden');
  }

  const previousMediaAssetId = exercise.mediaAssetId;
  const mediaAssetId = createId();

  await db.transaction('rw', db.exercises, db.mediaAssets, async () => {
    if (!isSupportedMediaType(input.mimeType)) {
      throw new Error('Nur JPG, PNG, GIF und WebP werden unterstützt.');
    }

    await db.mediaAssets.add({
      id: mediaAssetId,
      mimeType: input.mimeType,
      fileName: input.fileName,
      byteSize: input.file.size,
      blob: input.file,
      createdAt: new Date().toISOString(),
    });

    await db.exercises.update(input.exerciseId, {
      mediaAssetId,
      updatedAt: new Date().toISOString(),
    });

    await deleteOrphanedMediaAsset(previousMediaAssetId);
  });

  return mediaAssetId;
}

export async function clearExerciseMedia(exerciseId: string) {
  const exercise = await db.exercises.get(exerciseId);

  if (!exercise) {
    throw new Error('Übung nicht gefunden');
  }

  const previousMediaAssetId = exercise.mediaAssetId;

  await db.transaction('rw', db.exercises, db.mediaAssets, async () => {
    await db.exercises.update(exerciseId, {
      mediaAssetId: undefined,
      updatedAt: new Date().toISOString(),
    });

    await deleteOrphanedMediaAsset(previousMediaAssetId);
  });
}

export async function createPendingExerciseMedia(input: {
  file: Blob;
  fileName: string;
  mimeType: string;
}) {
  return createMediaAsset(input.file, input.fileName, input.mimeType);
}
