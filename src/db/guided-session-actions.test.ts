import { describe, expect, it } from 'vitest';
import { db } from '@/db/appDb';
import { loadTakenPlanEntryIds } from '@/db/plan-actions';
import { completeGuidedSession, startGuidedSession } from '@/db/guided-session-actions';
import { abortSession, startSessionFromTemplate } from '@/db/session-actions';
import type { GuidedStep, PlanEntry } from '@/domain/models';

const STAMP = '2026-10-01T00:00:00.000Z';
// 2026-10-08 ist ein Donnerstag.
const DO = new Date(2026, 9, 8, 18, 0, 0);

const STEPS: GuidedStep[] = [
  { name: 'Hund', seconds: 10 },
  { name: 'Taube', seconds: 20, bothSides: true, hint: 'Hüfte sinken lassen' },
];
// 5 + 10 + 5 + 20 + 3 + 20 = 63 s.
const TOTAL_MS = 63_000;

async function seedGuided(overrides: { category?: 'yoga' | 'faszien'; steps?: GuidedStep[] } = {}) {
  await db.workoutTemplates.add({
    id: 'g',
    name: 'Abendflow',
    category: overrides.category ?? 'yoga',
    steps: overrides.steps ?? STEPS,
    createdAt: STAMP,
    updatedAt: STAMP,
  });
}

function entry(id: string, date: string, templateId = 'g', orderInDay = 1): PlanEntry {
  return { id, date, orderInDay, kind: 'workout', templateId, createdAt: STAMP, updatedAt: STAMP };
}

describe('startGuidedSession', () => {
  it('legt eine aktive Session ohne Übungen mit Schritt-Snapshot und Start-Ereignis an', async () => {
    await seedGuided();

    const id = await startGuidedSession('g', { now: DO });
    const session = await db.workoutSessions.get(id);

    expect(session).toMatchObject({
      templateId: 'g',
      templateNameSnapshot: 'Abendflow',
      templateCategorySnapshot: 'yoga',
      status: 'active',
      startedAt: DO.toISOString(),
    });
    expect(session?.guided).toEqual({
      steps: STEPS,
      events: [{ type: 'start', at: DO.getTime() }],
    });
    expect(await db.workoutSessionExercises.where('sessionId').equals(id).count()).toBe(0);
    expect(await db.workoutSetLogs.count()).toBe(0);
  });

  it('friert die Schritte ein: eine spätere Änderung der Vorlage schreibt die Session nicht um', async () => {
    await seedGuided();

    const id = await startGuidedSession('g', { now: DO });

    await db.workoutTemplates.update('g', { steps: [{ name: 'Neu', seconds: 5 }] });

    expect((await db.workoutSessions.get(id))?.guided?.steps).toEqual(STEPS);
  });

  it('verknüpft den heutigen Termin', async () => {
    await seedGuided();
    await db.planEntries.bulkAdd([entry('mo', '2026-10-05'), entry('do', '2026-10-08')]);

    const id = await startGuidedSession('g', { now: DO });
    const session = await db.workoutSessions.get(id);

    expect(session?.planEntryId).toBe('do');
    expect(session?.planDateSnapshot).toBe('2026-10-08');
  });

  it('nimmt den gewünschten offenen Termin', async () => {
    await seedGuided();
    await db.planEntries.bulkAdd([entry('mo', '2026-10-05'), entry('do', '2026-10-08')]);

    const id = await startGuidedSession('g', { now: DO, planEntryId: 'mo' });

    expect((await db.workoutSessions.get(id))?.planEntryId).toBe('mo');
  });

  it('schreibt ohne Termin keinen Plan-Schlüssel', async () => {
    await seedGuided();

    const id = await startGuidedSession('g', { now: DO });
    const session = await db.workoutSessions.get(id);

    expect(session).not.toHaveProperty('planEntryId');
    expect(session).not.toHaveProperty('planDateSnapshot');
  });

  it('startet keine zweite Session, wenn schon eine läuft', async () => {
    await seedGuided();

    const first = await startGuidedSession('g', { now: DO });
    const second = await startGuidedSession('g', { now: DO });

    expect(second).toBe(first);
    expect(await db.workoutSessions.count()).toBe(1);
  });

  it('startet auch dann keine, wenn eine Kraft-Session läuft', async () => {
    await seedGuided();
    await db.exercises.add({
      id: 'ex',
      name: 'Deadlift',
      trackingMode: 'reps_weight',
      unilateral: false,
      createdAt: STAMP,
      updatedAt: STAMP,
    });
    await db.workoutTemplates.add({ id: 's', name: 'Kraft', createdAt: STAMP, updatedAt: STAMP });
    await db.workoutTemplateExercises.add({
      id: 'te',
      templateId: 's',
      exerciseId: 'ex',
      orderIndex: 1,
      workSetCount: 1,
    });

    const strength = await startSessionFromTemplate('s');
    const result = await startGuidedSession('g', { now: DO });

    expect(result).toBe(strength);
    expect(await db.workoutSessions.count()).toBe(1);
  });

  it('lehnt zwei gleichzeitige Starts ab: es entsteht genau eine Session', async () => {
    await seedGuided();

    const [a, b] = await Promise.all([
      startGuidedSession('g', { now: DO }),
      startGuidedSession('g', { now: DO }),
    ]);

    expect(a).toBe(b);
    expect(await db.workoutSessions.count()).toBe(1);
  });

  it('weigert sich bei einer Vorlage ohne Schritte', async () => {
    await db.workoutTemplates.add({ id: 'k', name: 'Kraft', createdAt: STAMP, updatedAt: STAMP });

    await expect(startGuidedSession('k')).rejects.toThrow(/keine geführte Vorlage/);
    await expect(startGuidedSession('fehlt')).rejects.toThrow(/nicht gefunden/);
  });
});

