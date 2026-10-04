import { describe, expect, it } from 'vitest';
import { db } from '@/db/appDb';
import { createRunLog, deleteRunLog, updateRunLog } from '@/db/run-actions';
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
