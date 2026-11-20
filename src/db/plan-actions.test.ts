import { describe, expect, it } from 'vitest';
import { db } from '@/db/appDb';
import { loadTakenPlanEntryIds, nextOrderInDay, renumberPlanDay } from '@/db/plan-actions';

async function addEntry(id: string, date: string, orderInDay: number, title = id) {
  await db.planEntries.add({
    id,
    date,
    kind: 'run',
    title,
    orderInDay,
    createdAt: 'x',
    updatedAt: 'x',
  });
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

describe('Plan-Bausteine', () => {
  it('nextOrderInDay zählt pro Tag', async () => {
    await db.planEntries.bulkAdd([
      { id: 'a', date: '2026-10-05', kind: 'run', title: 'A', orderInDay: 1, createdAt: 'x', updatedAt: 'x' },
      { id: 'b', date: '2026-10-05', kind: 'run', title: 'B', orderInDay: 2, createdAt: 'x', updatedAt: 'x' },
      { id: 'c', date: '2026-10-06', kind: 'run', title: 'C', orderInDay: 1, createdAt: 'x', updatedAt: 'x' },
    ]);

    expect(await nextOrderInDay('2026-10-05')).toBe(3);
    expect(await nextOrderInDay('2026-10-06')).toBe(2);
    expect(await nextOrderInDay('2026-10-07')).toBe(1);
  });

  it('renumberPlanDay schreibt einen Tag dicht ab 1 in bisheriger Reihenfolge', async () => {
    await addEntry('a', '2026-10-05', 2);
    await addEntry('b', '2026-10-05', 5);
    await addEntry('c', '2026-10-05', 9);
    await addEntry('d', '2026-10-06', 4);

    await renumberPlanDay('2026-10-05');

    const day = (await db.planEntries.where('date').equals('2026-10-05').toArray()).sort(
      (x, y) => x.orderInDay - y.orderInDay,
    );

    expect(day.map((e) => [e.id, e.orderInDay])).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ]);
    // Andere Tage bleiben unberührt.
    expect((await db.planEntries.get('d'))?.orderInDay).toBe(4);
  });

  it('eine laufende oder abgeschlossene Session belegt den Termin, eine abgebrochene nicht', async () => {
    await addEntry('done', '2026-10-05', 1);
    await addEntry('active', '2026-10-06', 1);
    await addEntry('aborted', '2026-10-07', 1);
    await addSession('done', 'completed');
    await addSession('active', 'active');
    await addSession('aborted', 'aborted');

    expect(await loadTakenPlanEntryIds(['done', 'active', 'aborted'])).toEqual(
      new Set(['done', 'active']),
    );
    expect((await loadTakenPlanEntryIds([])).size).toBe(0);
  });

  it('ein Lauf belegt den Termin, außer er wird gerade neu gespeichert', async () => {
    await addEntry('e', '2026-10-05', 1, 'Dauerlauf');
    await db.runLogs.add({
      id: 'r1',
      date: '2026-10-05',
      distanceKm: 5,
      durationSeconds: 1500,
      planEntryId: 'e',
      createdAt: 'x',
      updatedAt: 'x',
    });

    expect(await loadTakenPlanEntryIds(['e'])).toEqual(new Set(['e']));
    expect((await loadTakenPlanEntryIds(['e'], { exceptRunId: 'r1' })).size).toBe(0);
  });
});
