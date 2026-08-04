import { describe, expect, it } from 'vitest';
import { db } from '@/db/appDb';
import {
  type DatabaseSnapshot,
  parseDatabaseSnapshot,
  restoreDatabaseSnapshot,
  SNAPSHOT_SCHEMA_VERSION,
  summarizeDatabaseSnapshot,
} from '@/lib/export';

function createSnapshot(overrides: Partial<DatabaseSnapshot> = {}): DatabaseSnapshot {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    exportedAt: '2026-07-27T20:00:00.000Z',
    exercises: [],
    workoutTemplates: [],
    workoutTemplateExercises: [],
    workoutSessions: [],
    workoutSessionExercises: [],
    workoutSetLogs: [],
    exerciseTests: [],
    programs: [],
    programWeeks: [],
    progressionRules: [],
    mediaAssets: [],
    bandLevels: [],
    appSettings: [
      {
        id: 'app-settings',
        exportSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
        updatedAt: '2026-07-27T20:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

describe('parseDatabaseSnapshot', () => {
  it('parses a valid export and returns a compact summary', () => {
    const snapshot = parseDatabaseSnapshot(
      JSON.stringify(
        createSnapshot({
          exercises: [
            {
              id: 'exercise-1',
              name: 'Deadlift',
              trackingMode: 'reps_weight',
              unilateral: false,
              mediaAssetId: 'asset-1',
              createdAt: '2026-07-01T08:00:00.000Z',
              updatedAt: '2026-07-01T08:00:00.000Z',
            },
          ],
          workoutTemplates: [
            {
              id: 'template-1',
              name: 'Pull',
              createdAt: '2026-07-01T08:00:00.000Z',
              updatedAt: '2026-07-01T08:00:00.000Z',
            },
          ],
          workoutSessions: [
            {
              id: 'session-1',
              templateId: 'template-1',
              templateNameSnapshot: 'Pull',
              programNameSnapshot: 'Block A',
              programWeekLabelSnapshot: 'Woche 4',
              usedWeekOverride: true,
              resolvedProgramWeek: 4,
              startedAt: '2026-07-27T09:00:00.000Z',
              completedAt: '2026-07-27T10:00:00.000Z',
              status: 'completed',
            },
          ],
          workoutSessionExercises: [
            {
              id: 'session-exercise-1',
              sessionId: 'session-1',
              exerciseId: 'exercise-1',
              exerciseNameSnapshot: 'Deadlift',
              trackingMode: 'reps_weight',
              unilateral: false,
              orderIndex: 1,
              wasSkipped: false,
              addedInSession: false,
              workSetCount: 3,
            },
          ],
          workoutSetLogs: [
            {
              id: 'set-log-1',
              sessionExerciseId: 'session-exercise-1',
              setKind: 'work',
              side: 'both',
              setNumber: 1,
              reps: 5,
              weight: 140,
              completed: true,
              completedAt: '2026-07-27T09:10:00.000Z',
            },
          ],
          exerciseTests: [
            {
              id: 'test-1',
              exerciseId: 'exercise-1',
              exerciseNameSnapshot: 'Deadlift',
              recordedAt: '2026-07-27T12:00:00.000Z',
              leftValue: 0,
              rightValue: 0,
              asymmetryPercent: 0,
            },
          ],
          mediaAssets: [
            {
              id: 'asset-1',
              mimeType: 'image/jpeg',
              fileName: 'deadlift.jpg',
              byteSize: 1234,
              createdAt: '2026-07-27T12:30:00.000Z',
              blobDataUrl: 'data:image/jpeg;base64,AA==',
            },
          ] as unknown as DatabaseSnapshot['mediaAssets'],
        }),
      ),
    );

    expect(snapshot.mediaAssets[0]?.blob).toBeInstanceOf(Blob);
    expect(snapshot.workoutSessions[0]).toMatchObject({
      programNameSnapshot: 'Block A',
      programWeekLabelSnapshot: 'Woche 4',
      usedWeekOverride: true,
    });
    expect(summarizeDatabaseSnapshot(snapshot)).toEqual({
      exercises: 1,
      templates: 1,
      sessions: 1,
      setLogs: 1,
      tests: 1,
      mediaAssets: 1,
    });
  });

  it('keeps band data and accepts backups written before bands existed', () => {
    const withBands = parseDatabaseSnapshot(
      JSON.stringify(
        createSnapshot({
          bandLevels: [
            {
              id: 'band-gelb',
              name: 'gelb',
              orderIndex: 1,
              createdAt: '2026-07-01T08:00:00.000Z',
              updatedAt: '2026-07-01T08:00:00.000Z',
            },
          ],
          exercises: [
            {
              id: 'exercise-band',
              name: 'Band Pull-Apart',
              trackingMode: 'reps_weight',
              loadKind: 'band',
              unilateral: false,
              createdAt: '2026-07-01T08:00:00.000Z',
              updatedAt: '2026-07-01T08:00:00.000Z',
            },
          ],
        }),
      ),
    );

    expect(withBands.bandLevels).toHaveLength(1);
    expect(withBands.exercises[0].loadKind).toBe('band');

    // Alte Sicherungen kennen den Schlüssel nicht - sie bleiben gültig und
    // kommen mit leerem Katalog zurück. Ein Versionssprung hätte sie abgewiesen.
    const legacy = createSnapshot();
    delete (legacy as Partial<DatabaseSnapshot>).bandLevels;

    expect(parseDatabaseSnapshot(JSON.stringify(legacy)).bandLevels).toEqual([]);
  });

  it('keeps a switched-off timer sound and accepts backups written before it existed', () => {
    // Zod entfernt unbekannte Schlüssel: fehlte das Feld im Schema, käme das
    // Aus des Nutzers beim Import stillschweigend als Ein zurück.
    const withSound = parseDatabaseSnapshot(
      JSON.stringify(
        createSnapshot({
          appSettings: [
            {
              id: 'app-settings',
              timerSoundEnabled: false,
              keepScreenAwakeEnabled: false,
              exportSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
              updatedAt: '2026-07-27T20:00:00.000Z',
            },
          ],
        }),
      ),
    );

    expect(withSound.appSettings[0].timerSoundEnabled).toBe(false);
    expect(withSound.appSettings[0].keepScreenAwakeEnabled).toBe(false);

    // Ältere Sicherungen kennen die Schlüssel nicht und bleiben gültig.
    const withoutSound = parseDatabaseSnapshot(JSON.stringify(createSnapshot())).appSettings[0];

    expect(withoutSound.timerSoundEnabled).toBeUndefined();
    expect(withoutSound.keepScreenAwakeEnabled).toBeUndefined();
  });

  it('accepts a set log whose band was deleted from the catalogue', () => {
    // Kein Integritätsfehler: sonst scheiterte der Nutzer am Import seines
    // eigenen Backups, nur weil er ein Band aufgeräumt hat.
    const snapshot = parseDatabaseSnapshot(
      JSON.stringify(
        createSnapshot({
          workoutSessions: [
            {
              id: 'session-band',
              templateId: 'template-band',
              templateNameSnapshot: 'Band-Einheit',
              resolvedProgramWeek: 1,
              startedAt: '2026-07-03T09:00:00.000Z',
              status: 'completed',
            },
          ],
          workoutSessionExercises: [
            {
              id: 'session-exercise-band',
              sessionId: 'session-band',
              exerciseId: 'exercise-band',
              exerciseNameSnapshot: 'Band Pull-Apart',
              trackingMode: 'reps_weight',
              loadKind: 'band',
              unilateral: false,
              orderIndex: 1,
              wasSkipped: false,
              addedInSession: false,
              workSetCount: 3,
            },
          ],
          workoutSetLogs: [
            {
              id: 'set-log-band',
              sessionExerciseId: 'session-exercise-band',
              setKind: 'work',
              side: 'both',
              setNumber: 1,
              reps: 15,
              bandId: 'band-geloescht',
              bandNameSnapshot: 'gelb',
              completed: true,
              completedAt: '2026-07-03T09:10:00.000Z',
            },
          ],
        }),
      ),
    );

    expect(snapshot.workoutSetLogs[0].bandNameSnapshot).toBe('gelb');
  });

  it('rejects unsupported schema versions with a readable message', () => {
    expect(() =>
      parseDatabaseSnapshot(
        JSON.stringify({
          ...createSnapshot(),
          schemaVersion: 999,
        }),
      ),
    ).toThrow(/neueren App-Version/i);
  });

  it('rejects a snapshot whose references do not resolve', () => {
    expect(() =>
      parseDatabaseSnapshot(
        JSON.stringify(
          createSnapshot({
            workoutSetLogs: [
              {
                id: 'set-log-orphan',
                sessionExerciseId: 'does-not-exist',
                setKind: 'work',
                side: 'both',
                setNumber: 1,
                completed: true,
              },
            ],
          }),
        ),
      ),
    ).toThrow(/nicht schlüssig/i);
  });

  it('rejects settings pointing at a missing program', () => {
    expect(() =>
      parseDatabaseSnapshot(
        JSON.stringify(
          createSnapshot({
            appSettings: [
              {
                id: 'app-settings',
                activeProgramId: 'program-missing',
                exportSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
                updatedAt: '2026-07-27T20:00:00.000Z',
              },
            ],
          }),
        ),
      ),
    ).toThrow(/aktives Programm/i);
  });

  it('rejects media types the app cannot render', () => {
    expect(() =>
      parseDatabaseSnapshot(
        JSON.stringify(
          createSnapshot({
            mediaAssets: [
              {
                id: 'asset-video',
                mimeType: 'video/mp4',
                fileName: 'clip.mp4',
                byteSize: 10,
                createdAt: '2026-07-27T12:30:00.000Z',
              },
            ] as unknown as DatabaseSnapshot['mediaAssets'],
          }),
        ),
      ),
    ).toThrow(/nicht unterstützt/i);
  });
});

describe('restoreDatabaseSnapshot', () => {
  it('replaces the current database content with the imported snapshot', async () => {
    await db.exercises.add({
      id: 'exercise-old',
      name: 'Old Exercise',
      trackingMode: 'reps_weight',
      unilateral: false,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    });
    await db.workoutTemplates.add({
      id: 'template-old',
      name: 'Old Template',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    });

    const snapshot = createSnapshot({
      exercises: [
        {
          id: 'exercise-new',
          name: 'Bench Press',
          trackingMode: 'reps_weight',
          unilateral: false,
          createdAt: '2026-07-02T00:00:00.000Z',
          updatedAt: '2026-07-02T00:00:00.000Z',
        },
      ],
      workoutTemplates: [
        {
          id: 'template-new',
          name: 'Upper',
          createdAt: '2026-07-02T00:00:00.000Z',
          updatedAt: '2026-07-02T00:00:00.000Z',
        },
      ],
      workoutTemplateExercises: [
        {
          id: 'template-exercise-new',
          templateId: 'template-new',
          exerciseId: 'exercise-new',
          orderIndex: 1,
          workSetCount: 3,
          targetReps: 8,
        },
      ],
      workoutSessions: [
        {
          id: 'session-new',
          templateId: 'template-new',
          templateNameSnapshot: 'Upper',
          resolvedProgramWeek: 2,
          startedAt: '2026-07-03T09:00:00.000Z',
          completedAt: '2026-07-03T09:45:00.000Z',
          status: 'completed',
        },
      ],
      workoutSessionExercises: [
        {
          id: 'session-exercise-new',
          sessionId: 'session-new',
          exerciseId: 'exercise-new',
          exerciseNameSnapshot: 'Bench Press',
          trackingMode: 'reps_weight',
          unilateral: false,
          orderIndex: 1,
          wasSkipped: false,
          addedInSession: false,
          workSetCount: 3,
          targetReps: 8,
        },
      ],
      workoutSetLogs: [
        {
          id: 'set-log-new',
          sessionExerciseId: 'session-exercise-new',
          setKind: 'work',
          side: 'both',
          setNumber: 1,
          reps: 8,
          weight: 80,
          completed: true,
          completedAt: '2026-07-03T09:10:00.000Z',
        },
      ],
      appSettings: [
        {
          id: 'app-settings',
          activeProgramId: 'program-1',
          weekOverride: 3,
          exportSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
          updatedAt: '2026-07-03T10:00:00.000Z',
        },
      ],
      mediaAssets: [
        {
          id: 'asset-new',
          mimeType: 'image/png',
          fileName: 'bench.png',
          byteSize: 4,
          createdAt: '2026-07-03T10:00:00.000Z',
          blob: new Blob(['test'], { type: 'image/png' }),
        },
      ],
      bandLevels: [
        {
          id: 'band-new',
          name: 'grün',
          orderIndex: 1,
          createdAt: '2026-07-03T10:00:00.000Z',
          updatedAt: '2026-07-03T10:00:00.000Z',
        },
      ],
    });

    await restoreDatabaseSnapshot(snapshot);

    expect(await db.exercises.get('exercise-old')).toBeUndefined();
    expect(await db.workoutTemplates.get('template-old')).toBeUndefined();
    expect(await db.exercises.get('exercise-new')).toMatchObject({
      name: 'Bench Press',
    });
    expect(await db.workoutTemplates.get('template-new')).toMatchObject({
      name: 'Upper',
    });
    expect(await db.workoutSessionExercises.get('session-exercise-new')).toMatchObject({
      targetReps: 8,
      exerciseNameSnapshot: 'Bench Press',
    });
    expect(await db.workoutSetLogs.get('set-log-new')).toMatchObject({
      weight: 80,
      completed: true,
    });
    expect(await db.appSettings.get('app-settings')).toMatchObject({
      activeProgramId: 'program-1',
      weekOverride: 3,
    });
    expect(await db.mediaAssets.get('asset-new')).toMatchObject({
      fileName: 'bench.png',
      mimeType: 'image/png',
    });
    expect(await db.bandLevels.get('band-new')).toMatchObject({
      name: 'grün',
      orderIndex: 1,
    });
  });
});
