import { db } from '@/db/appDb';
import type { RunLog } from '@/domain/models';
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

function assertValid(values: RunLogValues, now: Date) {
  const message = validateRunLogValues(values, now);

  if (message) {
    throw new Error(message);
  }
}

export async function createRunLog(values: RunLogValues, now: Date = new Date()) {
  assertValid(values, now);

  const id = createId();
  const timestamp = now.toISOString();

  await db.runLogs.add(buildRecord(id, values, timestamp, timestamp));

  return id;
}

export async function updateRunLog(
  id: string,
  changes: Partial<RunLogValues>,
  now: Date = new Date(),
) {
  await db.transaction('rw', db.runLogs, async () => {
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

    await db.runLogs.put(buildRecord(id, merged, existing.createdAt, now.toISOString()));
  });
}

export async function deleteRunLog(id: string) {
  await db.runLogs.delete(id);
}
