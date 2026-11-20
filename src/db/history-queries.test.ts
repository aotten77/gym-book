import { describe, expect, it } from 'vitest';
import { db } from '@/db/appDb';
import {
  loadActiveSessionProgress,
  loadCompletedSessionsBetween,
  loadEarliestTimelineDate,
  loadExercisesTrainedSince,
  loadRunsBetween,
  loadSyncActivitySince,
  loadSessionVolumes,
  loadTemplateExerciseCounts,
  loadTemplateMinutes,
  loadTemplateRecency,
  loadTestsBetween,
  loadWeekSummary,
  loadWeeklyVolume,
} from '@/db/history-queries';
import type { SessionStatus } from '@/domain/models';
import type { WorkoutCategory } from '@/domain/workout-category';

interface SessionSeed {
  id: string;
  templateId: string;
  status: SessionStatus;
  completedAt?: string;
  templateName?: string;
  category?: WorkoutCategory;
  planEntryId?: string;
}

async function addSession({
  id,
  templateId,
  status,
  completedAt,
  templateName,
  category,
  planEntryId,
}: SessionSeed) {
  await db.workoutSessions.add({
    id,
    templateId,
    templateNameSnapshot: templateName ?? templateId,
    resolvedProgramWeek: 1,
    startedAt: '2026-08-01T08:00:00.000Z',
    completedAt,
    status,
    ...(category ? { templateCategorySnapshot: category } : {}),
    ...(planEntryId ? { planEntryId } : {}),
  });
}

interface ExerciseSeed {
  id: string;
  sessionId: string;
  exerciseId: string;
  wasSkipped?: boolean;
}

async function addSessionExercise({ id, sessionId, exerciseId, wasSkipped }: ExerciseSeed) {
  await db.workoutSessionExercises.add({
    id,
    sessionId,
    exerciseId,
    exerciseNameSnapshot: exerciseId,
    trackingMode: 'reps_weight',
    unilateral: false,
    orderIndex: 1,
    wasSkipped: wasSkipped ?? false,
    addedInSession: false,
    workSetCount: 3,
  });
}

interface LogSeed {
  id: string;
  sessionExerciseId: string;
  weight?: number;
  reps?: number;
  completed?: boolean;
  setKind?: 'warmup' | 'work';
}

async function addSetLog({
  id,
  sessionExerciseId,
  weight,
  reps,
  completed,
  setKind,
}: LogSeed) {
  await db.workoutSetLogs.add({
    id,
    sessionExerciseId,
    setKind: setKind ?? 'work',
    side: 'both',
    setNumber: 1,
    weight,
    reps,
    completed: completed ?? true,
  });
}

describe('loadTemplateRecency', () => {
  it('keeps the latest completion per template', async () => {
    await addSession({
      id: 'session-1',
      templateId: 'template-a',
      status: 'completed',
      completedAt: '2026-07-20T10:00:00.000Z',
    });
    await addSession({
      id: 'session-2',
      templateId: 'template-a',
      status: 'completed',
      completedAt: '2026-08-01T10:00:00.000Z',
    });
    await addSession({
      id: 'session-3',
      templateId: 'template-b',
      status: 'completed',
      completedAt: '2026-07-25T10:00:00.000Z',
    });

    await expect(loadTemplateRecency()).resolves.toEqual({
      'template-a': '2026-08-01T10:00:00.000Z',
      'template-b': '2026-07-25T10:00:00.000Z',
    });
  });

  it('ignores aborted and running sessions', async () => {
    // `closeSession` setzt `completedAt` auch beim Abbruch - abgebrochen heißt
    // aber nicht trainiert, und die Heuristik dürfte das Workout sonst nie
    // wieder vorschlagen.
    await addSession({
      id: 'session-1',
      templateId: 'template-a',
      status: 'aborted',
      completedAt: '2026-08-01T10:00:00.000Z',
    });
    await addSession({ id: 'session-2', templateId: 'template-b', status: 'active' });

    await expect(loadTemplateRecency()).resolves.toEqual({});
  });
});

