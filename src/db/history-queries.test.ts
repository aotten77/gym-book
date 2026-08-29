import { describe, expect, it } from 'vitest';
import { db } from '@/db/appDb';
import {
  loadCompletedSessionsBetween,
  loadExercisesTrainedSince,
  loadTemplateRecency,
  loadTestDatesBetween,
  loadWeekSummary,
} from '@/db/history-queries';
import type { SessionStatus } from '@/domain/models';

interface SessionSeed {
  id: string;
  templateId: string;
  status: SessionStatus;
  completedAt?: string;
  templateName?: string;
}

async function addSession({ id, templateId, status, completedAt, templateName }: SessionSeed) {
  await db.workoutSessions.add({
    id,
    templateId,
    templateNameSnapshot: templateName ?? templateId,
    resolvedProgramWeek: 1,
    startedAt: '2026-08-01T08:00:00.000Z',
    completedAt,
    status,
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

describe('loadTestDatesBetween', () => {
  it('liefert nur die Messzeitpunkte im Zeitraum', async () => {
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
      loadTestDatesBetween('2026-08-01T00:00:00.000Z', '2026-08-10T00:00:00.000Z'),
    ).resolves.toEqual(['2026-08-05T10:00:00.000Z']);
  });
});
