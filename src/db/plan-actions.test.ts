import { describe, expect, it } from 'vitest';
import { db } from '@/db/appDb';
import {
  createPlanEntry,
  createPlanSeries,
  deletePlanEntry,
  loadTakenPlanEntryIds,
  movePlanEntryInDay,
  nextOrderInDay,
  updatePlanEntry,
} from '@/db/plan-actions';
import { createTemplate } from '@/db/template-actions';
import type { PlanEntryValues } from '@/domain/plan';
import { PLAN_MESSAGES } from '@/domain/plan';
import { formatRunDate } from '@/lib/format';

function workoutValues(templateId: string, date: string): PlanEntryValues {
  return {
    date,
    kind: 'workout',
    templateId,
    title: null,
    targetDistanceKm: null,
    targetDurationSeconds: null,
    targetElevationGainM: null,
    targetAverageHeartRate: null,
    targetPaceSecondsPerKm: null,
    instructions: null,
    notes: null,
  };
}

function runValues(title: string, date: string): PlanEntryValues {
  return { ...workoutValues('', date), kind: 'run', templateId: null, title };
}

async function addSession(planEntryId: string, status: 'active' | 'completed' | 'aborted') {
  await db.workoutSessions.add({
    id: `s-${planEntryId}-${status}`,
    templateId: 't',
    templateNameSnapshot: 'X',
    resolvedProgramWeek: 1,
    startedAt: '2026-10-05T10:00:00.000Z',
    status,
    planEntryId,
  });
}