describe('completeGuidedSession', () => {
  it('schließt am rechnerischen Ende ab, auch wenn die Seite später zurückkehrt', async () => {
    await seedGuided();
    await db.planEntries.add(entry('do', '2026-10-08'));

    const id = await startGuidedSession('g', { now: DO });
    const done = await completeGuidedSession(id, new Date(DO.getTime() + TOTAL_MS + 5 * 60_000));
    const session = await db.workoutSessions.get(id);

    expect(done).toBe(true);
    expect(session?.status).toBe('completed');
    expect(session?.completedAt).toBe(new Date(DO.getTime() + TOTAL_MS).toISOString());
    expect(session?.guided?.steps).toEqual(STEPS);
  });

  it('macht vor dem Ende nichts', async () => {
    await seedGuided();

    const id = await startGuidedSession('g', { now: DO });
    const done = await completeGuidedSession(id, new Date(DO.getTime() + TOTAL_MS - 1000));

    expect(done).toBe(false);
    expect((await db.workoutSessions.get(id))?.status).toBe('active');
  });

  it('überschreibt den Abschluss bei einem zweiten Aufruf nicht', async () => {
    await seedGuided();

    const id = await startGuidedSession('g', { now: DO });

    await completeGuidedSession(id, new Date(DO.getTime() + TOTAL_MS));
    const completedAt = (await db.workoutSessions.get(id))?.completedAt;

    expect(await completeGuidedSession(id, new Date(DO.getTime() + TOTAL_MS + 60_000))).toBe(false);
    expect((await db.workoutSessions.get(id))?.completedAt).toBe(completedAt);
  });

  it('lässt eine abgebrochene Session abgebrochen', async () => {
    await seedGuided();

    const id = await startGuidedSession('g', { now: DO });

    await abortSession(id);

    expect(await completeGuidedSession(id, new Date(DO.getTime() + TOTAL_MS))).toBe(false);
    expect((await db.workoutSessions.get(id))?.status).toBe('aborted');
  });

  it('belegt den Termin im Lauf und nach dem Abschluss', async () => {
    await seedGuided();
    await db.planEntries.add(entry('do', '2026-10-08'));

    const id = await startGuidedSession('g', { now: DO });

    expect((await loadTakenPlanEntryIds(['do'])).has('do')).toBe(true);

    await completeGuidedSession(id, new Date(DO.getTime() + TOTAL_MS));

    expect((await loadTakenPlanEntryIds(['do'])).has('do')).toBe(true);
    expect((await db.workoutSessions.get(id))?.planEntryId).toBe('do');
  });

  it('wirft bei einer fremden Id', async () => {
    await expect(completeGuidedSession('fehlt')).rejects.toThrow(/nicht gefunden/);
  });

  it('ignoriert eine Kraft-Session', async () => {
    await db.workoutSessions.add({
      id: 'x',
      templateId: 't',
      templateNameSnapshot: 'Kraft',
      resolvedProgramWeek: 1,
      startedAt: STAMP,
      status: 'active',
    });

    expect(await completeGuidedSession('x')).toBe(false);
    expect((await db.workoutSessions.get('x'))?.status).toBe('active');
  });
});
