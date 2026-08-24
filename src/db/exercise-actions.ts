import { db } from '@/db/appDb';
import { createMediaAsset, prepareMediaAsset, type MediaAssetInput } from '@/db/media-actions';
import { assertName, normalizeOptionalText } from '@/db/normalize';
import type { Exercise, LoadKind, TrackingMode } from '@/domain/models';
import { supportsBand } from '@/domain/tracking';
import { createId } from '@/lib/id';

/*
 * Bis hierher entstanden Übungen nur als Nebeneffekt beim Anlegen einer
 * Template- oder Session-Übung, waren danach nicht mehr editierbar und ließen
 * sich überhaupt nicht löschen - ein Tippfehler im Namen war permanent.
 */

export interface ExerciseInput {
  name: string;
  instructions?: string;
  tempo?: string;
  trackingMode: TrackingMode;
  loadKind?: LoadKind;
  /** Höhe in Zentimetern mitschreiben - siehe `Exercise.tracksHeight`. */
  tracksHeight?: boolean;
  unilateral: boolean;
}

export interface ExerciseUsage {
  templateNames: string[];
  sessionCount: number;
  /** In Vorlagen verwendete Übungen zu löschen würde diese Vorlagen zerstören. */
  canDelete: boolean;
}

/**
 * Speichert die Belastungsart nur, wenn sie etwas aussagt.
 *
 * `undefined` bedeutet Kilo - eine reine Zeitübung ohne Last trägt also gar
 * keinen Wert, und ein "Band" an einer Übung ohne Last wäre eine Lüge.
 */
function normalizeLoadKind(
  loadKind: LoadKind | undefined,
  trackingMode: TrackingMode,
): LoadKind | undefined {
  return supportsBand(trackingMode, loadKind) ? 'band' : undefined;
}

/**
 * Speichert den Höhen-Schalter nur, wenn er an ist.
 *
 * Ein ausdrückliches `false` wäre dasselbe wie kein Schlüssel - und beim
 * Update löscht Dexie die Property über `undefined` genau dann, wenn der
 * Schalter ausgeht. So bleibt das Feld additiv wie `loadKind`.
 */
function normalizeTracksHeight(tracksHeight?: boolean) {
  return tracksHeight ? true : undefined;
}

/**
 * Legt eine Übung an - auf Wunsch samt Bild.
 *
 * Bild und Stammdaten entstehen in derselben Transaktion. Vorher musste man
 * erst speichern und das Bild danach an der fertigen Karte nachreichen; ein
 * abgebrochener Upload hinterlässt so keine halb angelegte Übung.
 */
export async function createExercise(input: ExerciseInput, media?: MediaAssetInput) {
  const name = assertName(input.name, 'Die Übung braucht einen Namen.');
  const now = new Date().toISOString();
  const id = createId();
  const preparedMedia = media ? await prepareMediaAsset(media) : undefined;

  await db.transaction('rw', db.exercises, db.mediaAssets, async () => {
    const mediaAssetId = preparedMedia ? await createMediaAsset(preparedMedia) : undefined;

    await db.exercises.add({
      id,
      name,
      instructions: normalizeOptionalText(input.instructions),
      tempo: normalizeOptionalText(input.tempo),
      trackingMode: input.trackingMode,
      loadKind: normalizeLoadKind(input.loadKind, input.trackingMode),
      tracksHeight: normalizeTracksHeight(input.tracksHeight),
      unilateral: input.unilateral,
      mediaAssetId,
      createdAt: now,
      updatedAt: now,
    });
  });

  return id;
}

/**
 * Ändert die Stammdaten einer Übung.
 *
 * Laufende und historische Sessions sind davon nicht betroffen: sie tragen
 * eigene Snapshots von Name, Tracking-Modus und Unilateral-Flag.
 */
export async function updateExercise(exerciseId: string, input: ExerciseInput) {
  const name = assertName(input.name, 'Die Übung braucht einen Namen.');

  await db.transaction('rw', db.exercises, async () => {
    const existing = await db.exercises.get(exerciseId);

    if (!existing) {
      throw new Error('Übung nicht gefunden.');
    }

    await db.exercises.update(exerciseId, {
      name,
      instructions: normalizeOptionalText(input.instructions),
      tempo: normalizeOptionalText(input.tempo),
      trackingMode: input.trackingMode,
      loadKind: normalizeLoadKind(input.loadKind, input.trackingMode),
      tracksHeight: normalizeTracksHeight(input.tracksHeight),
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
 * Löscht eine Übung samt verwaistem Bild.
 *
 * Historische Sessions bleiben erhalten - sie arbeiten mit Snapshots und
 * verlieren dadurch keine Aussagekraft. In einer Vorlage verwendete Übungen
 * werden dagegen abgelehnt, sonst lässt sich die Vorlage nie wieder starten
 * (`materializeSession` wirft bei fehlender Übung).
 */
export async function deleteExercise(exerciseId: string) {
  await db.transaction('rw', db.exercises, db.workoutTemplateExercises, db.mediaAssets, async () => {
    const exercise = await db.exercises.get(exerciseId);

    if (!exercise) {
      throw new Error('Übung nicht gefunden.');
    }

    const usedInTemplates = await db.workoutTemplateExercises
      .where('exerciseId')
      .equals(exerciseId)
      .count();

    if (usedInTemplates > 0) {
      throw new Error(
        'Diese Übung wird noch in einer Vorlage verwendet. Entferne sie dort zuerst.',
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