describe('Plan-Schreib-API', () => {
  it('legt an und nummeriert pro Tag', async () => {
    const a = await createTemplate({ name: 'Einheit A' });
    const b = await createTemplate({ name: 'Einheit B' });
    const e1 = await createPlanEntry(workoutValues(a, '2026-10-05'));
    const e2 = await createPlanEntry(workoutValues(b, '2026-10-05'));
    const e3 = await createPlanEntry(workoutValues(a, '2026-10-06'));

    expect((await db.planEntries.get(e1))?.orderInDay).toBe(1);
    expect((await db.planEntries.get(e2))?.orderInDay).toBe(2);
    expect((await db.planEntries.get(e3))?.orderInDay).toBe(1);
    expect(await nextOrderInDay('2026-10-05')).toBe(3);
    expect(await nextOrderInDay('2026-12-01')).toBe(1);
  });

  it('lehnt doppelten Schlüssel ab', async () => {
    const a = await createTemplate({ name: 'Einheit A' });
    await createPlanEntry(workoutValues(a, '2026-10-05'));

    await expect(createPlanEntry(workoutValues(a, '2026-10-05'))).rejects.toThrow(
      PLAN_MESSAGES.duplicate('Einheit A', formatRunDate('2026-10-05')),
    );

    await createPlanEntry(runValues('Intervalle', '2026-10-05'));
    await expect(createPlanEntry(runValues('intervalle ', '2026-10-05'))).rejects.toThrow(
      PLAN_MESSAGES.duplicate('intervalle', formatRunDate('2026-10-05')),
    );
  });

  it('lehnt unbekanntes Workout ab', async () => {
    await expect(createPlanEntry(workoutValues('gibtsnicht', '2026-10-05'))).rejects.toThrow(
      PLAN_MESSAGES.workoutNotFound,
    );
  });

  it('ändern mit null leert', async () => {
    const id = await createPlanEntry({
      ...runValues('Dauerlauf', '2026-10-05'),
      notes: 'locker',
      targetDistanceKm: 8,
    });
    const before = await db.planEntries.get(id);

    await updatePlanEntry(id, { notes: null }, new Date('2026-10-06T10:00:00.000Z'));

    const after = await db.planEntries.get(id);

    expect(after).toBeDefined();
    expect('notes' in (after ?? {})).toBe(false);
    expect(after?.targetDistanceKm).toBe(8);
    expect(after?.title).toBe('Dauerlauf');
    expect(after?.updatedAt).not.toBe(before?.updatedAt);
  });

  it('Datumswechsel nummeriert beide Tage dicht', async () => {
    const t = await createTemplate({ name: 'Einheit A' });
    const ids: string[] = [];

    for (const title of ['L1', 'L2', 'L3']) {
      ids.push(await createPlanEntry(runValues(title, '2026-10-05')));
    }

    await createPlanEntry(runValues('Anderer', '2026-10-06'));
    await updatePlanEntry(ids[1], { date: '2026-10-06' });

    const dayA = (await db.planEntries.where('date').equals('2026-10-05').toArray()).sort(
      (x, y) => x.orderInDay - y.orderInDay,
    );
    const dayB = (await db.planEntries.where('date').equals('2026-10-06').toArray()).sort(
      (x, y) => x.orderInDay - y.orderInDay,
    );

    expect(dayA.map((e) => [e.title, e.orderInDay])).toEqual([
      ['L1', 1],
      ['L3', 2],
    ]);
    expect(dayB.map((e) => [e.title, e.orderInDay])).toEqual([
      ['Anderer', 1],
      ['L2', 2],
    ]);
    expect(t).toBeTruthy();
  });

  it('belegter Termin ist gesperrt', async () => {
    const t = await createTemplate({ name: 'Einheit A' });
    const id = await createPlanEntry(workoutValues(t, '2026-10-05'));
    await addSession(id, 'completed');

    await expect(updatePlanEntry(id, { notes: 'x' })).rejects.toThrow(PLAN_MESSAGES.taken);
    await expect(deletePlanEntry(id)).rejects.toThrow(PLAN_MESSAGES.taken);
    await expect(movePlanEntryInDay(id, 1)).rejects.toThrow(PLAN_MESSAGES.taken);
    expect(await loadTakenPlanEntryIds([id])).toEqual(new Set([id]));

    const id2 = await createPlanEntry(workoutValues(t, '2026-10-06'));
    await addSession(id2, 'aborted');

    expect((await loadTakenPlanEntryIds([id2])).size).toBe(0);
    await updatePlanEntry(id2, { notes: 'ok' });
    await deletePlanEntry(id2);
    expect(await db.planEntries.get(id2)).toBeUndefined();
  });

  it('ein Lauf belegt den Termin', async () => {
    const id = await createPlanEntry(runValues('Dauerlauf', '2026-10-05'));
    await db.runLogs.add({
      id: 'r1',
      date: '2026-10-05',
      distanceKm: 5,
      durationSeconds: 1500,
      planEntryId: id,
      createdAt: 'x',
      updatedAt: 'x',
    });

    await expect(deletePlanEntry(id)).rejects.toThrow(PLAN_MESSAGES.taken);
  });

  it('Serie überspringt Bestehendes', async () => {
    const t = await createTemplate({ name: 'Einheit A' });
    await createPlanEntry(workoutValues(t, '2026-10-08'));

    const result = await createPlanSeries({
      values: workoutValues(t, '2026-10-05'),
      weekdays: [1, 4],
      startDate: '2026-10-05',
      weeks: 2,
    });

    expect(result).toEqual({ created: 3, skipped: 1 });
    expect(await db.planEntries.count()).toBe(4);
  });

  it('move tauscht innerhalb des Tages', async () => {
    const a = await createPlanEntry(runValues('A', '2026-10-05'));
    const b = await createPlanEntry(runValues('B', '2026-10-05'));

    await movePlanEntryInDay(a, -1);
    expect((await db.planEntries.get(a))?.orderInDay).toBe(1);

    await movePlanEntryInDay(a, 1);
    expect((await db.planEntries.get(a))?.orderInDay).toBe(2);
    expect((await db.planEntries.get(b))?.orderInDay).toBe(1);

    await movePlanEntryInDay(a, 1);
    expect((await db.planEntries.get(a))?.orderInDay).toBe(2);
  });

  it('unbekannter Termin', async () => {
    await expect(updatePlanEntry('nix', {})).rejects.toThrow(PLAN_MESSAGES.notFound);
  });
});
