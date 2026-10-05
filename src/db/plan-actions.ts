import { db } from '@/db/appDb';
import type { PlanEntry } from '@/domain/models';
import {
  PLAN_MESSAGES,
  type PlanEntryValues,
  expandSeries,
  planEntryKey,
  toPlanEntryFields,
  validatePlanEntryValues,
} from '@/domain/plan';
import type { IsoWeekday } from '@/domain/training-calendar';
import { formatRunDate } from '@/lib/format';
import { createId } from '@/lib/id';

/*
 * Schreib-API des datierten Trainingsplans. Jede Aktion läuft in einer
 * `rw`-Transaktion über Termine, Sessions und Läufe: ob ein Termin belegt ist,
 * wird *in* der Transaktion gelesen, sonst könnte zwischen Prüfung und Schreiben
 * eine Session auf ihn zeigen.
 *
 * `null` heißt in `changes` "Feld leeren", ein fehlender Schlüssel (oder
 * `undefined`) "nicht anfassen". Geschrieben wird per `put` des zusammen-
 * geführten Datensatzes, nie per `Table.update` mit `undefined` - das würde die
 * Eigenschaft löschen.
 */

const PLAN_TABLES = [db.planEntries, db.workoutSessions, db.runLogs, db.workoutTemplates] as const;

/** Die nächste freie Position am Tagesende (1, wenn der Tag leer ist). Nur innerhalb einer Transaktion über `planEntries` nutzen, die sie auch schreibt. */
export async function nextOrderInDay(date: string): Promise<number> {
  const entries = await db.planEntries.where('date').equals(date).toArray();

  return entries.reduce((max, entry) => Math.max(max, entry.orderInDay), 0) + 1;
}

/**
 * Welche der Termine belegt sind: eine laufende oder abgeschlossene Session
 * oder irgendein Lauf zeigt auf sie. Abgebrochene Sessions belegen nichts.
 */
export async function loadTakenPlanEntryIds(
  entryIds: string[],
  options: { exceptRunId?: string } = {},
): Promise<Set<string>> {
  if (entryIds.length === 0) {
    return new Set();
  }

  const [sessions, runs] = await Promise.all([
    db.workoutSessions.where('planEntryId').anyOf(entryIds).toArray(),
    db.runLogs.where('planEntryId').anyOf(entryIds).toArray(),
  ]);
  const taken = new Set<string>();

  for (const session of sessions) {
    if (session.planEntryId && session.status !== 'aborted') {
      taken.add(session.planEntryId);
    }
  }

  for (const run of runs) {
    if (run.planEntryId && run.id !== options.exceptRunId) {
      taken.add(run.planEntryId);
    }
  }

  return taken;
}

async function assertNotTaken(id: string) {
  if ((await loadTakenPlanEntryIds([id])).has(id)) {
    throw new Error(PLAN_MESSAGES.taken);
  }
}

function assertValid(values: PlanEntryValues) {
  const message = validatePlanEntryValues(values);

  if (message) {
    throw new Error(message);
  }
}

/** Der Name für Meldungen: Workout-Name bzw. getrimmter Lauftitel. */
async function displayName(values: PlanEntryValues): Promise<string> {
  if (values.kind === 'workout') {
    const template = values.templateId ? await db.workoutTemplates.get(values.templateId) : undefined;

    if (!template) {
      throw new Error(PLAN_MESSAGES.workoutNotFound);
    }

    return template.name;
  }

  return (values.title ?? '').trim();
}

async function assertNoDuplicate(values: PlanEntryValues, name: string, ignoreId?: string) {
  const key = planEntryKey(values);
  const sameDay = await db.planEntries.where('date').equals(values.date).toArray();

  if (sameDay.some((entry) => entry.id !== ignoreId && planEntryKey(entry) === key)) {
    throw new Error(PLAN_MESSAGES.duplicate(name, formatRunDate(values.date)));
  }
}

function toValues(entry: PlanEntry): PlanEntryValues {
  return {
    date: entry.date,
    kind: entry.kind,
    templateId: entry.templateId ?? null,
    title: entry.title ?? null,
    targetDistanceKm: entry.targetDistanceKm ?? null,
    targetDurationSeconds: entry.targetDurationSeconds ?? null,
    targetElevationGainM: entry.targetElevationGainM ?? null,
    targetAverageHeartRate: entry.targetAverageHeartRate ?? null,
    targetPaceSecondsPerKm: entry.targetPaceSecondsPerKm ?? null,
    instructions: entry.instructions ?? null,
    notes: entry.notes ?? null,
  };
}

