import { db } from '@/db/appDb';
import type { Restriction } from '@/domain/models';

/*
 * Schreibseite der Einschränkungen in der App. Angelegt und geändert werden
 * sie nur über den Bibliotheks-Import; die App selbst kann eine nur aufheben.
 * Ein zweiter Schreibweg (Enddatum ändern, anlegen) wäre eine zweite Stelle,
 * an der der Plan entsteht - siehe `docs/architecture/restrictions.md`.
 */

/** Alle Einschränkungen. Die Tabelle ist klein und wird immer ganz gelesen. */
export async function loadRestrictions(): Promise<Restriction[]> {
  return db.restrictions.toArray();
}

/**
 * Hebt eine Einschränkung auf: setzt `liftedAt`, löscht nichts. Eine schon
 * aufgehobene bleibt, wie sie ist - der erste Zeitpunkt gilt.
 */
export async function liftRestriction(id: string, now: Date = new Date()): Promise<void> {
  await db.transaction('rw', db.restrictions, async () => {
    const restriction = await db.restrictions.get(id);

    if (!restriction) {
      throw new Error('Einschränkung nicht gefunden.');
    }

    if (restriction.liftedAt) {
      return;
    }

    const stamp = now.toISOString();

    await db.restrictions.update(id, { liftedAt: stamp, updatedAt: stamp });
  });
}
