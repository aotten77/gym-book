import { describe, expect, it } from 'vitest';
import { db } from '@/db/appDb';
import { liftRestriction, loadRestrictions } from '@/db/restriction-actions';
import type { Restriction } from '@/domain/models';

const STAMP = '2026-11-24T10:00:00.000Z';

const knee: Restriction = {
  id: 'r1',
  name: 'Beispiel A',
  from: '2026-12-01',
  until: '2026-12-14',
  pauses: [{ exerciseId: 'e1', replacement: { exerciseId: 'e2', workSetCount: 3 } }],
  adjustments: [{ stepName: 'Taubenpose', seconds: 30 }],
  createdAt: STAMP,
  updatedAt: STAMP,
};

describe('liftRestriction', () => {
  it('setzt liftedAt und lässt Pausen und Anpassungen stehen', async () => {
    await db.restrictions.add(knee);

    await liftRestriction('r1', new Date('2026-12-03T08:00:00.000Z'));

    expect(await db.restrictions.get('r1')).toEqual({
      ...knee,
      liftedAt: '2026-12-03T08:00:00.000Z',
      updatedAt: '2026-12-03T08:00:00.000Z',
    });
  });

  it('ändert eine schon aufgehobene nicht', async () => {
    await db.restrictions.add(knee);
    await liftRestriction('r1', new Date('2026-12-03T08:00:00.000Z'));

    await liftRestriction('r1', new Date('2026-12-04T08:00:00.000Z'));

    expect((await db.restrictions.get('r1'))?.liftedAt).toBe('2026-12-03T08:00:00.000Z');
  });

  it('wirft für eine unbekannte', async () => {
    await expect(liftRestriction('gibt-es-nicht')).rejects.toThrow('Einschränkung nicht gefunden.');
  });
});

describe('loadRestrictions', () => {
  it('liest die ganze Tabelle', async () => {
    await db.restrictions.bulkAdd([knee, { ...knee, id: 'r2', name: 'Beispiel C' }]);

    expect((await loadRestrictions()).map((restriction) => restriction.id).sort()).toEqual([
      'r1',
      'r2',
    ]);
  });
});
