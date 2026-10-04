import { expect, test } from '@playwright/test';
import { resetDatabase } from './helpers';

/*
 * Ein Lauf über Heute: Sheet, Pace-Zeile, Sprung über die Tastaturleiste.
 * Fokus und Tastaturleiste lassen sich nur im echten Browser prüfen.
 */
test.describe('Lauf eintragen', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await page.goto('./');
  });

  test('trägt einen Lauf über Heute ein', async ({ page }) => {
    await page.getByRole('button', { name: 'Lauf eintragen' }).click();

    const sheet = page.locator('[data-sheet]');
    await expect(sheet).toBeVisible();

    await sheet.getByLabel('Strecke (km)').fill('10');
    await sheet.getByLabel('Min', { exact: true }).fill('52');
    await expect(sheet.locator('[data-run-pace]')).toContainText('5:12 /km');

    // Über die Tastaturleiste von Strecke zurück zu Std springen.
    await sheet.getByLabel('Strecke (km)').click();
    await page.locator('[data-field-nav]').getByRole('button', { name: 'Nächstes Feld' }).click();
    await expect(sheet.getByLabel('Std', { exact: true })).toBeFocused();

    await sheet.getByRole('button', { name: 'Lauf speichern' }).click();
    await expect(sheet).toHaveCount(0);

    const body = page.locator('main');
    await expect(body).toContainText('1 Lauf');
    await expect(body).toContainText('10 km');
  });

  test('sperrt Speichern ohne Dauer', async ({ page }) => {
    await page.getByRole('button', { name: 'Lauf eintragen' }).click();
    const sheet = page.locator('[data-sheet]');

    await sheet.getByLabel('Strecke (km)').fill('10');
    await expect(sheet.getByRole('button', { name: 'Lauf speichern' })).toBeDisabled();
  });

  test('zeigt den Fehler bei Minuten über 59', async ({ page }) => {
    await page.getByRole('button', { name: 'Lauf eintragen' }).click();
    const sheet = page.locator('[data-sheet]');

    const minutes = sheet.getByLabel('Min', { exact: true });
    await minutes.fill('75');
    await minutes.blur();
    await expect(sheet).toContainText('0–59');
  });
});
