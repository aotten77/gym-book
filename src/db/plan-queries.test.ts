import { describe, expect, it } from 'vitest';
import { db } from '@/db/appDb';
import { loadRunDatesBetween } from '@/db/history-queries';
import { loadPlanBetween, loadRunPlanOptions, loadUpcomingPlan } from '@/db/plan-queries';
import type { PlanEntry } from '@/domain/models';

const NOW = '2026-10-01T10:00:00.000Z';

async function addEntry(
  id: string,
  date: string,
  kind: 'workout' | 'run',
  orderInDay = 1,
): Promise<void> {
  const entry: PlanEntry = {
    id,
    date,
    orderInDay,
    kind,
    ...(kind === 'workout' ? { templateId: 't1' } : { title: `Lauf ${id}` }),
    createdAt: NOW,
    updatedAt: NOW,
  };

  await db.planEntries.add(entry);
}

async function addSession(planEntryId: string, status: 'active' | 'completed' | 'aborted') {
  await db.workoutSessions.add({
    id: `s-${planEntryId}-${status}`,
    templateId: 't1',
    templateNameSnapshot: 'Einheit A',
    resolvedProgramWeek: 1,
    startedAt: NOW,
    status,
    planEntryId,
    ...(status === 'completed' ? { completedAt: NOW } : {}),
  });
}

async function addRun(id: string, date: string, planEntryId?: string) {
  await db.runLogs.add({
    id,
    date,
    distanceKm: 5,
    durationSeconds: 1800,
    ...(planEntryId ? { planEntryId } : {}),
    createdAt: NOW,
    updatedAt: NOW,
  });
}

describe('loadPlanBetween', () => {
  it('liefert Termine inklusive beider Grenzen, sortiert, mit Verweisen', async () => {
    await addEntry('d', '2026-10-08', 'workout');
    await addEntry('b', '2026-10-06', 'workout', 2);
    await addEntry('a', '2026-10-06', 'workout', 1);
    await addEntry('out', '2026-10-09', 'workout');
    await addEntry('before', '2026-10-04', 'workout');
    await addSession('a', 'completed');
    await addSession('b', 'aborted');
    await addRun('r1', '2026-10-08', 'd');

    const { entries, links } = await loadPlanBetween('2026-10-06', '2026-10-08');

    expect(entries.map((entry) => entry.id)).toEqual(['a', 'b', 'd']);
    expect(links.a?.done).toBe(true);
    expect(links.b).toBeUndefined();
    expect(links.d?.source).toBe('run');
  });
});

describe('loadUpcomingPlan', () => {
  it('beginnt heute und schließt vergangene Tage aus', async () => {
    await addEntry('past', '2026-10-04', 'workout');
    await addEntry('today', '2026-10-05', 'workout');
    await addEntry('later', '2026-11-01', 'run');

    const { entries } = await loadUpcomingPlan('2026-10-05');

    expect(entries.map((entry) => entry.id)).toEqual(['today', 'later']);
  });
});

describe('loadRunPlanOptions', () => {
  it('nennt offene Lauf-Termine der Kalenderwoche, nicht der Folgewoche, nicht belegte - außer dem eigenen', async () => {
    // Mittwoch 2026-10-07: Woche Mo 05.10. bis So 11.10.
    await addEntry('mo', '2026-10-05', 'run');
    await addEntry('so', '2026-10-11', 'run');
    await addEntry('next', '2026-10-12', 'run');
    await addEntry('prev', '2026-10-04', 'run');
    await addEntry('taken', '2026-10-06', 'run');
    await addEntry('own', '2026-10-08', 'run');
    await addEntry('workout', '2026-10-07', 'workout');
    await addRun('other', '2026-10-06', 'taken');
    await addRun('mine', '2026-10-08', 'own');

    const without = await loadRunPlanOptions('2026-10-07');
    const withOwn = await loadRunPlanOptions('2026-10-07', 'mine');

    expect(without.map((entry) => entry.id)).toEqual(['mo', 'so']);
    expect(withOwn.map((entry) => entry.id)).toEqual(['mo', 'own', 'so']);
  });
});

describe('loadRunPlanOptions, eigener Termin', () => {
  it('nimmt den verknüpften Termin auch aus einer anderen Woche mit', async () => {
    await addEntry('mo', '2026-10-05', 'run');
    await addEntry('far', '2026-10-20', 'run');
    await addRun('mine', '2026-10-07', 'far');

    const options = await loadRunPlanOptions('2026-10-07', 'mine');

    expect(options.map((entry) => entry.id)).toEqual(['mo', 'far']);
  });
});

describe('loadRunDatesBetween', () => {
  it('liefert id und Datum, inklusive der Grenzen', async () => {
    await addRun('a', '2026-10-05');
    await addRun('b', '2026-10-11');
    await addRun('c', '2026-10-12');

    const runs = await loadRunDatesBetween('2026-10-05', '2026-10-11');

    expect(runs.map((run) => run.id).sort()).toEqual(['a', 'b']);
    expect(runs[0]).toEqual({ id: expect.any(String), date: expect.any(String) });
  });
});
