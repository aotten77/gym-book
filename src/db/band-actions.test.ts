import { describe, expect, it } from 'vitest';
import { db } from '@/db/appDb';
import {
  createBandLevel,
  deleteBandLevel,
  renameBandLevel,
  reorderBandLevels,
  seedDefaultBandLevels,
} from '@/db/band-actions';
import { updateSetLogValues } from '@/db/session-actions';
import { saveProgressionRule } from '@/db/template-actions';

/** Laufende Session mit einer Satzzeile - Grundlage der Schreibtests. */
async function createActiveSetLog(setLogId: string) {
  await db.workoutSessions.add({
    id: `session-${setLogId}`,
    templateId: 'template-band',
    templateNameSnapshot: 'Band-Einheit',
    resolvedProgramWeek: 1,
    startedAt: '2026-02-01T09:00:00.000Z',
    status: 'active',
  });

  await db.workoutSessionExercises.add({
    id: `session-exercise-${setLogId}`,
    sessionId: `session-${setLogId}`,
    exerciseId: 'exercise-band',
    exerciseNameSnapshot: 'Band Pull-Apart',
    trackingMode: 'reps_weight',
    loadKind: 'band',
    unilateral: false,
    orderIndex: 1,
    wasSkipped: false,
    addedInSession: false,
    workSetCount: 3,
  });

  await db.workoutSetLogs.add({
    id: setLogId,
    sessionExerciseId: `session-exercise-${setLogId}`,
    setKind: 'work',
    side: 'both',
    setNumber: 1,
    reps: 15,
    completed: false,
  });
}

describe('Band-Katalog', () => {
  it('hängt neue Bänder hinten an und lehnt doppelte Namen ab', async () => {
    await createBandLevel('gelb');
    await createBandLevel(' rot ');

    const bands = await db.bandLevels.orderBy('orderIndex').toArray();

    expect(bands.map((band) => [band.name, band.orderIndex])).toEqual([
      ['gelb', 1],
      ['rot', 2],
    ]);

    await expect(createBandLevel('GELB')).rejects.toThrow(/bereits/);
    await expect(createBandLevel('   ')).rejects.toThrow(/Namen/);
  });

  it('schreibt die Reihenfolge dicht und 1-basiert, lehnt Teillisten aber ab', async () => {
    const gelb = await createBandLevel('gelb');
    const rot = await createBandLevel('rot');
    const gruen = await createBandLevel('grün');

    await reorderBandLevels([gruen, gelb, rot]);

    expect((await db.bandLevels.orderBy('orderIndex').toArray()).map((band) => band.name)).toEqual([
      'grün',
      'gelb',
      'rot',
    ]);

    // Unvollständige Liste: lieber nichts tun als den halben Katalog sortieren.
    await reorderBandLevels([rot, gelb]);

    expect((await db.bandLevels.orderBy('orderIndex').toArray()).map((band) => band.name)).toEqual([
      'grün',
      'gelb',
      'rot',
    ]);
  });

  it('lässt protokollierte Sätze beim Löschen stehen und leert nur die Ziele', async () => {
    const gelb = await createBandLevel('gelb');
    const rot = await createBandLevel('rot');

    await db.workoutTemplateExercises.add({
      id: 'template-exercise-band',
      templateId: 'template-band',
      exerciseId: 'exercise-band',
      orderIndex: 1,
      workSetCount: 3,
      targetBandId: gelb,
    });

    await saveProgressionRule({
      templateExerciseId: 'template-exercise-band',
      programWeekId: 'week-1',
      targetBandId: gelb,
    });

    await createActiveSetLog('set-log-band-delete');
    await updateSetLogValues('set-log-band-delete', { bandId: gelb });

    await deleteBandLevel(gelb);

    const setLog = await db.workoutSetLogs.get('set-log-band-delete');
    expect(setLog?.bandId).toBe(gelb);
    // Der Name überlebt das Löschen - sonst stünde in der Historie nichts mehr.
    expect(setLog?.bandNameSnapshot).toBe('gelb');

    expect((await db.workoutTemplateExercises.get('template-exercise-band'))?.targetBandId).toBeUndefined();
    expect(
      (await db.progressionRules.where('templateExerciseId').equals('template-exercise-band').first())
        ?.targetBandId,
    ).toBeUndefined();

    // Nach dem Löschen bleibt die Skala lückenlos.
    expect((await db.bandLevels.orderBy('orderIndex').toArray()).map((band) => band.orderIndex)).toEqual([
      1,
    ]);
    expect(await db.bandLevels.get(rot)).toBeDefined();
  });

  it('benennt um, ohne die Historie umzuschreiben', async () => {
    const gelb = await createBandLevel('gelb');

    await createActiveSetLog('set-log-band-rename');
    await updateSetLogValues('set-log-band-rename', { bandId: gelb });

    await renameBandLevel(gelb, 'gelb (leicht)');

    expect((await db.bandLevels.get(gelb))?.name).toBe('gelb (leicht)');
    expect((await db.workoutSetLogs.get('set-log-band-rename'))?.bandNameSnapshot).toBe('gelb');
  });

  it('legt die Standardfarben nur in einen leeren Katalog', async () => {
    await seedDefaultBandLevels();
    const seeded = await db.bandLevels.count();
    expect(seeded).toBeGreaterThan(0);

    await seedDefaultBandLevels();
    expect(await db.bandLevels.count()).toBe(seeded);
  });
});

