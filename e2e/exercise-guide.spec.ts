import { expect, test } from '@playwright/test';
import { openExerciseSheet, resetDatabase, seedSampleData, startSampleSession } from './helpers';

/*
 * Der Block "Ausführung" im Sheet.
 *
 * Die Beispieldaten tragen für Front Squat - die erste Übung von Einheit A -
 * alles, was der Block kennt: Anleitung, Tempo und eine Workout-Notiz. Der
 * Schnitt zwischen Anleitung und Notiz ist genau das, was hier geprüft wird:
 * die eine kommt aus der Bibliothek, die andere aus der Zuordnung.
 */
test.describe('Ausführung im Sheet', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
    await startSampleSession(page);
    await openExerciseSheet(page, 'Front Squat');
  });

  test('steht zugeklappt mit der ersten Zeile und klappt auf', async ({ page }) => {
    const guide = page.locator('[data-sheet] [data-exercise-guide]').first();
    const toggle = guide.getByRole('button', { name: /Ausführung/ });
    const panel = guide.locator('[id]').last();

    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toContainText('Ellbogen hoch halten');
    await expect(panel).toBeHidden();

    // 44px, wie jedes Tippziel - der Block liegt über den Wertefeldern.
    expect((await toggle.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

    await toggle.click();

    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Ellbogen hoch halten, sauber tief, keine Grind-Reps.');
    await expect(panel).toContainText('Tempo 3-1-1');
    await expect(panel).toContainText('In diesem Workout: RPE 7-8');

    await toggle.click();
    await expect(panel).toBeHidden();
  });

  test('schiebt die Wertefelder zugeklappt nicht aus dem Bild', async ({ page }) => {
    // Zugeklappt eine Zeile: die Wertefelder müssen im Sheet ohne Scrollen
    // erreichbar bleiben, sonst hätte die Anleitung den Satz verdrängt.
    await expect(page.locator('input[id$="-reps"]').first()).toBeInViewport();
  });
});