describe('loadWeekSummary', () => {
  it('counts sessions, sums work volume and names the latest session', async () => {
    await addSession({
      id: 'session-1',
      templateId: 'template-a',
      templateName: 'Einheit A',
      status: 'completed',
      completedAt: '2026-08-03T10:00:00.000Z',
    });
    await addSession({
      id: 'session-2',
      templateId: 'template-b',
      templateName: 'Einheit B',
      status: 'completed',
      completedAt: '2026-08-05T10:00:00.000Z',
    });
    await addSessionExercise({ id: 'se-1', sessionId: 'session-1', exerciseId: 'squat' });
    await addSessionExercise({ id: 'se-2', sessionId: 'session-2', exerciseId: 'press' });
    await addSetLog({ id: 'log-1', sessionExerciseId: 'se-1', weight: 100, reps: 5 });
    await addSetLog({ id: 'log-2', sessionExerciseId: 'se-2', weight: 60, reps: 8 });

    const summary = await loadWeekSummary('2026-08-03T00:00:00.000Z');

    expect(summary.sessionCount).toBe(2);
    expect(summary.volume).toBe(980);
    // Neueste zuerst - die Startseite liest daraus die letzte Einheit.
    expect(summary.sessions).toEqual([
      {
        id: 'session-2',
        templateId: 'template-b',
        templateName: 'Einheit B',
        completedAt: '2026-08-05T10:00:00.000Z',
      },
      {
        id: 'session-1',
        templateId: 'template-a',
        templateName: 'Einheit A',
        completedAt: '2026-08-03T10:00:00.000Z',
      },
    ]);
  });

  it('counts only completed work sets', async () => {
    await addSession({
      id: 'session-1',
      templateId: 'template-a',
      status: 'completed',
      completedAt: '2026-08-04T10:00:00.000Z',
    });
    await addSessionExercise({ id: 'se-1', sessionId: 'session-1', exerciseId: 'squat' });
    await addSetLog({ id: 'log-1', sessionExerciseId: 'se-1', weight: 100, reps: 5 });
    await addSetLog({
      id: 'log-2',
      sessionExerciseId: 'se-1',
      weight: 100,
      reps: 5,
      completed: false,
    });
    await addSetLog({
      id: 'log-3',
      sessionExerciseId: 'se-1',
      weight: 40,
      reps: 10,
      setKind: 'warmup',
    });

    await expect(loadWeekSummary('2026-08-03T00:00:00.000Z')).resolves.toMatchObject({
      sessionCount: 1,
      volume: 500,
    });
  });

  it('leaves out everything before the cutoff and everything not completed', async () => {
    await addSession({
      id: 'session-old',
      templateId: 'template-a',
      status: 'completed',
      completedAt: '2026-07-28T10:00:00.000Z',
    });
    await addSession({
      id: 'session-aborted',
      templateId: 'template-a',
      status: 'aborted',
      completedAt: '2026-08-04T10:00:00.000Z',
    });
    await addSession({ id: 'session-active', templateId: 'template-a', status: 'active' });

    await expect(loadWeekSummary('2026-08-03T00:00:00.000Z')).resolves.toEqual({
      sessionCount: 0,
      volume: 0,
      sessions: [],
    });
  });
});