/** Schreibt einen Tag dicht ab 1 neu, in der bisherigen Reihenfolge. */
export async function renumberPlanDay(date: string) {
  const entries = (await db.planEntries.where('date').equals(date).toArray()).sort(
    (a, b) => a.orderInDay - b.orderInDay,
  );

  for (const [index, entry] of entries.entries()) {
    if (entry.orderInDay !== index + 1) {
      await db.planEntries.put({ ...entry, orderInDay: index + 1 });
    }
  }
}

export async function createPlanEntry(values: PlanEntryValues, now: Date = new Date()) {
  assertValid(values);

  return db.transaction('rw', PLAN_TABLES, async () => {
    const name = await displayName(values);

    await assertNoDuplicate(values, name);

    const id = createId();
    const timestamp = now.toISOString();

    await db.planEntries.add({
      id,
      ...toPlanEntryFields(values),
      orderInDay: await nextOrderInDay(values.date),
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    return id;
  });
}

export async function updatePlanEntry(
  id: string,
  changes: Partial<PlanEntryValues>,
  now: Date = new Date(),
) {
  await db.transaction('rw', PLAN_TABLES, async () => {
    const existing = await db.planEntries.get(id);

    if (!existing) {
      throw new Error(PLAN_MESSAGES.notFound);
    }

    await assertNotTaken(id);

    const base = toValues(existing);
    const merged: PlanEntryValues = { ...base };

    for (const key of Object.keys(changes) as (keyof PlanEntryValues)[]) {
      if (changes[key] !== undefined) {
        (merged as unknown as Record<string, unknown>)[key] = changes[key];
      }
    }

    assertValid(merged);

    const name = await displayName(merged);

    await assertNoDuplicate(merged, name, id);

    const dateChanged = merged.date !== existing.date;
    const fields = toPlanEntryFields(merged);
    // Auf dem bestehenden Datensatz aufbauen, damit Felder, die diese Version
    // nicht kennt, nicht verloren gehen - Schlüssel ohne Wert fallen weg.
    const record: Record<string, unknown> = { ...existing, ...fields };

    for (const key of Object.keys(base) as (keyof PlanEntryValues)[]) {
      if (!(key in fields)) {
        delete record[key];
      }
    }

    record.orderInDay = dateChanged ? await nextOrderInDay(merged.date) : existing.orderInDay;
    record.updatedAt = now.toISOString();

    await db.planEntries.put(record as unknown as PlanEntry);

    if (dateChanged) {
      await renumberPlanDay(existing.date);
    }
  });
}

export async function deletePlanEntry(id: string) {
  await db.transaction('rw', PLAN_TABLES, async () => {
    const existing = await db.planEntries.get(id);

    if (!existing) {
      return;
    }

    await assertNotTaken(id);
    await db.planEntries.delete(id);
    await renumberPlanDay(existing.date);
  });
}

export async function movePlanEntryInDay(id: string, direction: -1 | 1) {
  await db.transaction('rw', PLAN_TABLES, async () => {
    const existing = await db.planEntries.get(id);

    if (!existing) {
      throw new Error(PLAN_MESSAGES.notFound);
    }

    await assertNotTaken(id);

    const day = (await db.planEntries.where('date').equals(existing.date).toArray()).sort(
      (a, b) => a.orderInDay - b.orderInDay,
    );
    const index = day.findIndex((entry) => entry.id === id);
    const partner = day[index + direction];

    if (!partner) {
      return;
    }

    await db.planEntries.put({ ...existing, orderInDay: partner.orderInDay });
    await db.planEntries.put({ ...partner, orderInDay: existing.orderInDay });
  });
}

export async function createPlanSeries(
  input: {
    values: Omit<PlanEntryValues, 'date'>;
    weekdays: IsoWeekday[];
    startDate: string;
    weeks: number;
  },
  now: Date = new Date(),
): Promise<{ created: number; skipped: number }> {
  assertValid({ ...input.values, date: input.startDate });

  const dates = expandSeries(input);

  return db.transaction('rw', PLAN_TABLES, async () => {
    await displayName({ ...input.values, date: input.startDate });

    const timestamp = now.toISOString();
    let created = 0;
    let skipped = 0;

    for (const date of dates) {
      const values = { ...input.values, date };
      const key = planEntryKey(values);
      const sameDay = await db.planEntries.where('date').equals(date).toArray();

      if (sameDay.some((entry) => planEntryKey(entry) === key)) {
        skipped += 1;
        continue;
      }

      await db.planEntries.add({
        id: createId(),
        ...toPlanEntryFields(values),
        orderInDay: sameDay.reduce((max, entry) => Math.max(max, entry.orderInDay), 0) + 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      created += 1;
    }

    return { created, skipped };
  });
}
