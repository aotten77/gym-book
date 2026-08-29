import { describe, expect, it } from 'vitest';
import { db } from '@/db/appDb';
import { createTemplate, updateTemplate } from '@/db/template-actions';

/**
 * Die Trainingstage sind das erste Feld an `WorkoutTemplate`, das gelöscht
 * werden können muss. `Table.update` löscht jede Eigenschaft, deren Wert
 * `undefined` ist - hier wird festgehalten, wann das passieren darf und wann
 * nicht.
 */
describe('Trainingstage am Workout', () => {
  it('normalisiert die Tage beim Anlegen', async () => {
    const templateId = await createTemplate({
      name: 'Einheit A',
      scheduledWeekdays: [4, 1, 4, 9],
    });

    expect((await db.workoutTemplates.get(templateId))?.scheduledWeekdays).toEqual([1, 4]);
  });

  it('lässt die Tage stehen, wenn der Schlüssel fehlt', async () => {
    const templateId = await createTemplate({ name: 'Einheit A', scheduledWeekdays: [1, 4] });

    await updateTemplate(templateId, { name: 'Einheit A neu' });

    const stored = await db.workoutTemplates.get(templateId);

    expect(stored?.name).toBe('Einheit A neu');
    expect(stored?.scheduledWeekdays).toEqual([1, 4]);
  });

  it('löscht die Tage bei einer leeren Liste und bei null', async () => {
    const templateId = await createTemplate({ name: 'Einheit A', scheduledWeekdays: [1, 4] });

    await updateTemplate(templateId, { name: 'Einheit A', scheduledWeekdays: [] });
    expect(await hasWeekdays(templateId)).toBe(false);

    await updateTemplate(templateId, { name: 'Einheit A', scheduledWeekdays: [2] });
    expect((await db.workoutTemplates.get(templateId))?.scheduledWeekdays).toEqual([2]);

    await updateTemplate(templateId, { name: 'Einheit A', scheduledWeekdays: null });
    expect(await hasWeekdays(templateId)).toBe(false);
  });

  it('legt ein Workout ohne Tage ohne den Schlüssel an', async () => {
    const templateId = await createTemplate({ name: 'Kraftausdauer' });

    expect(await hasWeekdays(templateId)).toBe(false);
  });
});

async function hasWeekdays(templateId: string) {
  const stored = await db.workoutTemplates.get(templateId);

  return stored !== undefined && stored.scheduledWeekdays !== undefined;
}
