import { expect, test } from '@playwright/test';
import {
  openExerciseSheet,
  resetDatabase,
  seedSampleData,
  startSampleSession,
} from './helpers';

/*
 * Der Sprung von Feld zu Feld über der Tastatur.
 *
 * Im jsdom nicht nachstellbar: es geht um echten Fokus in echten Feldern und
 * darum, dass ein Tap auf die Leiste den Fokus im Feld *lässt* - genau das
 * entscheidet sich im Default-Verhalten des Browsers, nicht in unserer Logik.
 */
test.describe('Feldnavigation im Satz-Editor', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
    await startSampleSession(page);
    await openExerciseSheet(page);
  });

  test('springt vom ersten ins zweite Feld und wieder zurück', async ({ page }) => {
    const bar = page.locator('[data-field-nav]');
    const reps = page.locator('input[id$="-reps"]').first();
    const weight = page.locator('input[id$="-weight"]').first();

    // Ohne Fokus gibt es nichts zu navigieren - die Leiste kostet sonst nur
    // 44px im Fuß, über dem großen Knopf.
    await expect(bar).toHaveCount(0);

    await reps.click();
    await expect(bar).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Vorheriges Feld' })).toBeDisabled();

    await bar.getByRole('button', { name: 'Nächstes Feld' }).click();
    await expect(weight).toBeFocused();

    // Am letzten Feld wird nicht umgebrochen, wie in Safaris eigener Leiste.
    await expect(bar.getByRole('button', { name: 'Nächstes Feld' })).toBeDisabled();

    await bar.getByRole('button', { name: 'Vorheriges Feld' }).click();
    await expect(reps).toBeFocused();
  });

  test('"Fertig" legt die Leiste weg, der beim Sprung getippte Wert bleibt', async ({ page }) => {
    const bar = page.locator('[data-field-nav]');

    await page.locator('input[id$="-reps"]').first().fill('5');
    await bar.getByRole('button', { name: 'Nächstes Feld' }).click();

    const weight = page.locator('input[id$="-weight"]').first();
    await expect(weight).toBeFocused();
    await weight.fill('82,5');

    await bar.getByRole('button', { name: 'Tastatur schließen' }).click();
    await expect(bar).toHaveCount(0);

    // Der Fokuswechsel löst das bestehende onBlur -> persist aus; beide Werte
    // müssen also den Reload überleben.
    await page.waitForTimeout(1200);
    await page.reload();
    await page.waitForTimeout(1200);
    await openExerciseSheet(page);

    await expect(page.locator('input[id$="-reps"]').first()).toHaveValue('5');
    await expect(page.locator('input[id$="-weight"]').first()).toHaveValue('82,5');
  });

  test('der große Abhaken-Knopf bleibt neben der Leiste erreichbar', async ({ page }) => {
    await page.locator('input[id$="-reps"]').first().click();
    await expect(page.locator('[data-field-nav]')).toBeVisible();

    const complete = page.locator('[data-sheet]').getByRole('button', { name: /abhaken$/ });
    await expect(complete).toBeVisible();

    const box = await complete.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});
