import { db } from '@/db/appDb';

/*
 * Gemeinsame Bausteine der Schreibpfade auf `planEntries`. Einzeltermine
 * schreibt die App nicht mehr selbst: sie kommen über den Bibliothek-Import,
 * die Wochentags-Datenkorrektur und die Beispieldaten - und alle prüfen über
 * `loadTakenPlanEntryIds`, ob ein Termin schon belegt ist.
 */

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