describe('loadExercisesTrainedSince', () => {
  it('collects the exercises of completed sessions', async () => {
    await addSession({
      id: 'session-1',
      templateId: 'template-a',
      status: 'completed',
      completedAt: '2026-08-04T10:00:00.000Z',
    });
    await addSessionExercise({ id: 'se-1', sessionId: 'session-1', exerciseId: 'squat' });
    await addSessionExercise({ id: 'se-2', sessionId: 'session-1', exerciseId: 'press' });

    const trained = await loadExercisesTrainedSince('2026-08-03T00:00:00.000Z');

    expect([...trained].sort()).toEqual(['press', 'squat']);
  });

  it('leaves out skipped exercises and older sessions', async () => {
    await addSession({
      id: 'session-1',
      templateId: 'template-a',
      status: 'completed',
      completedAt: '2026-08-04T10:00:00.000Z',
    });
    await addSession({
      id: 'session-old',
      templateId: 'template-a',
      status: 'completed',
      completedAt: '2026-07-01T10:00:00.000Z',
    });
    await addSessionExercise({
      id: 'se-1',
      sessionId: 'session-1',
      exerciseId: 'squat',
      wasSkipped: true,
    });
    await addSessionExercise({ id: 'se-2', sessionId: 'session-old', exerciseId: 'press' });

    await expect(loadExercisesTrainedSince('2026-08-03T00:00:00.000Z')).resolves.toEqual(new Set());
  });
});

describe('loadCompletedSessionsBetween', () => {
  it('grenzt beidseitig ein und lässt abgebrochene Einheiten weg', async () => {
    await addSession({
      id: 'before',
      templateId: 'template-a',
      status: 'completed',
      completedAt: '2026-08-02T23:59:59.000Z',
    });
    await addSession({
      id: 'inside',
      templateId: 'template-a',
      status: 'completed',
      completedAt: '2026-08-04T10:00:00.000Z',
      templateName: 'Einheit A',
    });
    await addSession({
      id: 'aborted',
      templateId: 'template-b',
      status: 'aborted',
      completedAt: '2026-08-05T10:00:00.000Z',
    });
    await addSession({
      id: 'after',
      templateId: 'template-a',
      status: 'completed',
      completedAt: '2026-08-11T00:00:01.000Z',
    });

    const sessions = await loadCompletedSessionsBetween(
      '2026-08-03T00:00:00.000Z',
      '2026-08-11T00:00:00.000Z',
    );

    expect(sessions.map((session) => session.id)).toEqual(['inside']);
    expect(sessions[0].templateName).toBe('Einheit A');
  });

  it('gibt die Einheiten aufsteigend zurück', async () => {
    await addSession({
      id: 'second',
      templateId: 'template-a',
      status: 'completed',
      completedAt: '2026-08-06T10:00:00.000Z',
    });
    await addSession({
      id: 'first',
      templateId: 'template-a',
      status: 'completed',
      completedAt: '2026-08-04T10:00:00.000Z',
    });

    const sessions = await loadCompletedSessionsBetween(
      '2026-08-01T00:00:00.000Z',
      '2026-08-10T00:00:00.000Z',
    );

    expect(sessions.map((session) => session.id)).toEqual(['first', 'second']);
  });
});

describe('loadCompletedSessionsBetween: Details', () => {
  it('liefert Start, Art und Termin', async () => {
    await addSession({
      id: 'mit',
      templateId: 't',
      status: 'completed',
      completedAt: '2026-08-04T10:00:00.000Z',
      category: 'mobility',
      planEntryId: 'p1',
    });
    await addSession({
      id: 'ohne',
      templateId: 't',
      status: 'completed',
      completedAt: '2026-08-05T10:00:00.000Z',
    });

    const sessions = await loadCompletedSessionsBetween(
      '2026-08-01T00:00:00.000Z',
      '2026-08-10T00:00:00.000Z',
    );

    expect(sessions[0]).toMatchObject({
      startedAt: '2026-08-01T08:00:00.000Z',
      templateCategorySnapshot: 'mobility',
      planEntryId: 'p1',
    });
    expect(sessions[1].startedAt).toBe('2026-08-01T08:00:00.000Z');
    expect(sessions[1]).not.toHaveProperty('templateCategorySnapshot');
    expect(sessions[1]).not.toHaveProperty('planEntryId');
  });
});

