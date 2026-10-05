import { describe, expect, it } from 'vitest';
import { db } from '@/db/appDb';
import { createTemplate, updateTemplate } from '@/db/template-actions';

/*
 * Feste Wochentage gibt es am Workout nicht mehr - Termine stehen im Plan.
 * Ein umbenanntes Workout darf trotzdem nichts anderes verlieren.
 */
describe('Workout anlegen und umbenennen', () => {
  it('legt ein Workout ohne Wochentage an', async () => {
    const templateId = await createTemplate({ name: 'Einheit A' });
    const stored = await db.workoutTemplates.get(templateId);

    expect(stored?.name).toBe('Einheit A');
    expect(stored).not.toHaveProperty('scheduledWeekdays');
  });

  it('benennt um und lässt Art und Notizen konsistent', async () => {
    const templateId = await createTemplate({ name: 'Einheit A', category: 'mobility' });

    await updateTemplate(templateId, { name: 'Einheit A neu' });

    expect((await db.workoutTemplates.get(templateId))?.name).toBe('Einheit A neu');
  });
});
