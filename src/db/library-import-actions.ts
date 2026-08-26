import { db } from '@/db/appDb';
import type { LibraryImportLog } from '@/domain/models';
import {
  planLibraryImport,
  type LibraryImportPayload,
  type LibraryImportPlan,
  type LibraryImportState,
} from '@/domain/library-import';
import { createId } from '@/lib/id';

/*
 * Die schreibende Hälfte des Bibliotheks-Imports. Geplant wird in
 * [domain/library-import.ts]; hier wird nur gelesen, geschrieben und
 * protokolliert.
 *
 * Angefasst werden ausschließlich Übungen, Workouts, Zuordnungen und Bänder.
 * Sessions, Satzprotokolle, Tests und Einstellungen stehen bewusst nicht in
 * der Transaktion: was der Import nicht erreichen kann, kann er auch nicht
 * beschädigen.
 */

export async function loadLibraryImportState(): Promise<LibraryImportState> {
  return {
    exercises: await db.exercises.toArray(),
    templates: await db.workoutTemplates.toArray(),
    templateExercises: await db.workoutTemplateExercises.toArray(),
    bandLevels: await db.bandLevels.toArray(),
  };
}

/** Die Dry-Run-Vorschau: plant gegen den aktuellen Bestand, schreibt nichts. */
export async function buildLibraryImportPlan(
  payload: LibraryImportPayload,
): Promise<LibraryImportPlan> {
  return planLibraryImport(payload, await loadLibraryImportState());
}

/**
 * Spielt die Nutzlast ein - alles oder nichts.
 *
 * Geplant wird **innerhalb** der Transaktion und nicht die Vorschau von vorhin
 * ausgeführt: zwischen Vorschau und Bestätigung kann eine Übung angelegt oder
 * umbenannt worden sein, und ein Plan gegen einen veralteten Bestand legt
 * Zwillinge an. Dieselbe Überlegung wie bei der Prüfung auf eine aktive
 * Session in `startSessionFromTemplate`, die deshalb auch dort im Insert
 * steckt.
 *
 * Der zurückgegebene Plan ist der ausgeführte - die Oberfläche zeigt danach,
 * was wirklich geschrieben wurde.
 */
export async function applyLibraryImport(
  payload: LibraryImportPayload,
  sourceName?: string,
): Promise<{ plan: LibraryImportPlan; log: LibraryImportLog }> {
  const now = new Date().toISOString();
  let plan: LibraryImportPlan | undefined;
  let log: LibraryImportLog | undefined;

  await db.transaction(
    'rw',
    [db.exercises, db.workoutTemplates, db.workoutTemplateExercises, db.bandLevels, db.libraryImports],
    async () => {
      const current = planLibraryImport(payload, await loadLibraryImportState());
      plan = current;

      for (const entry of current.exercises) {
        if (entry.record) {
          await db.exercises.add({
            id: entry.id,
            ...entry.record,
            createdAt: now,
            updatedAt: now,
          });
          continue;
        }

        if (entry.kind === 'update') {
          await db.exercises.update(entry.id, { ...entry.values, updatedAt: now });
        }
      }

      for (const entry of current.templates) {
        if (entry.record) {
          await db.workoutTemplates.add({
            id: entry.id,
            ...entry.record,
            createdAt: now,
            updatedAt: now,
          });
          continue;
        }

        if (entry.kind === 'update') {
          await db.workoutTemplates.update(entry.id, { ...entry.values, updatedAt: now });
        }
      }

      // Die Zielposition steht im Reihenfolge-Plan, nicht am Eintrag: eine
      // Einfügung verschiebt auch die Nachbarn, und beide Seiten derselben
      // Rechnung dürfen nicht getrennt gepflegt werden.
      const orderIndexById = new Map<string, number>();

      for (const order of current.templateOrder) {
        order.orderedIds.forEach((id, index) => orderIndexById.set(id, index + 1));
      }

      for (const entry of current.assignments) {
        if (entry.record) {
          const orderIndex = orderIndexById.get(entry.id);

          if (orderIndex === undefined) {
            throw new Error(`Zuordnung "${entry.exerciseName}" hat keine Position bekommen.`);
          }

          await db.workoutTemplateExercises.add({
            id: entry.id,
            orderIndex,
            ...entry.record,
          });
          continue;
        }

        if (entry.kind === 'update') {
          await db.workoutTemplateExercises.update(entry.id, entry.values);
        }
      }

      for (const [id, orderIndex] of orderIndexById) {
        await db.workoutTemplateExercises.update(id, { orderIndex });
      }

      for (const entry of current.bandLevels) {
        if (entry.record) {
          await db.bandLevels.add({
            id: entry.id,
            ...entry.record,
            createdAt: now,
            updatedAt: now,
          });
          continue;
        }

        if (entry.kind === 'update') {
          await db.bandLevels.update(entry.id, { ...entry.values, updatedAt: now });
        }
      }

      if (current.bandOrder) {
        await Promise.all(
          current.bandOrder.map((id, index) => db.bandLevels.update(id, { orderIndex: index + 1 })),
        );
      }

      log = {
        id: createId(),
        importedAt: now,
        sourceName,
        payloadHash: current.payloadHash,
        createdExercises: current.summary.createdExercises,
        updatedExercises: current.summary.updatedExercises,
        createdTemplates: current.summary.createdTemplates,
        updatedTemplates: current.summary.updatedTemplates,
        createdAssignments: current.summary.createdAssignments,
        updatedAssignments: current.summary.updatedAssignments,
        createdBandLevels: current.summary.createdBandLevels,
        updatedBandLevels: current.summary.updatedBandLevels,
      };

      await db.libraryImports.add(log);
    },
  );

  if (!plan || !log) {
    throw new Error('Der Import wurde nicht abgeschlossen.');
  }

  return { plan, log };
}

/** Die letzten Protokollzeilen, neueste zuerst. */
export async function listLibraryImports(limit = 5): Promise<LibraryImportLog[]> {
  return db.libraryImports.orderBy('importedAt').reverse().limit(limit).toArray();
}