describe('updateSetLogValues mit Band', () => {
  it('setzt Id und Namen gemeinsam und leert sie gemeinsam', async () => {
    const gelb = await createBandLevel('gelb');
    await createActiveSetLog('set-log-band-write');

    await updateSetLogValues('set-log-band-write', { bandId: gelb });

    expect(await db.workoutSetLogs.get('set-log-band-write')).toMatchObject({
      bandId: gelb,
      bandNameSnapshot: 'gelb',
    });

    // Fehlender Schlüssel lässt den Wert stehen - Dexies `undefined` würde ihn
    // sonst löschen.
    await updateSetLogValues('set-log-band-write', { reps: 12 });

    expect(await db.workoutSetLogs.get('set-log-band-write')).toMatchObject({
      reps: 12,
      bandId: gelb,
      bandNameSnapshot: 'gelb',
    });

    await updateSetLogValues('set-log-band-write', { bandId: undefined });

    const cleared = await db.workoutSetLogs.get('set-log-band-write');
    expect(cleared?.bandId).toBeUndefined();
    expect(cleared?.bandNameSnapshot).toBeUndefined();
    expect(cleared?.reps).toBe(12);
  });

  it('ignoriert eine Id, die es im Katalog nicht gibt', async () => {
    const gelb = await createBandLevel('gelb');
    await createActiveSetLog('set-log-band-unknown');
    await updateSetLogValues('set-log-band-unknown', { bandId: gelb });

    await updateSetLogValues('set-log-band-unknown', { bandId: 'gibt-es-nicht' });

    expect(await db.workoutSetLogs.get('set-log-band-unknown')).toMatchObject({
      bandId: gelb,
      bandNameSnapshot: 'gelb',
    });
  });
});

describe('saveProgressionRule mit Ziel-Band', () => {
  it('behält eine Regel, die nur ein Band vorgibt', async () => {
    const rot = await createBandLevel('rot');

    await saveProgressionRule({
      templateExerciseId: 'template-exercise-1',
      programWeekId: 'week-2',
      targetBandId: rot,
    });

    const rule = await db.progressionRules.where('templateExerciseId').equals('template-exercise-1').first();

    expect(rule).toMatchObject({ targetBandId: rot });
  });

  it('löscht die Regel, wenn auch das Band wieder leer ist', async () => {
    await saveProgressionRule({
      templateExerciseId: 'template-exercise-2',
      programWeekId: 'week-2',
      targetBandId: 'band-1',
    });

    await saveProgressionRule({
      templateExerciseId: 'template-exercise-2',
      programWeekId: 'week-2',
    });

    expect(
      await db.progressionRules.where('templateExerciseId').equals('template-exercise-2').first(),
    ).toBeUndefined();
  });
});
