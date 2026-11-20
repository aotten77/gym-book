import { expect, test } from '@playwright/test';
import { closeExerciseSheet, resetDatabase, seedSampleData } from './helpers';

/*
 * Ein frischer Start öffnet das Fokus-Sheet auf dem ersten offenen Block.
 * Rückkehr und Reload öffnen es nie. Der Spec startet bewusst nicht über
 * `startSampleSession`, denn dieser Helfer schließt das Sheet wieder.
 */
test.describe('Session-Start öffnet das Fokus-Sheet', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
    await page.goto('./');
    await page.waitForTimeout(600);
    // Über das Jetzt-Sheet: im Plan steht „Einheit A“ je nach Wochentag als künftiger Termin.
    await page.getByRole('button', { name: 'Jetzt trainieren' }).click();
    await page.locator('[data-sheet]').getByRole('button', { name: 'Einheit A' }).first().click();
    await page.waitForURL(/#\/session\//);
  });

  test('ein frischer Start öffnet das Sheet auf der ersten Übung', async ({ page }) => {
    const sheet = page.locator('[data-sheet]');

    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('heading', { name: 'Front Squat' })).toBeVisible();
  });

  test('ein Reload öffnet das Sheet nicht wieder', async ({ page }) => {
    await expect(page.locator('[data-sheet]')).toBeVisible();

    await page.reload();
    await page.waitForTimeout(1000);

    await expect(page.getByRole('button', { name: 'Session minimieren' })).toBeVisible();
    await expect(page.locator('[data-sheet]')).toBeHidden();
  });

  test('die Rückkehr über den Streifen öffnet das Sheet nicht', async ({ page }) => {
    await expect(page.locator('[data-sheet]')).toBeVisible();

    await closeExerciseSheet(page);
    await page.getByRole('button', { name: 'Session minimieren' }).click();
    await page.waitForURL(/#\/$/);
    await page.getByRole('button', { name: /Training läuft/ }).click();
    await page.waitForURL(/#\/session\//);
    await page.waitForTimeout(800);

    await expect(page.getByRole('button', { name: 'Session minimieren' })).toBeVisible();
    await expect(page.locator('[data-sheet]')).toBeHidden();
  });
});
