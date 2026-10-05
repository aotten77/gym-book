import { describe, expect, it } from 'vitest';
import { db } from '@/db/appDb';
import { createTemplate, deleteTemplate, updateTemplate } from '@/db/template-actions';

/* Feste Wochentage gibt es am Workout nicht mehr - Termine stehen im Plan. */
describe('Workout anlegen', () => {
  it('legt ein Workout ohne Wochentage an', async () => {
    const templateId = await createTemplate({ name: 'Einheit A' });

    expect(await db.workoutTemplates.get(templateId)).not.toHaveProperty('scheduledWeekdays');
  });
});

describe('Art des Workouts', () => {
  it('speichert Mobility und entfernt die Art bei Kraft', async () => {
    const templateId = await createTemplate({ name: 'Einheit A' });

    await updateTemplate(templateId, { name: 'Einheit A', category: 'mobility' });
    expect((await db.workoutTemplates.get(templateId))?.category).toBe('mobility');

    await updateTemplate(templateId, { name: 'Einheit A' });
    expect((await db.workoutTemplates.get(templateId))?.category).toBe('mobility');

    await updateTemplate(templateId, { name: 'Einheit A', category: 'strength' });
    expect('category' in ((await db.workoutTemplates.get(templateId)) ?? {})).toBe(false);

    await updateTemplate(templateId, { name: 'Einheit A neu' });
    expect('category' in ((await db.workoutTemplates.get(templateId)) ?? {})).toBe(false);
  });

  it('legt ein Mobility-Workout an und schreibt bei Kraft keinen Schlüssel', async () => {
    const mobility = await createTemplate({ name: 'M', category: 'mobility' });
    const strength = await createTemplate({ name: 'K', category: 'strength' });

    expect((await db.workoutTemplates.get(mobility))?.category).toBe('mobility');
    expect('category' in ((await db.workoutTemplates.get(strength)) ?? {})).toBe(false);
  });
});

describe('deleteTemplate und der Plan', () => {
  it('deleteTemplate löscht nur offene Termine', async () => {
    const templateId = await createTemplate({ name: 'Einheit A' });
    const stamp = '2026-10-05T10:00:00.000Z';

    await db.planEntries.bulkAdd([
      { id: 'offen', date: '2026-10-06', orderInDay: 1, kind: 'workout', templateId, createdAt: stamp, updatedAt: stamp },
      { id: 'erledigt', date: '2026-10-05', orderInDay: 1, kind: 'workout', templateId, createdAt: stamp, updatedAt: stamp },
    ]);
    await db.workoutSessions.add({
      id: 's1',
      templateId,
      templateNameSnapshot: 'Einheit A',
      resolvedProgramWeek: 1,
      startedAt: stamp,
      completedAt: stamp,
      status: 'completed',
      planEntryId: 'erledigt',
    });

    await deleteTemplate(templateId);

    expect((await db.planEntries.toArray()).map((e) => e.id)).toEqual(['erledigt']);
  });
});
