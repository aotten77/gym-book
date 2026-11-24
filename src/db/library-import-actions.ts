import { db } from '@/db/appDb';
import { loadTakenPlanEntryIds } from '@/db/plan-actions';
import type { LibraryImportLog, Restriction } from '@/domain/models';
import {
  planLibraryImport,
  type LibraryImportPayload,
  type LibraryImportPlan,
  type LibraryImportState,
} from '@/domain/library-import';
import { buildImportedPlanEntryRecord, orderPlanDay } from '@/domain/plan-import';
import { toDateInputValue } from '@/domain/program';
import { createId } from '@/lib/id';

/*
 * Die schreibende Hälfte des Bibliotheks-Imports. Geplant wird in
 * [domain/library-import.ts]; hier wird nur gelesen, geschrieben und
 * protokolliert.
 *
 * Angefasst werden ausschließlich Übungen, Workouts, Zuordnungen, Bänder,
 * Termine und Einschränkungen. Sessions und Läufe stehen nur in der Transaktion, damit *in* ihr
 * gelesen wird, welche Termine belegt sind - geschrieben werden sie nie.
 * Satzprotokolle, Tests und Einstellungen stehen bewusst nicht darin: was der
 * Import nicht erreichen kann, kann er auch nicht beschädigen.
 */

export async function loadLibraryImportState(): Promise<LibraryImportState> {
  const planEntries = await db.planEntries.toArray();

  return {
    exercises: await db.exercises.toArray(),
    templates: await db.workoutTemplates.toArray(),
    templateExercises: await db.workoutTemplateExercises.toArray(),
    bandLevels: await db.bandLevels.toArray(),
    progressionRules: await db.progressionRules.toArray(),
    planEntries,
    takenPlanEntryIds: await loadTakenPlanEntryIds(planEntries.map((entry) => entry.id)),
    today: toDateInputValue(new Date()),
    restrictions: await db.restrictions.toArray(),
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
    [
      db.exercises,
      db.workoutTemplates,
      db.workoutTemplateExercises,
      db.bandLevels,
      db.progressionRules,
      db.libraryImports,
      db.planEntries,
      db.workoutSessions,
      db.runLogs,
      db.restrictions,
    ],
    async () => {
      const state = await loadLibraryImportState();
      const current = planLibraryImport(payload, state);
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

      // Erst die Wochenregeln, dann die Zuordnung - dieselbe Reihenfolge wie
      // `deleteTemplateExercise`, damit keine Regel ins Leere zeigt.
      for (const entry of current.assignments) {
        if (entry.kind === 'removed') {
          await db.progressionRules.where('templateExerciseId').equals(entry.id).delete();
          await db.workoutTemplateExercises.delete(entry.id);
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

      await writePlanEntries(current, state, now);
      await writeRestrictions(current, now);

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
        removedAssignments: current.summary.removedAssignments,
        createdPlanEntries: current.summary.createdPlanEntries,
        updatedPlanEntries: current.summary.updatedPlanEntries,
        removedPlanEntries: current.summary.removedPlanEntries,
        createdRestrictions: current.summary.createdRestrictions,
        updatedRestrictions: current.summary.updatedRestrictions,
        liftedRestrictions: current.summary.liftedRestrictions,
        reactivatedRestrictions: current.summary.reactivatedRestrictions,
      };

      await db.libraryImports.add(log);
    },
  );

  if (!plan || !log) {
    throw new Error('Der Import wurde nicht abgeschlossen.');
  }

  return { plan, log };
}

/**
 * Schreibt die Termine nach den Workouts - ein neuer Termin darf auf ein
 * Workout zeigen, das derselbe Import gerade angelegt hat. Neu wird
 * angelegt, geändert per `put` des ganzen Datensatzes (nie `Table.update`
 * mit `undefined`), entfernt gelöscht; belegte bleiben unberührt. Danach
 * wird jeder berührte Tag dicht nach der Zielreihenfolge nummeriert.
 */
async function writePlanEntries(plan: LibraryImportPlan, state: LibraryImportState, now: string) {
  const touchedDays = new Set<string>();

  for (const entry of plan.planEntries) {
    if (entry.taken || entry.kind === 'unchanged') {
      continue;
    }

    const existing = await db.planEntries.get(entry.id);

    if (entry.kind === 'removed') {
      if (existing) {
        touchedDays.add(existing.date);
        await db.planEntries.delete(entry.id);
      }

      continue;
    }

    const record = buildImportedPlanEntryRecord(entry, existing, now);

    touchedDays.add(record.date);
    await db.planEntries.put(record);
  }

  for (const date of touchedDays) {
    // Die Zielreihenfolge aus dem Bestand *vor* dem Schreiben - dieselben
    // Daten, mit denen die Planung sie berechnet hat.
    const target = orderPlanDay(date, state.planEntries, plan.planEntries, state.takenPlanEntryIds);
    const byId = new Map(
      (await db.planEntries.where('date').equals(date).toArray()).map((entry) => [entry.id, entry]),
    );

    for (const [index, id] of target.entries()) {
      const entry = byId.get(id);

      // Die einzige Schreibung an einem belegten Termin: die dichte Nummer
      // seiner Anzeigereihenfolge, nachdem davor ein Termin entfernt wurde.
      // Sein Platz unter den bleibenden Terminen ändert sich nie.
      if (entry && entry.orderInDay !== index + 1) {
        await db.planEntries.put({ ...entry, orderInDay: index + 1 });
      }
    }
  }
}

/**
 * Schreibt die Einschränkungen nach den Übungen und Workouts, auf deren Ids
 * ihre Ziele zeigen. Der Plan trägt beim Aufheben nur einen Tag als Marker;
 * geschrieben wird der Zeitpunkt des Imports, wie beim Knopf „Aufheben“.
 */
async function writeRestrictions(plan: LibraryImportPlan, now: string) {
  for (const entry of plan.restrictions) {
    if (entry.record) {
      await db.restrictions.add({
        id: createId(),
        ...entry.record,
        ...(entry.liftedAt ? { liftedAt: now } : {}),
        createdAt: now,
        updatedAt: now,
      });
      continue;
    }

    if (entry.kind === 'unchanged') {
      continue;
    }

    const changes: Partial<Restriction> = { ...entry.values, updatedAt: now };

    if (entry.liftedAt === null) {
      // Die eine gewollte Löschung per `Table.update` mit `undefined`: „wieder
      // aktiv“ entfernt den Zeitpunkt des Aufhebens, statt ihn zu überschreiben.
      changes.liftedAt = undefined;
    } else if (entry.liftedAt !== undefined) {
      changes.liftedAt = now;
    }

    await db.restrictions.update(entry.id, changes);
  }
}

/** Die letzten Protokollzeilen, neueste zuerst. */
export async function listLibraryImports(limit = 5): Promise<LibraryImportLog[]> {
  return db.libraryImports.orderBy('importedAt').reverse().limit(limit).toArray();
}
