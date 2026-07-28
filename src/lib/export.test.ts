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

  it('rejects unsupported schema versions', () => {
    expect(() =>
      parseDatabaseSnapshot(
        JSON.stringify({
          ...createSnapshot(),
          schemaVersion: 999,
        }),
      ),
    ).toThrow(/schemaVersion/i);
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
  });
});
