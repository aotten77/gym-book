import { describe, expect, it } from 'vitest';
import { db } from '@/db/appDb';
import {
  loadRestrictionCards,
  loadRestrictionSummaries,
  loadTemplateRestrictionView,
} from '@/db/restriction-queries';
import type { Restriction } from '@/domain/models';

const STAMP = '2026-11-24T10:00:00.000Z';
// 2026-12-05 liegt mitten in der Schonphase.
const IN_PHASE = new Date(2026, 11, 5, 12);

function restriction(overrides: Partial<Restriction> = {}): Restriction {
  return {
    id: 'r1',
    name: 'Beispiel A',
    from: '2026-12-01',
    until: '2026-12-14',
    pauses: [{ exerciseId: 'e1', replacement: { exerciseId: 'e3', workSetCount: 3 } }],
    adjustments: [
      { exerciseId: 'e2', targetWeight: 30, note: 'Nur bis Parallel' },
      { stepName: 'Taubenpose', seconds: 30 },
    ],
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

async function seed() {
  await db.exercises.bulkAdd([
    { id: 'e1', name: 'Sprungkniebeuge', trackingMode: 'reps_weight', unilateral: false, createdAt: STAMP, updatedAt: STAMP },
    { id: 'e2', name: 'Kniebeuge', trackingMode: 'reps_weight', unilateral: false, createdAt: STAMP, updatedAt: STAMP },
    { id: 'e3', name: 'Step-up', trackingMode: 'reps_weight', unilateral: false, createdAt: STAMP, updatedAt: STAMP },
  ]);
  await db.workoutTemplates.bulkAdd([
    { id: 't1', name: 'Einheit A', createdAt: STAMP, updatedAt: STAMP },
    {
      id: 'g1',
      name: 'Abendflow',
      category: 'yoga',
      steps: [
        { name: 'Tiefe Hocke', seconds: 60 },
        { name: 'Taubenpose', seconds: 45 },
      ],
      createdAt: STAMP,
      updatedAt: STAMP,
    },
  ]);
  await db.workoutTemplateExercises.bulkAdd([
    { id: 'te1', templateId: 't1', exerciseId: 'e1', orderIndex: 0, workSetCount: 3, targetReps: 8 },
    { id: 'te2', templateId: 't1', exerciseId: 'e2', orderIndex: 1, workSetCount: 3, targetWeight: 40 },
  ]);
}

describe('loadRestrictionSummaries', () => {
  it('nennt je Workout, was heute pausiert und angepasst ist', async () => {
    await seed();
    await db.restrictions.add(restriction());

    expect(await loadRestrictionSummaries(IN_PHASE)).toEqual({
      t1: '1 Übung pausiert · 1 angepasst',
      g1: '1 Schritt angepasst',
    });
  });

  it('ist ohne wirksame Einschränkung leer', async () => {
    await seed();
    await db.restrictions.add(restriction({ liftedAt: STAMP }));

    expect(await loadRestrictionSummaries(IN_PHASE)).toEqual({});
  });
});

describe('loadTemplateRestrictionView', () => {
  it('liefert die Etiketten je Zuordnung und je Schritt', async () => {
    await seed();
    await db.restrictions.add(restriction());

    const strength = await loadTemplateRestrictionView('t1', IN_PHASE);

    expect(strength.exercises.te1?.label).toBe('Pausiert bis 14.12. · Ersatz: Step-up · Beispiel A');
    expect(strength.exercises.te2).toEqual({
      kind: 'angepasst',
      label: 'Angepasst: 30 kg statt 40 · Beispiel A',
      notes: ['Nur bis Parallel'],
    });

    const guided = await loadTemplateRestrictionView('g1', IN_PHASE);

    expect(guided.steps.get(1)?.label).toBe('30 s statt 45 · Beispiel A');
  });
});

describe('loadRestrictionCards', () => {
  it('zeigt aktive und angekündigte, zählt nur lebende Ziele', async () => {
    await seed();
    await db.restrictions.bulkAdd([
      restriction({ pauses: [{ exerciseId: 'e1' }, { exerciseId: 'e1', templateId: 'weg' }] }),
      restriction({ id: 'r2', name: 'Beispiel B', from: '2026-12-10', until: undefined }),
      restriction({ id: 'r3', name: 'Alt', from: '2026-11-01', until: '2026-11-20' }),
      restriction({ id: 'r4', name: 'Aufgehoben', liftedAt: STAMP }),
    ]);

    const cards = await loadRestrictionCards(IN_PHASE);

    expect(cards.map((card) => [card.restriction.name, card.period, card.liveTargetCount])).toEqual([
      ['Beispiel A', 'bis 14.12.', 3],
      ['Beispiel B', 'ab 10.12.', 3],
    ]);
    expect(cards[0].targets[1]).toEqual({
      label: 'Pause: Sprungkniebeuge in (gibt es nicht mehr)',
      status: 'gibt es nicht mehr',
    });
  });
});
