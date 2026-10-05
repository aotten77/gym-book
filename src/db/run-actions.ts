import { db } from '@/db/appDb';
import { loadTakenPlanEntryIds } from '@/db/plan-actions';
import type { RunLog, RunPlanSnapshot } from '@/domain/models';
import { PLAN_MESSAGES, toRunPlanSnapshot } from '@/domain/plan';
import { type RunLogValues, validateRunLogValues } from '@/domain/run';
import { createId } from '@/lib/id';

/*
 * Ein Lauf ist - anders als eine Session - nachträglich änderbar. Eine Session
 * ist ein Protokoll mit Zeitverlauf (Sätze, Timer, Snapshots) und deshalb nach
 * dem Abschluss unveränderlich; ein Lauf ist eine einzige Zeile mit Zahlen, die
 * man von der Uhr abschreibt, und ein Tippfehler dort soll sich korrigieren
 * lassen, ohne den Eintrag zu löschen und neu anzulegen.
 *
 * `null` heißt in `changes` "Feld leeren", ein fehlender Schlüssel (oder
 * `undefined`) "nicht anfassen". Geschrieben wird per `put` mit dem
 * zusammengeführten Datensatz: `Table.update` würde `undefined` als "Eigenschaft
 * löschen" lesen, und ein fehlendes optionales Feld hat genau eine Schreibweise,
 * nämlich keinen Schlüssel.
 */

function buildRecord(
  id: string,
  values: RunLogValues,
  createdAt: string,
  updatedAt: string,
): RunLog {
  const notes = values.notes?.trim();

  return {
    id,
    date: values.date,
    distanceKm: values.distanceKm,
    durationSeconds: values.durationSeconds,
    ...(values.elevationGainM !== null ? { elevationGainM: values.elevationGainM } : {}),
    ...(values.averageHeartRate !== null ? { averageHeartRate: values.averageHeartRate } : {}),
    ...(notes ? { notes } : {}),
    createdAt,
    updatedAt,
  };
}

export type RunLogInput = RunLogValues & { planEntryId?: string | null };

/**
 * Prüft den Termin, auf den ein Lauf zeigen soll, und liefert den frischen
 * Snapshot. Belegt ist er durch eine nicht abgebrochene Session oder durch
 * einen *anderen* Lauf - der Lauf, der gerade gespeichert wird, zählt nicht.
 */
async function resolvePlanLink(
  planEntryId: string,
  ownRunId: string | undefined,
): Promise<RunPlanSnapshot> {
  const entry = await db.planEntries.get(planEntryId);

  if (!entry) {
    throw new Error(PLAN_MESSAGES.notFound);
  }

  if (entry.kind !== 'run') {
    throw new Error(PLAN_MESSAGES.notRun);
  }

  if ((await loadTakenPlanEntryIds([planEntryId], { exceptRunId: ownRunId })).has(planEntryId)) {
    throw new Error(PLAN_MESSAGES.taken);
  }

  return toRunPlanSnapshot(entry);
}

function assertValid(values: RunLogValues, now: Date) {
  const message = validateRunLogValues(values, now);

  if (message) {
    throw new Error(message);
  }
}

export async function createRunLog(values: RunLogInput, now: Date = new Date()) {
  assertValid(values, now);

  const id = createId();
  const timestamp = now.toISOString();

  await db.transaction('rw', db.runLogs, db.planEntries, db.workoutSessions, async () => {
    const record = buildRecord(id, values, timestamp, timestamp);

    if (values.planEntryId) {
      record.runPlanSnapshot = await resolvePlanLink(values.planEntryId, undefined);
      record.planEntryId = values.planEntryId;
    }

    await db.runLogs.add(record);
  });

  return id;
}

export async function updateRunLog(
  id: string,
  changes: Partial<RunLogInput>,
  now: Date = new Date(),
) {
  await db.transaction('rw', db.runLogs, db.planEntries, db.workoutSessions, async () => {
    const existing = await db.runLogs.get(id);

    if (!existing) {
      throw new Error('Lauf nicht gefunden.');
    }

    const merged: RunLogValues = {
      date: changes.date ?? existing.date,
      distanceKm: changes.distanceKm ?? existing.distanceKm,
      durationSeconds: changes.durationSeconds ?? existing.durationSeconds,
      elevationGainM:
        changes.elevationGainM === undefined
          ? (existing.elevationGainM ?? null)
          : changes.elevationGainM,
      averageHeartRate:
        changes.averageHeartRate === undefined
          ? (existing.averageHeartRate ?? null)
          : changes.averageHeartRate,
      notes: changes.notes === undefined ? (existing.notes ?? null) : changes.notes,
    };

    assertValid(merged, now);

    // Auf dem bestehenden Datensatz aufbauen, damit Felder, die diese Version
    // nicht kennt, nicht verloren gehen. Das gilt nur für Schreibvorgänge dieser
    // Version auf dem Gerät: ein Restore läuft durch Zod, das Unbekanntes verwirft.
    const built = buildRecord(id, merged, existing.createdAt, now.toISOString());
    const record: Record<string, unknown> = { ...existing, ...built };

    for (const key of ['elevationGainM', 'averageHeartRate', 'notes'] as const) {
      if (!(key in built)) {
        delete record[key];
      }
    }

    // undefined = Verweis unverändert, null = lösen, id = frisch verknüpfen.
    if (changes.planEntryId === null) {
      delete record.planEntryId;
      delete record.runPlanSnapshot;
    } else if (changes.planEntryId) {
      record.runPlanSnapshot = await resolvePlanLink(changes.planEntryId, id);
      record.planEntryId = changes.planEntryId;
    }

    await db.runLogs.put(record as unknown as RunLog);
  });
}

export async function deleteRunLog(id: string) {
  await db.runLogs.delete(id);
}