describe('loadRunsBetween', () => {
  it('liefert die Läufe beider Grenztage aufsteigend', async () => {
    for (const [id, date] of [
      ['d', '2026-10-12'],
      ['b', '2026-10-05'],
      ['a', '2026-10-04'],
      ['c', '2026-10-11'],
    ]) {
      await db.runLogs.add({
        id,
        date,
        distanceKm: 5,
        durationSeconds: 1800,
        createdAt: '2026-10-01T10:00:00.000Z',
        updatedAt: '2026-10-01T10:00:00.000Z',
      });
    }

    const runs = await loadRunsBetween('2026-10-05', '2026-10-11');

    expect(runs.map((run) => run.id)).toEqual(['b', 'c']);
    expect(runs[0].distanceKm).toBe(5);
  });
});

describe('loadSessionVolumes', () => {
  it('summiert nur abgehakte Arbeitssätze von Modi mit Wiederholungen', async () => {
    await addSession({ id: 's', templateId: 't', status: 'completed', completedAt: '2026-08-04T10:00:00.000Z' });
    await addSessionExercise({ id: 'e1', sessionId: 's', exerciseId: 'x1' });
    await db.workoutSessionExercises.add({
      id: 'e2',
      sessionId: 's',
      exerciseId: 'x2',
      exerciseNameSnapshot: 'x2',
      trackingMode: 'time',
      unilateral: false,
      orderIndex: 2,
      wasSkipped: false,
      addedInSession: false,
      workSetCount: 1,
    });
    await addSetLog({ id: 'l1', sessionExerciseId: 'e1', weight: 60, reps: 5 });
    await addSetLog({ id: 'l2', sessionExerciseId: 'e1', weight: 60, reps: 5 });
    await addSetLog({ id: 'l3', sessionExerciseId: 'e1', weight: 60, reps: 5, completed: false });
    await addSetLog({ id: 'l4', sessionExerciseId: 'e1', weight: 20, reps: 10, setKind: 'warmup' });
    await db.workoutSetLogs.add({
      id: 'l5',
      sessionExerciseId: 'e2',
      setKind: 'work',
      side: 'both',
      setNumber: 1,
      weight: 20,
      seconds: 30,
      completed: true,
    });

    expect(await loadSessionVolumes(['s'])).toEqual({ s: 600 });
  });

  it('liefert für eine leere Liste ein leeres Objekt', async () => {
    expect(await loadSessionVolumes([])).toEqual({});
  });
});

describe('loadTestsBetween', () => {
  it('liefert nur die Tests im Zeitraum, mit den vier Feldern', async () => {
    await db.exerciseTests.bulkAdd([
      {
        id: 'test-old',
        exerciseId: 'hip',
        exerciseNameSnapshot: 'Hüfte',
        recordedAt: '2026-07-30T10:00:00.000Z',
        leftValue: 30,
        rightValue: 28,
        asymmetryPercent: 6.7,
      },
      {
        id: 'test-inside',
        exerciseId: 'hip',
        exerciseNameSnapshot: 'Hüfte',
        recordedAt: '2026-08-05T10:00:00.000Z',
        leftValue: 32,
        rightValue: 31,
        asymmetryPercent: 3.1,
      },
    ]);

    await expect(
      loadTestsBetween('2026-08-01T00:00:00.000Z', '2026-08-10T00:00:00.000Z'),
    ).resolves.toEqual([
      {
        id: 'test-inside',
        recordedAt: '2026-08-05T10:00:00.000Z',
        exerciseNameSnapshot: 'Hüfte',
        asymmetryPercent: 3.1,
      },
    ]);
  });
});

