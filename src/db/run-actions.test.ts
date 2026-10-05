import { describe, expect, it } from 'vitest';
import { db } from '@/db/appDb';
import { createRunLog, deleteRunLog, updateRunLog } from '@/db/run-actions';
import type { PlanEntry } from '@/domain/models';
import { PLAN_MESSAGES } from '@/domain/plan';
import { loadTakenPlanEntryIds } from '@/db/plan-actions';
import type { RunLogValues } from '@/domain/run';

const NOW = new Date(2026, 9, 4, 18);

const VALUES: RunLogValues = {
  date: '2026-10-04',
  distanceKm: 7.5,
  durationSeconds: 2400,
  elevationGainM: null,
  averageHeartRate: 152,
  notes: null,
};

describe('run-actions', () => {
  it('legt einen Lauf an und lässt null-Felder weg', async () => {
    const id = await createRunLog(VALUES, NOW);
    const record = await db.runLogs.get(id);

    expect(record).toMatchObject({ distanceKm: 7.5, durationSeconds: 2400, averageHeartRate: 152 });
    expect(record && 'elevationGainM' in record).toBe(false);
    expect(record && 'notes' in record).toBe(false);
    expect(record?.createdAt).toBe(record?.updatedAt);
  });

  it('lässt unbekannte Felder beim Ändern stehen', async () => {
    const id = await createRunLog(VALUES, NOW);
    const record = await db.runLogs.get(id);
    await db.runLogs.put({ ...record, plannedEntryId: 'p1' } as never);

    await updateRunLog(id, { notes: 'x' }, NOW);

    const after = (await db.runLogs.get(id)) as unknown as Record<string, unknown>;
    expect(after.plannedEntryId).toBe('p1');
    expect(after.notes).toBe('x');
  });

  it('ändert nur übergebene Felder', async () => {
    const id = await createRunLog(VALUES, NOW);
    const before = await db.runLogs.get(id);
    await updateRunLog(id, { notes: 'zäh' }, new Date(2026, 9, 4, 19));
    const record = await db.runLogs.get(id);

    expect(record).toMatchObject({
      distanceKm: 7.5,
      durationSeconds: 2400,
      averageHeartRate: 152,
      notes: 'zäh',
    });
    expect(record?.updatedAt).not.toBe(before?.updatedAt);
  });

  it('leert den Puls mit null', async () => {
    const id = await createRunLog(VALUES, NOW);
    await updateRunLog(id, { averageHeartRate: null }, NOW);
    const record = await db.runLogs.get(id);

    expect(record && 'averageHeartRate' in record).toBe(false);
  });

  it('prüft den zusammengeführten Datensatz', async () => {
    const id = await createRunLog(VALUES, NOW);
    const before = await db.runLogs.get(id);

    await expect(updateRunLog(id, { distanceKm: 0 }, NOW)).rejects.toThrow(
      'Bitte eine Strecke über 0 km eintragen.',
    );
    expect(await db.runLogs.get(id)).toEqual(before);
  });

  it('wirft bei unbekannter Id', async () => {
    await expect(updateRunLog('gibt-es-nicht', { notes: 'x' }, NOW)).rejects.toThrow(
      'Lauf nicht gefunden.',
    );
  });

  it('wirft bei einem Datum in der Zukunft', async () => {
    await expect(createRunLog({ ...VALUES, date: '2026-10-05' }, NOW)).rejects.toThrow(
      'Ein Lauf kann nicht in der Zukunft liegen.',
    );
    expect(await db.runLogs.count()).toBe(0);
  });

  it('löscht', async () => {
    const id = await createRunLog(VALUES, NOW);
    await deleteRunLog(id);

    expect(await db.runLogs.get(id)).toBeUndefined();
  });
});

describe('run-actions: Termin zuordnen', () => {
  async function addEntry(id: string, kind: 'run' | 'workout' = 'run') {
    const entry: PlanEntry = {
      id,
      date: '2026-10-04',
      orderInDay: 1,
      kind,
      ...(kind === 'run'
        ? { title: 'Dauerlauf', targetDistanceKm: 8, instructions: 'locker' }
        : { templateId: 't1' }),
      createdAt: 'x',
      updatedAt: 'x',
    };
    await db.planEntries.add(entry);
  }

  it('verknüpft und schreibt den Snapshot', async () => {
    await addEntry('p1');
    const id = await createRunLog({ ...VALUES, planEntryId: 'p1' }, NOW);
    const record = await db.runLogs.get(id);

    expect(record?.planEntryId).toBe('p1');
    expect(record?.runPlanSnapshot).toEqual({
      title: 'Dauerlauf',
      date: '2026-10-04',
      targetDistanceKm: 8,
      instructions: 'locker',
    });
  });

  it('lehnt Workout-Termin ab', async () => {
    await addEntry('w1', 'workout');
    await expect(createRunLog({ ...VALUES, planEntryId: 'w1' }, NOW)).rejects.toThrow(
      PLAN_MESSAGES.notRun,
    );
  });

  it('lehnt unbekannten Termin ab', async () => {
    await expect(createRunLog({ ...VALUES, planEntryId: 'nope' }, NOW)).rejects.toThrow(
      PLAN_MESSAGES.notFound,
    );
  });

  it('lehnt belegten Termin ab, erlaubt aber denselben Lauf erneut', async () => {
    await addEntry('p1');
    const first = await createRunLog({ ...VALUES, planEntryId: 'p1' }, NOW);

    await expect(createRunLog({ ...VALUES, planEntryId: 'p1' }, NOW)).rejects.toThrow(
      PLAN_MESSAGES.taken,
    );
    await expect(updateRunLog(first, { notes: 'x', planEntryId: 'p1' }, NOW)).resolves.toBeUndefined();

    const other = await createRunLog(VALUES, NOW);
    await expect(updateRunLog(other, { planEntryId: 'p1' }, NOW)).rejects.toThrow(PLAN_MESSAGES.taken);
  });

  it('null löst', async () => {
    await addEntry('p1');
    const id = await createRunLog({ ...VALUES, planEntryId: 'p1' }, NOW);
    await updateRunLog(id, { planEntryId: null }, NOW);
    const record = await db.runLogs.get(id);

    expect(record && 'planEntryId' in record).toBe(false);
    expect(record && 'runPlanSnapshot' in record).toBe(false);
  });

  it('Ändern ohne planEntryId behält den Verweis', async () => {
    await addEntry('p1');
    const id = await createRunLog({ ...VALUES, planEntryId: 'p1' }, NOW);
    await updateRunLog(id, { notes: 'x' }, NOW);
    const record = await db.runLogs.get(id);

    expect(record?.planEntryId).toBe('p1');
    expect(record?.runPlanSnapshot?.title).toBe('Dauerlauf');
  });

  it('Löschen gibt frei', async () => {
    await addEntry('p1');
    const id = await createRunLog({ ...VALUES, planEntryId: 'p1' }, NOW);
    expect((await loadTakenPlanEntryIds(['p1'])).size).toBe(1);
    await deleteRunLog(id);

    expect((await loadTakenPlanEntryIds(['p1'])).size).toBe(0);
  });
});
