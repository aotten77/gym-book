import { describe, expect, it } from 'vitest';
import { db } from '@/db/appDb';
import { abortSession, startSessionFromTemplate } from '@/db/session-actions';
import type { PlanEntry } from '@/domain/models';

const STAMP = '2026-10-01T00:00:00.000Z';

function entry(id: string, date: string, templateId: string, orderInDay = 1): PlanEntry {
  return {
    id,
    date,
    orderInDay,
    kind: 'workout',
    templateId,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

async function seed(entries: PlanEntry[]) {
  await db.exercises.add({
    id: 'ex',
    name: 'Deadlift',
    trackingMode: 'reps_weight',
    unilateral: false,
    createdAt: STAMP,
    updatedAt: STAMP,
  });

  for (const id of ['A', 'B']) {
    await db.workoutTemplates.add({ id, name: `Einheit ${id}`, createdAt: STAMP, updatedAt: STAMP });
    await db.workoutTemplateExercises.add({
      id: `te-${id}`,
      templateId: id,
      exerciseId: 'ex',
      orderIndex: 1,
      workSetCount: 2,
      targetReps: 5,
    });
  }

  await db.planEntries.bulkAdd(entries);
}

// 2026-10-05 ist ein Montag, der 08. ein Donnerstag.
const MO = new Date(2026, 9, 5, 18, 0);
const MI = new Date(2026, 9, 7, 18, 0);
const DO = new Date(2026, 9, 8, 18, 0);

describe('Session dem Termin zuordnen', () => {
  it('verknüpft den heutigen Termin', async () => {
    await seed([entry('mo', '2026-10-05', 'A'), entry('do', '2026-10-08', 'A')]);

    const id = await startSessionFromTemplate('A', { now: DO });
    const session = await db.workoutSessions.get(id);

    expect(session?.planEntryId).toBe('do');
    expect(session?.planDateSnapshot).toBe('2026-10-08');
  });

  it('nimmt sonst den frühesten offenen der Woche', async () => {
    await seed([entry('mo', '2026-10-05', 'A')]);

    const id = await startSessionFromTemplate('A', { now: MI });

    expect((await db.workoutSessions.get(id))?.planEntryId).toBe('mo');
  });

  it('ohne passenden Termin kein Verweis', async () => {
    await seed([entry('b', '2026-10-08', 'B')]);

    const id = await startSessionFromTemplate('A', { now: DO });
    const session = await db.workoutSessions.get(id);

    expect(session).toBeDefined();
    expect('planEntryId' in (session as object)).toBe(false);
    expect('planDateSnapshot' in (session as object)).toBe(false);
  });

  it('übergebene id gilt, eine belegte wird ignoriert', async () => {
    await seed([entry('do', '2026-10-08', 'A')]);

    const id = await startSessionFromTemplate('A', { planEntryId: 'do', now: MO });

    expect((await db.workoutSessions.get(id))?.planEntryId).toBe('do');
  });

  it('eine belegte übergebene id führt zum Start ohne Verweis', async () => {
    await seed([entry('do', '2026-10-08', 'A')]);
    await db.workoutSessions.add({
      id: 'old',
      templateId: 'A',
      templateNameSnapshot: 'Einheit A',
      status: 'completed',
      startedAt: STAMP,
      completedAt: STAMP,
      planEntryId: 'do',
    } as never);

    const id = await startSessionFromTemplate('A', { planEntryId: 'do', now: MO });
    const session = await db.workoutSessions.get(id);

    expect(session).toBeDefined();
    expect('planEntryId' in (session as object)).toBe(false);
  });

  it('zwei parallele Starts belegen einmal', async () => {
    await seed([entry('mo', '2026-10-05', 'A')]);

    const [first, second] = await Promise.all([
      startSessionFromTemplate('A', { now: MO }),
      startSessionFromTemplate('A', { now: MO }),
    ]);
    const linked = (await db.workoutSessions.toArray()).filter((s) => s.planEntryId === 'mo');

    expect(first).toBe(second);
    expect(await db.workoutSessions.count()).toBe(1);
    expect(linked).toHaveLength(1);
  });

  it('Abbruch gibt frei', async () => {
    await seed([entry('mo', '2026-10-05', 'A')]);

    const first = await startSessionFromTemplate('A', { now: MO });
    await abortSession(first);
    const second = await startSessionFromTemplate('A', { now: MO });

    expect(second).not.toBe(first);
    expect((await db.workoutSessions.get(second))?.planEntryId).toBe('mo');
  });
});
