import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { db } from '@/db/appDb';
import {
  applyLibraryImport,
  buildLibraryImportPlan,
  listLibraryImports,
} from '@/db/library-import-actions';
import { parseLibraryImportPayload, type LibraryImportPayload } from '@/domain/library-import';

const PAYLOAD: LibraryImportPayload = parseLibraryImportPayload(
  JSON.stringify({
    schemaVersion: 1,
    exercises: [
      {
        name: 'Einbeiniges RDL',
        instructions: '4 s absenken',
        trackingMode: 'reps_weight',
        unilateral: true,
      },
      { name: 'Standwaage', trackingMode: 'time', unilateral: true },
    ],
    templates: [{ name: 'Mobility (Mi, 25 min)' }],
    templateAssignments: [
      {
        template: 'Einheit B',
        exercise: 'Einbeiniges RDL',
        orderIndex: 2,
        workSetCount: 3,
        includeWarmup: false,
      },
      {
        template: 'Mobility (Mi, 25 min)',
        exercise: 'Standwaage',
        orderIndex: 1,
        workSetCount: 1,
        includeWarmup: false,
      },
    ],
    bandLevels: [{ name: 'Schwarz', orderIndex: 2 }],
  }),
);

/** Der Bestand, den der Import vorfindet: ein Workout mit zwei Übungen. */
async function seedLibrary() {
  const now = '2026-02-01T09:00:00.000Z';

  await db.exercises.bulkAdd([
    {
      id: 'e1',
      name: 'Hip Thrust',
      trackingMode: 'reps_weight',
      unilateral: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'e2',
      name: 'Nordic Curl',
      trackingMode: 'time',
      unilateral: false,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await db.workoutTemplates.add({
    id: 't1',
    name: 'Einheit B',
    createdAt: now,
    updatedAt: now,
  });

  await db.workoutTemplateExercises.bulkAdd([
    { id: 'te1', templateId: 't1', exerciseId: 'e1', orderIndex: 1, workSetCount: 4 },
    { id: 'te2', templateId: 't1', exerciseId: 'e2', orderIndex: 2, workSetCount: 3 },
  ]);

  await db.bandLevels.add({
    id: 'b1',
    name: 'Lila',
    orderIndex: 1,
    createdAt: now,
    updatedAt: now,
  });
}

describe('Bibliotheks-Import', () => {
  it('legt Übungen, Workouts, Zuordnungen und Bänder in einem Zug an', async () => {
    await seedLibrary();

    const { plan, log } = await applyLibraryImport(PAYLOAD, 'bibliothek.json');

    expect(plan.summary.createdExercises).toBe(2);
    expect(plan.summary.createdTemplates).toBe(1);
    expect(plan.summary.createdAssignments).toBe(2);
    expect(plan.summary.createdBandLevels).toBe(1);

    const exercises = await db.exercises.orderBy('name').toArray();
    expect(exercises.map((item) => item.name)).toEqual([
      'Einbeiniges RDL',
      'Hip Thrust',
      'Nordic Curl',
      'Standwaage',
    ]);

    // Die neue Übung steht auf Platz 2, der bisherige Platz 2 dahinter.
    const order = await db.workoutTemplateExercises.where('templateId').equals('t1').sortBy('orderIndex');
    expect(order.map((item) => [item.id === 'te1' || item.id === 'te2' ? item.id : 'neu', item.orderIndex])).toEqual([
      ['te1', 1],
      ['neu', 2],
      ['te2', 3],
    ]);

    const bands = await db.bandLevels.orderBy('orderIndex').toArray();
    expect(bands.map((band) => [band.name, band.orderIndex])).toEqual([
      ['Lila', 1],
      ['Schwarz', 2],
    ]);

    expect(log.sourceName).toBe('bibliothek.json');
    expect(await listLibraryImports()).toHaveLength(1);
  });

  it('erzeugt beim zweiten Lauf keine Duplikate', async () => {
    await seedLibrary();

    await applyLibraryImport(PAYLOAD);
    const { plan } = await applyLibraryImport(PAYLOAD);

    expect(plan.summary).toMatchObject({
      createdExercises: 0,
      updatedExercises: 0,
      createdTemplates: 0,
      createdAssignments: 0,
      createdBandLevels: 0,
    });

    expect(await db.exercises.count()).toBe(4);
    expect(await db.workoutTemplates.count()).toBe(2);
    expect(await db.workoutTemplateExercises.count()).toBe(4);
    expect(await db.bandLevels.count()).toBe(2);
    // Protokolliert wird trotzdem beides: die Frage "wann lief was" bleibt
    // auch dann berechtigt, wenn der Lauf nichts geändert hat.
    expect(await listLibraryImports()).toHaveLength(2);
  });

  it('aktualisiert nur die genannten Felder einer bestehenden Übung', async () => {
    await seedLibrary();
    await db.exercises.update('e2', { instructions: 'Alte Anleitung', tempo: '4-0-1' });

    const payload = parseLibraryImportPayload(
      JSON.stringify({
        schemaVersion: 1,
        exercises: [{ name: 'nordic curl', trackingMode: 'reps_weight', unilateral: false }],
      }),
    );

    await applyLibraryImport(payload);

    const exercise = await db.exercises.get('e2');
    expect(exercise?.trackingMode).toBe('reps_weight');
    expect(exercise?.instructions).toBe('Alte Anleitung');
    expect(exercise?.tempo).toBe('4-0-1');
  });

  it('schreibt nichts, wenn ein Verweis ins Leere zeigt', async () => {
    await seedLibrary();

    const payload = parseLibraryImportPayload(
      JSON.stringify({
        schemaVersion: 1,
        exercises: [{ name: 'Pallof Press', trackingMode: 'reps_weight', unilateral: true }],
        templateAssignments: [
          { template: 'Einheit C', exercise: 'Pallof Press', orderIndex: 1, workSetCount: 3 },
        ],
      }),
    );

    await expect(applyLibraryImport(payload)).rejects.toThrow(/Workout "Einheit C"/);

    // Die Übung aus derselben Datei darf nicht halb übrig bleiben.
    expect(await db.exercises.count()).toBe(2);
    expect(await listLibraryImports()).toHaveLength(0);
  });

  it('lässt das Bild einer bestehenden Übung unangetastet', async () => {
    await seedLibrary();
    await db.mediaAssets.add({
      id: 'asset-1',
      mimeType: 'image/png',
      fileName: 'nordic.png',
      byteSize: 4,
      blob: new Blob(['test'], { type: 'image/png' }),
      createdAt: '2026-02-01T09:00:00.000Z',
    });
    await db.exercises.update('e2', { mediaAssetId: 'asset-1' });

    // Die Nutzlast nennt dieselbe Übung, aber kein Bild - ein fehlender
    // Schlüssel darf keine Löschung sein.
    const payload = parseLibraryImportPayload(
      JSON.stringify({
        schemaVersion: 1,
        exercises: [{ name: 'Nordic Curl', trackingMode: 'reps_weight', unilateral: false }],
      }),
    );

    await applyLibraryImport(payload);

    expect((await db.exercises.get('e2'))?.mediaAssetId).toBe('asset-1');
    expect(await db.mediaAssets.count()).toBe(1);
  });

  it('rührt Trainingsdaten nicht an', async () => {
    await seedLibrary();
    await db.workoutSessions.add({
      id: 's1',
      templateId: 't1',
      templateNameSnapshot: 'Einheit B',
      resolvedProgramWeek: 1,
      startedAt: '2026-02-01T09:00:00.000Z',
      completedAt: '2026-02-01T10:00:00.000Z',
      status: 'completed',
    });

    await applyLibraryImport(PAYLOAD);

    expect(await db.workoutSessions.count()).toBe(1);
    expect((await db.workoutSessions.get('s1'))?.status).toBe('completed');
  });

  /*
   * Die mitgelieferte Nutzlast ist kein Beispiel, sondern die Datei, die
   * eingespielt werden soll. Ein Tippfehler darin - eine Übung, die nur in den
   * Zuordnungen vorkommt - fällt sonst erst am Telefon auf.
   */
  it('spielt die mitgelieferte Bibliotheks-Datei vollständig ein', async () => {
    await seedLibrary();
    await db.workoutTemplates.add({
      id: 't2',
      name: 'Einheit A',
      createdAt: '2026-02-01T09:00:00.000Z',
      updatedAt: '2026-02-01T09:00:00.000Z',
    });

    const payload = parseLibraryImportPayload(
      readFileSync(resolve(process.cwd(), 'docs/import/2026-08-26-bibliothek.json'), 'utf8'),
    );

    const { plan } = await applyLibraryImport(payload, '2026-08-26-bibliothek.json');

    expect(plan.summary).toMatchObject({
      createdExercises: 18,
      createdTemplates: 2,
      createdAssignments: 16,
      createdBandLevels: 3,
    });

    const mobility = await db.workoutTemplates.where('name').equals('Mobility (Mi, 25 min)').first();
    const mobilityExercises = await db.workoutTemplateExercises
      .where('templateId')
      .equals(mobility!.id)
      .sortBy('orderIndex');

    expect(mobilityExercises).toHaveLength(8);
    expect(mobilityExercises.map((item) => item.orderIndex)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    const bands = await db.bandLevels.orderBy('orderIndex').toArray();
    expect(bands.map((band) => band.name)).toEqual(['Lila', 'Schwarz', 'Grün', 'Rot']);

    // Und ein zweiter Lauf derselben Datei ändert nichts mehr.
    const { plan: second } = await applyLibraryImport(payload);
    expect(second.summary.createdExercises).toBe(0);
    expect(second.summary.createdAssignments).toBe(0);
  });

  it('plant ohne zu schreiben', async () => {
    await seedLibrary();

    const plan = await buildLibraryImportPlan(PAYLOAD);

    expect(plan.summary.createdExercises).toBe(2);
    expect(await db.exercises.count()).toBe(2);
    expect(await listLibraryImports()).toHaveLength(0);
  });
});
