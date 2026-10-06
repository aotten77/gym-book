import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { db } from '@/db/appDb';
import { bootstrapAppData } from '@/db/bootstrap';
import { startSessionFromTemplate } from '@/db/session-actions';
import {
  applyLibraryImport,
  buildLibraryImportPlan,
  listLibraryImports,
} from '@/db/library-import-actions';
import { parseLibraryImportPayload, type LibraryImportPayload } from '@/domain/library-import';
import { parseDatabaseSnapshot, SNAPSHOT_SCHEMA_VERSION } from '@/lib/export';

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
   * Eine Nutzlast in voller Größe, nicht das Minimalbeispiel der übrigen
   * Tests: 18 Übungen, zwei Workouts, 16 Zuordnungen, drei Bänder. Sie fängt,
   * was ein handgeschriebenes Minimalbeispiel nicht fängt - eine Übung, die
   * nur in den Zuordnungen vorkommt, eine Lücke in der Reihenfolge, ein
   * zweiter Lauf, der doch etwas schreibt.
   *
   * Die Datei ist aus der echten Nutzlast erzeugt, aber ohne `instructions`
   * und `notes`: die trugen medizinische Begründungen, und dieses Repo ist
   * öffentlich. Damit ist eines aufgegeben, das der Test vorher mitleistete -
   * er prüft **nicht mehr die Datei, die der Nutzer wirklich einspielt**. Ein
   * Tippfehler in der echten Nutzlast fällt jetzt erst in der Vorschau am
   * Telefon auf; die schreibt allerdings noch nichts und benennt die Zeile.
   */
  it('spielt eine vollständige Bibliotheks-Nutzlast ein', async () => {
    await seedLibrary();
    await db.workoutTemplates.add({
      id: 't2',
      name: 'Einheit A',
      createdAt: '2026-02-01T09:00:00.000Z',
      updatedAt: '2026-02-01T09:00:00.000Z',
    });

    const payload = parseLibraryImportPayload(
      readFileSync(
        resolve(process.cwd(), 'src/test/fixtures/library-import-beispiel.json'),
        'utf8',
      ),
    );

    const { plan } = await applyLibraryImport(payload, 'library-import-beispiel.json');

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

describe('applyLibraryImport - Workout ersetzen', () => {
  const REPLACE: LibraryImportPayload = parseLibraryImportPayload(
    JSON.stringify({
      schemaVersion: 1,
      exercises: [{ name: 'Klimmzug', trackingMode: 'reps_weight', unilateral: false }],
      templates: [{ name: 'Einheit B', replaceAssignments: true }],
      templateAssignments: [
        { template: 'Einheit B', exercise: 'Klimmzug', orderIndex: 1, workSetCount: 3, superset: 'A' },
        {
          template: 'Einheit B',
          exercise: 'Hip Thrust',
          orderIndex: 2,
          workSetCount: 4,
          superset: 'A',
          targetWeight: null,
        },
      ],
    }),
  );

  /** Bestand plus Programmwoche und je eine Wochenregel auf beiden Zuordnungen. */
  async function seedWithRules() {
    await seedLibrary();
    await db.workoutTemplateExercises.update('te1', { targetWeight: 80 });
    await db.programs.add({
      id: 'p1',
      name: 'Block',
      activeWeek: 1,
      createdAt: '2026-02-01T09:00:00.000Z',
      updatedAt: '2026-02-01T09:00:00.000Z',
    });
    await db.programWeeks.add({ id: 'w1', programId: 'p1', weekNumber: 1, label: 'Woche 1' });
    await db.progressionRules.bulkAdd([
      { id: 'r1', templateExerciseId: 'te1', programWeekId: 'w1', targetReps: 8 },
      { id: 'r2', templateExerciseId: 'te2', programWeekId: 'w1', targetSeconds: 10 },
    ]);
  }

  it('entfernt Zuordnungen samt ihrer Wochenregeln und lässt die anderen stehen', async () => {
    await seedWithRules();

    await applyLibraryImport(REPLACE);

    expect(await db.workoutTemplateExercises.get('te2')).toBeUndefined();
    expect(await db.progressionRules.where('templateExerciseId').equals('te2').count()).toBe(0);
    expect(await db.progressionRules.where('templateExerciseId').equals('te1').count()).toBe(1);
  });

  it('schreibt Reihenfolge und Supersätze', async () => {
    await seedWithRules();

    await applyLibraryImport(REPLACE);

    const rows = await db.workoutTemplateExercises.where('templateId').equals('t1').sortBy('orderIndex');
    const exercises = await db.exercises.toArray();
    const nameOf = (id: string) => exercises.find((exercise) => exercise.id === id)?.name;

    expect(rows.map((row) => [nameOf(row.exerciseId), row.orderIndex])).toEqual([
      ['Klimmzug', 1],
      ['Hip Thrust', 2],
    ]);
    expect(rows[0].supersetGroupId).toBeTruthy();
    expect(rows[1].supersetGroupId).toBe(rows[0].supersetGroupId);
  });

  it('löst eine Gruppe auf, ohne einen leeren Schlüssel zu hinterlassen', async () => {
    await seedWithRules();
    await applyLibraryImport(REPLACE);

    await applyLibraryImport(
      parseLibraryImportPayload(
        JSON.stringify({
          schemaVersion: 1,
          templates: [{ name: 'Einheit B', replaceAssignments: true }],
          templateAssignments: [
            { template: 'Einheit B', exercise: 'Hip Thrust', orderIndex: 1, workSetCount: 4 },
            { template: 'Einheit B', exercise: 'Klimmzug', orderIndex: 2, workSetCount: 3 },
          ],
        }),
      ),
    );

    const rows = await db.workoutTemplateExercises.where('templateId').equals('t1').toArray();

    expect(rows.every((row) => !('supersetGroupId' in row))).toBe(true);
  });

  it('leert ein Zielfeld bei null', async () => {
    await seedWithRules();

    await applyLibraryImport(REPLACE);

    const row = await db.workoutTemplateExercises.get('te1');

    expect(row && 'targetWeight' in row).toBe(false);
  });

  it('lässt eine laufende Session aus dem Workout unberührt', async () => {
    await seedWithRules();
    await bootstrapAppData();
    const sessionId = await startSessionFromTemplate('t1');
    const before = {
      sessions: await db.workoutSessions.toArray(),
      exercises: await db.workoutSessionExercises.toArray(),
      logs: await db.workoutSetLogs.toArray(),
    };

    await applyLibraryImport(REPLACE);

    expect(await db.workoutSessions.toArray()).toEqual(before.sessions);
    expect(await db.workoutSessionExercises.toArray()).toEqual(before.exercises);
    expect(await db.workoutSetLogs.toArray()).toEqual(before.logs);
    expect((await db.workoutSessions.get(sessionId))?.status).toBe('active');

    const snapshot = {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      exercises: await db.exercises.toArray(),
      workoutTemplates: await db.workoutTemplates.toArray(),
      workoutTemplateExercises: await db.workoutTemplateExercises.toArray(),
      workoutSessions: await db.workoutSessions.toArray(),
      workoutSessionExercises: await db.workoutSessionExercises.toArray(),
      workoutSetLogs: await db.workoutSetLogs.toArray(),
      exerciseTests: await db.exerciseTests.toArray(),
      programs: await db.programs.toArray(),
      programWeeks: await db.programWeeks.toArray(),
      progressionRules: await db.progressionRules.toArray(),
      mediaAssets: await db.mediaAssets.toArray(),
      appSettings: await db.appSettings.toArray(),
      bandLevels: await db.bandLevels.toArray(),
      libraryImports: await db.libraryImports.toArray(),
    };

    expect(() => parseDatabaseSnapshot(JSON.stringify(snapshot))).not.toThrow();
  });

  it('rollt alles zurück, wenn die Planung abbricht', async () => {
    await seedWithRules();
    const before = {
      assignments: await db.workoutTemplateExercises.toArray(),
      rules: await db.progressionRules.toArray(),
    };

    await expect(
      applyLibraryImport(
        parseLibraryImportPayload(
          JSON.stringify({
            schemaVersion: 1,
            templates: [{ name: 'Einheit B', replaceAssignments: true }],
            templateAssignments: [
              { template: 'Einheit B', exercise: 'Hip Thrust', orderIndex: 1, workSetCount: 4 },
              { template: 'Einheit B', exercise: 'Nordic Curl', orderIndex: 1, workSetCount: 3 },
            ],
          }),
        ),
      ),
    ).rejects.toThrow(/orderIndex 1/);

    expect(await db.workoutTemplateExercises.toArray()).toEqual(before.assignments);
    expect(await db.progressionRules.toArray()).toEqual(before.rules);
    expect(await db.libraryImports.count()).toBe(0);
  });

  it('protokolliert die Zahl entfernter Zuordnungen', async () => {
    await seedWithRules();

    const { log } = await applyLibraryImport(REPLACE, 'plan.json');

    expect(log.removedAssignments).toBe(1);
    expect((await listLibraryImports())[0].removedAssignments).toBe(1);
  });
});

describe('applyLibraryImport - Termine', () => {
  const stamp = '2026-02-01T09:00:00.000Z';

  async function seedPlan() {
    await seedLibrary();
    await db.planEntries.bulkAdd([
      // Montag: ein schon gelaufener Lauf, den die Datei nicht nennt, und Einheit B, die sie nennt.
      { id: 'p-run', date: '2026-10-05', orderInDay: 1, kind: 'run', title: 'Locker', createdAt: stamp, updatedAt: stamp },
      { id: 'p-b', date: '2026-10-05', orderInDay: 2, kind: 'workout', templateId: 't1', notes: 'früh', createdAt: stamp, updatedAt: stamp },
      // Mittwoch: offen und nicht genannt - fällt mit planRange weg.
      { id: 'p-open', date: '2026-10-07', orderInDay: 1, kind: 'workout', templateId: 't1', createdAt: stamp, updatedAt: stamp },
      // Donnerstag: belegt durch eine abgeschlossene Session - bleibt.
      { id: 'p-taken', date: '2026-10-08', orderInDay: 1, kind: 'workout', templateId: 't1', createdAt: stamp, updatedAt: stamp },
      // Außerhalb des Zeitraums.
      { id: 'p-later', date: '2026-10-20', orderInDay: 1, kind: 'workout', templateId: 't1', createdAt: stamp, updatedAt: stamp },
    ]);
    await db.workoutSessions.add({
      id: 's-taken',
      templateId: 't1',
      templateNameSnapshot: 'Einheit B',
      resolvedProgramWeek: 1,
      startedAt: '2026-10-08T09:00:00.000Z',
      completedAt: '2026-10-08T10:00:00.000Z',
      status: 'completed',
      planEntryId: 'p-taken',
    });
    await db.runLogs.add({
      id: 'run-1',
      date: '2026-10-05',
      distanceKm: 5,
      durationSeconds: 1800,
      planEntryId: 'p-run',
      createdAt: stamp,
      updatedAt: stamp,
    });
  }

  const PLAN_PAYLOAD = parseLibraryImportPayload(
    JSON.stringify({
      schemaVersion: 1,
      templates: [{ name: 'Mobility' }],
      planRange: { from: '2026-10-05', to: '2026-10-11' },
      planEntries: [
        { date: '2026-10-05', workout: 'Mobility' },
        { date: '2026-10-05', workout: 'Einheit B', notes: null },
        {
          date: '2026-10-06',
          run: { title: 'Intervalle 6×400', targetDistanceKm: 7, targetPaceSecondsPerKm: 300 },
          notes: 'Bahn',
        },
      ],
    }),
  );

  it('legt an, ändert, entfernt und nummeriert die berührten Tage dicht', async () => {
    await seedPlan();

    const { plan, log } = await applyLibraryImport(PLAN_PAYLOAD, 'plan.json');

    expect(plan.summary).toMatchObject({
      createdPlanEntries: 2,
      updatedPlanEntries: 1,
      removedPlanEntries: 1,
    });
    expect(log).toMatchObject({ createdPlanEntries: 2, updatedPlanEntries: 1, removedPlanEntries: 1 });

    const mobility = await db.workoutTemplates.where('name').equals('Mobility').first();
    const monday = await db.planEntries.where('date').equals('2026-10-05').sortBy('orderInDay');

    expect(monday.map((entry) => [entry.title ?? entry.templateId, entry.orderInDay])).toEqual([
      ['Locker', 1],
      [mobility?.id, 2],
      ['t1', 3],
    ]);
    // `null` leert - die Eigenschaft ist weg, nicht `undefined`.
    expect('notes' in (monday[2] ?? {})).toBe(false);
    expect(monday[2]?.createdAt).toBe(stamp);

    const tuesday = await db.planEntries.where('date').equals('2026-10-06').toArray();
    expect(tuesday).toHaveLength(1);
    expect(tuesday[0]).toMatchObject({
      kind: 'run',
      title: 'Intervalle 6×400',
      targetDistanceKm: 7,
      targetPaceSecondsPerKm: 300,
      notes: 'Bahn',
      orderInDay: 1,
    });

    expect(await db.planEntries.get('p-open')).toBeUndefined();
    expect(await db.planEntries.get('p-taken')).toBeDefined();
    expect(await db.planEntries.get('p-later')).toBeDefined();
  });

  it('schreibt beim zweiten Lauf nichts mehr', async () => {
    await seedPlan();
    await applyLibraryImport(PLAN_PAYLOAD);

    const before = await db.planEntries.toArray();
    const plan = await buildLibraryImportPlan(PLAN_PAYLOAD);

    expect(plan.planEntries.every((entry) => entry.kind === 'unchanged')).toBe(true);

    await applyLibraryImport(PLAN_PAYLOAD);
    expect(await db.planEntries.toArray()).toEqual(before);
  });

  it('ändert einen belegten Termin nicht, auch wenn die Datei ihn nennt', async () => {
    await seedPlan();

    const payload = parseLibraryImportPayload(
      JSON.stringify({
        schemaVersion: 1,
        planEntries: [{ date: '2026-10-08', workout: 'Einheit B', notes: 'neu' }],
      }),
    );
    const { plan } = await applyLibraryImport(payload);

    expect(plan.planEntries[0]).toMatchObject({ id: 'p-taken', kind: 'unchanged', taken: true });
    expect((await db.planEntries.get('p-taken'))?.notes).toBeUndefined();
  });

  it('lässt einen erledigten Termin bei der wiederholten Wochendatei an seinem Platz', async () => {
    await seedLibrary();

    const payload = parseLibraryImportPayload(
      JSON.stringify({
        schemaVersion: 1,
        planEntries: [
          { date: '2026-10-12', run: { title: 'Lauf' } },
          { date: '2026-10-12', workout: 'Einheit B' },
        ],
      }),
    );

    await applyLibraryImport(payload);

    const done = (await db.planEntries.where('templateId').equals('t1').toArray())[0];
    await db.workoutSessions.add({
      id: 's-done',
      templateId: 't1',
      templateNameSnapshot: 'Einheit B',
      resolvedProgramWeek: 1,
      startedAt: '2026-10-12T09:00:00.000Z',
      completedAt: '2026-10-12T10:00:00.000Z',
      status: 'completed',
      planEntryId: done?.id,
    });

    const before = await db.planEntries.toArray();
    const { plan } = await applyLibraryImport(payload);

    expect(plan.planEntries.map((entry) => [entry.kind, entry.changes])).toEqual([
      ['unchanged', []],
      ['unchanged', []],
    ]);
    expect(done?.orderInDay).toBe(2);
    expect(await db.planEntries.toArray()).toEqual(before);
  });

  it('rollt alles zurück, wenn ein Termin ungültig ist', async () => {
    await seedPlan();

    const payload = parseLibraryImportPayload(
      JSON.stringify({
        schemaVersion: 1,
        templates: [{ name: 'Mobility' }],
        planEntries: [{ date: '2026-10-05', workout: 'Einheit Z' }],
      }),
    );

    await expect(applyLibraryImport(payload)).rejects.toThrow(/Termin 1/);
    expect(await db.workoutTemplates.count()).toBe(1);
    expect(await db.planEntries.count()).toBe(5);
  });
});
