import { db } from '@/db/appDb';
import { createId } from '@/lib/id';
import { isSupportedMediaType, toStorableBlob } from '@/lib/media';

async function deleteOrphanedMediaAsset(mediaAssetId?: string) {
  if (!mediaAssetId) {
    return;
  }

  const stillReferenced = await db.exercises.filter((exercise) => exercise.mediaAssetId === mediaAssetId).count();

  if (stillReferenced === 0) {
    await db.mediaAssets.delete(mediaAssetId);
  }
}

export interface MediaAssetInput {
  file: Blob;
  fileName: string;
  mimeType: string;
}

/**
 * Prüft den Typ und liest die Datei in den Speicher.
 *
 * Gehört vor jede Transaktion, die das Bild ablegt - siehe [toStorableBlob].
 */
export async function prepareMediaAsset(input: MediaAssetInput): Promise<MediaAssetInput> {
  if (!isSupportedMediaType(input.mimeType)) {
    throw new Error('Nur JPG, PNG, GIF und WebP werden unterstützt.');
  }

  return { ...input, file: await toStorableBlob(input.file) };
}

/**
 * Legt ein Bild ab, ohne es an eine Übung zu hängen.
 *
 * Bewusst ohne eigene Transaktion: der Aufrufer klammert Bild und Übung
 * zusammen, damit beim Anlegen nie das eine ohne das andere entsteht.
 */
export async function createMediaAsset(input: MediaAssetInput) {
  if (!isSupportedMediaType(input.mimeType)) {
    throw new Error('Nur JPG, PNG, GIF und WebP werden unterstützt.');
  }

  const mediaAssetId = createId();

  await db.mediaAssets.add({
    id: mediaAssetId,
    mimeType: input.mimeType,
    fileName: input.fileName,
    byteSize: input.file.size,
    blob: input.file,
    createdAt: new Date().toISOString(),
  });

  return mediaAssetId;
}

export async function replaceExerciseMedia(input: MediaAssetInput & { exerciseId: string }) {
  const exercise = await db.exercises.get(input.exerciseId);

  if (!exercise) {
    throw new Error('Übung nicht gefunden');
  }

  const previousMediaAssetId = exercise.mediaAssetId;
  const prepared = await prepareMediaAsset(input);
  let mediaAssetId = '';

  await db.transaction('rw', db.exercises, db.mediaAssets, async () => {
    mediaAssetId = await createMediaAsset(prepared);

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
