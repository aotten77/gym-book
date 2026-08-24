import { db } from '@/db/appDb';
import type { BandLevel } from '@/domain/models';
import { assertName } from '@/db/normalize';
import { createId } from '@/lib/id';

/*
 * Der Band-Katalog ist die Kilo-Skala für Übungen mit Widerstandsbändern:
 * "gelb" allein sagt nichts, erst die Reihenfolge macht daraus ein "leichter
 * als rot". Deshalb ist `orderIndex` - nicht der Name - der eigentliche Wert.
 */

/**
 * Übliche Farbfolge von Theraband & Co., leicht nach schwer.
 *
 * Nur als Startknopf gedacht, nicht als automatische Saat: wer keine Bänder
 * benutzt, soll keinen Katalog vorfinden, den er nie angelegt hat.
 */
export const DEFAULT_BAND_NAMES = ['gelb', 'rot', 'grün', 'blau', 'schwarz', 'silber', 'gold'];

export async function listBandLevels(): Promise<BandLevel[]> {
  return db.bandLevels.orderBy('orderIndex').toArray();
}

export async function createBandLevel(name: string) {
  const trimmed = assertName(name, 'Das Band braucht einen Namen.');
  const id = createId();

  await db.transaction('rw', db.bandLevels, async () => {
    const existing = await db.bandLevels.orderBy('orderIndex').toArray();

    if (existing.some((band) => band.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error('Ein Band mit diesem Namen gibt es bereits.');
    }

    const now = new Date().toISOString();

    await db.bandLevels.add({
      id,
      name: trimmed,
      // Neue Bänder hängen sich hinten an: schwerer als alles Bisherige ist
      // die wahrscheinlichere Absicht als irgendwo dazwischen.
      orderIndex: existing.length + 1,
      createdAt: now,
      updatedAt: now,
    });
  });

  return id;
}

/**
 * Benennt ein Band um.
 *
 * Bereits protokollierte Sätze behalten ihren alten Namen: sie tragen mit
 * `bandNameSnapshot` fest, was an dem Tag im Katalog stand.
 */
export async function renameBandLevel(bandId: string, name: string) {
  const trimmed = assertName(name, 'Das Band braucht einen Namen.');

  await db.transaction('rw', db.bandLevels, async () => {
    const existing = await db.bandLevels.get(bandId);

    if (!existing) {
      throw new Error('Band nicht gefunden.');
    }

    const duplicate = await db.bandLevels
      .filter((band) => band.id !== bandId && band.name.toLowerCase() === trimmed.toLowerCase())
      .first();

    if (duplicate) {
      throw new Error('Ein Band mit diesem Namen gibt es bereits.');
    }

    await db.bandLevels.update(bandId, {
      name: trimmed,
      updatedAt: new Date().toISOString(),
    });
  });
}

/**
 * Entfernt ein Band aus dem Katalog.
 *
 * Satzprotokolle bleiben unangetastet - sie zeigen weiter ihren Bandnamen und
 * verlieren nur ihren Punkt im Diagramm. Ein Ziel-Band in Vorlage oder
 * Progressionsregel wird dagegen gelöscht, sonst zeigte das Formular dauerhaft
 * auf ein Band, das es nicht mehr gibt.
 */
export async function deleteBandLevel(bandId: string) {
  await db.transaction(
    'rw',
    db.bandLevels,
    db.workoutTemplateExercises,
    db.progressionRules,
    async () => {
      const existing = await db.bandLevels.get(bandId);

      if (!existing) {
        throw new Error('Band nicht gefunden.');
      }

      const templateExercises = await db.workoutTemplateExercises
        .filter((item) => item.targetBandId === bandId)
        .toArray();

      await Promise.all(
        templateExercises.map((item) =>
          db.workoutTemplateExercises.update(item.id, { targetBandId: undefined }),
        ),
      );

      const rules = await db.progressionRules.filter((rule) => rule.targetBandId === bandId).toArray();

      await Promise.all(
        rules.map((rule) => db.progressionRules.update(rule.id, { targetBandId: undefined })),
      );

      await db.bandLevels.delete(bandId);

      const remaining = await db.bandLevels.orderBy('orderIndex').toArray();

      await Promise.all(
        remaining.map((band, index) => db.bandLevels.update(band.id, { orderIndex: index + 1 })),
      );
    },
  );
}

/**
 * Schreibt die Reihenfolge neu.
 *
 * Wie bei den Vorlagen-Übungen: unvollständige Listen werden abgelehnt, statt
 * einen halben Katalog zu sortieren, und `orderIndex` wird als dichte,
 * 1-basierte Folge geschrieben.
 */
export async function reorderBandLevels(orderedBandIds: string[]) {
  const current = await db.bandLevels.orderBy('orderIndex').toArray();

  if (current.length !== orderedBandIds.length) {
    return;
  }

  const knownIds = new Set(current.map((band) => band.id));

  if (orderedBandIds.some((id) => !knownIds.has(id))) {
    return;
  }

  await db.transaction('rw', db.bandLevels, async () => {
    await Promise.all(
      orderedBandIds.map((id, index) => db.bandLevels.update(id, { orderIndex: index + 1 })),
    );
  });
}

/** Legt die Standardfarben an - nur solange der Katalog leer ist. */
export async function seedDefaultBandLevels() {
  await db.transaction('rw', db.bandLevels, async () => {
    const count = await db.bandLevels.count();

    if (count > 0) {
      return;
    }

    const now = new Date().toISOString();

    await db.bandLevels.bulkAdd(
      DEFAULT_BAND_NAMES.map((name, index) => ({
        id: createId(),
        name,
        orderIndex: index + 1,
        createdAt: now,
        updatedAt: now,
      })),
    );
  });
}