describe('loadWeeklyVolume', () => {
  it('loadWeeklyVolume liest Sessions und Läufe der Wochen', async () => {
    const now = new Date();
    const lastWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    const threeWeeksAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 21);
    const stamp = (date: Date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

    await addSession({
      id: 'session-1',
      templateId: 'template-a',
      status: 'completed',
      completedAt: new Date(now.getTime() - 1000).toISOString(),
    });
    await addSessionExercise({ id: 'se-1', sessionId: 'session-1', exerciseId: 'exercise-1' });
    await addSetLog({ id: 'log-1', sessionExerciseId: 'se-1', weight: 50, reps: 5 });

    const runBase = { distanceKm: 5, durationSeconds: 1800, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
    await db.runLogs.bulkAdd([
      { id: 'run-now', date: stamp(now), ...runBase },
      { id: 'run-old', date: stamp(threeWeeksAgo), ...runBase },
    ]);

    const weeks = await loadWeeklyVolume(lastWeek, now);

    expect(weeks).toHaveLength(2);
    expect(weeks[1].strength.sessions).toBe(1);
    expect(weeks[1].running.runs).toBe(1);
    expect(weeks.reduce((sum, week) => sum + week.running.runs, 0)).toBe(1);
  });
});

describe('loadSyncActivitySince', () => {
  async function seed() {
    await addSession({ id: 'old', templateId: 't', status: 'completed', completedAt: '2026-08-01T10:00:00.000Z' });
    await addSession({ id: 'new', templateId: 't', status: 'completed', completedAt: '2026-08-10T10:00:00.000Z' });
    // Abgebrochen trägt auch ein `completedAt`, zählt aber nicht als trainiert.
    await addSession({ id: 'abort', templateId: 't', status: 'aborted', completedAt: '2026-08-11T10:00:00.000Z' });
    await addSession({ id: 'live', templateId: 't', status: 'active' });
    await db.runLogs.bulkAdd(
      ['2026-08-02', '2026-08-12'].map((date) => ({
        id: `run-${date}`,
        date,
        distanceKm: 5,
        durationSeconds: 1800,
        createdAt: '2026-08-01T10:00:00.000Z',
        updatedAt: '2026-08-01T10:00:00.000Z',
      })),
    );
    await db.exerciseTests.bulkAdd(
      ['2026-08-03T10:00:00.000Z', '2026-08-13T10:00:00.000Z'].map((recordedAt, index) => ({
        id: `test-${index}`,
        exerciseId: 'hip',
        exerciseNameSnapshot: 'Hüfte',
        recordedAt,
        leftValue: 30,
        rightValue: 28,
        asymmetryPercent: 6.7,
      })),
    );
  }

  it('liefert ohne Zeitpunkt alles Abgeschlossene, ohne abgebrochene und laufende Einheiten', async () => {
    await seed();

    const activity = await loadSyncActivitySince();

    expect(activity.sessionsCompletedAt.sort()).toEqual([
      '2026-08-01T10:00:00.000Z',
      '2026-08-10T10:00:00.000Z',
    ]);
    expect(activity.runDates.sort()).toEqual(['2026-08-02', '2026-08-12']);
    expect(activity.testRecordedAt).toHaveLength(2);
  });

  it('lässt mit Zeitpunkt vorab weg, was davor liegt', async () => {
    await seed();

    const activity = await loadSyncActivitySince('2026-08-05T00:00:00.000Z');

    expect(activity.sessionsCompletedAt).toEqual(['2026-08-10T10:00:00.000Z']);
    expect(activity.runDates).toEqual(['2026-08-12']);
    expect(activity.testRecordedAt).toEqual(['2026-08-13T10:00:00.000Z']);
  });
});

describe('loadTemplateMinutes', () => {
  it('schätzt je Workout aus Zeilen und Unilateral-Flag der Übung', async () => {
    const stamp = new Date().toISOString();
    await db.exercises.bulkAdd([
      { id: 'ex1', name: 'Planke', unilateral: true, createdAt: stamp, updatedAt: stamp },
      { id: 'ex2', name: 'Dehnung', unilateral: false, createdAt: stamp, updatedAt: stamp },
    ] as never);
    await db.workoutTemplateExercises.bulkAdd([
      { id: 'r1', templateId: 't1', exerciseId: 'ex1', orderIndex: 1, workSetCount: 2, targetSeconds: 30, restSeconds: 0, includeWarmup: false },
      { id: 'r2', templateId: 't2', exerciseId: 'ex2', orderIndex: 1, workSetCount: 3, targetReps: 10, restSeconds: 60, includeWarmup: false },
    ] as never);

    // t1: 2 × (2 × 50 + 20) = 240 s; t2: 3 × 50 + 2 × 60 = 270 s; t3 hat keine Übungen und fehlt
    await db.workoutTemplates.add({ id: 't3', name: 'Leer', createdAt: stamp, updatedAt: stamp } as never);

    expect(await loadTemplateMinutes()).toEqual({ t1: 4, t2: 5 });
    expect(await loadTemplateExerciseCounts()).toEqual({ t1: 1, t2: 1 });
  });
});

describe('loadEarliestTimelineDate', () => {
  it('ist leer ohne Sessions, Läufe, Tests und Termine', async () => {
    await expect(loadEarliestTimelineDate()).resolves.toBeUndefined();
  });

  it('liefert den frühesten lokalen Tag über alle vier Tabellen; eine abgebrochene Session zählt nicht', async () => {
    await addSession({ id: 'aborted', templateId: 't1', status: 'aborted', completedAt: '2026-05-01T10:00:00.000Z' });
    await addSession({ id: 'done', templateId: 't1', status: 'completed', completedAt: '2026-08-10T10:00:00.000Z' });
    await db.runLogs.add({
      id: 'run',
      date: '2026-08-04',
      distanceKm: 5,
      durationSeconds: 1800,
      createdAt: '2026-08-04T10:00:00.000Z',
      updatedAt: '2026-08-04T10:00:00.000Z',
    });
    await db.planEntries.add({
      id: 'entry',
      date: '2026-08-07',
      orderInDay: 1,
      kind: 'workout',
      templateId: 't1',
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z',
    });

    await expect(loadEarliestTimelineDate()).resolves.toBe('2026-08-04');

    await db.exerciseTests.add({
      id: 'test',
      exerciseId: 'hip',
      exerciseNameSnapshot: 'Hüfte',
      recordedAt: '2026-07-20T10:00:00.000Z',
      leftValue: 30,
      rightValue: 28,
      asymmetryPercent: 6.7,
    });

    await expect(loadEarliestTimelineDate()).resolves.toBe('2026-07-20');

    await db.planEntries.add({
      id: 'early-entry',
      date: '2026-07-01',
      orderInDay: 1,
      kind: 'workout',
      templateId: 't1',
      createdAt: '2026-07-01T10:00:00.000Z',
      updatedAt: '2026-07-01T10:00:00.000Z',
    });

    await expect(loadEarliestTimelineDate()).resolves.toBe('2026-07-01');
  });

  it('nimmt eine abgeschlossene Session als lokalen Tag', async () => {
    await addSession({ id: 'done', templateId: 't1', status: 'completed', completedAt: '2026-08-10T10:00:00.000Z' });

    await expect(loadEarliestTimelineDate()).resolves.toBe('2026-08-10');
  });
});

describe('loadActiveSessionProgress', () => {
  it('ist leer ohne aktive Session', async () => {
    await addSession({ id: 'done', templateId: 't1', status: 'completed', completedAt: '2026-08-10T10:00:00.000Z' });

    await expect(loadActiveSessionProgress()).resolves.toBeUndefined();
  });

  it('zählt erledigte und alle Satzzeilen der aktiven Session', async () => {
    await addSession({ id: 'active', templateId: 't1', status: 'active' });
    await addSessionExercise({ id: 'se1', sessionId: 'active', exerciseId: 'ex1' });
    await addSessionExercise({ id: 'se2', sessionId: 'active', exerciseId: 'ex2' });

    for (let index = 0; index < 18; index += 1) {
      await addSetLog({
        id: `log-${index}`,
        sessionExerciseId: index < 9 ? 'se1' : 'se2',
        completed: index % 3 === 0,
      });
    }

    await expect(loadActiveSessionProgress()).resolves.toEqual({
      sessionId: 'active',
      completedCount: 6,
      totalCount: 18,
    });
  });
});
