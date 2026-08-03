import { describe, expect, it } from 'vitest';
import { db } from '@/db/appDb';
import {
  loadExercisesTrainedSince,
  loadTemplateRecency,
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
