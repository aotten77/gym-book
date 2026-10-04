import { expect, test, type Page } from '@playwright/test';
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

  async function enterRun(page: Page, km: string, min: string) {
    await page.getByRole('button', { name: 'Lauf eintragen' }).click();
    const sheet = page.locator('[data-sheet]');
    await sheet.getByLabel('Strecke (km)').fill(km);
    await sheet.getByLabel('Min', { exact: true }).fill(min);
    await sheet.getByRole('button', { name: 'Lauf speichern' }).click();
    await expect(sheet).toHaveCount(0);
  }

  test('zeigt den Lauf im Verlauf und auf der Detailseite', async ({ page }) => {
    await enterRun(page, '10', '52');
    await page.goto('./#/history');

    await expect(page.locator('[data-week-volume]').first()).toContainText('1 Lauf');
    await page.locator('a[href^="#/runs/"]').first().click();
    await expect(page).toHaveURL(/#\/runs\//);

    const main = page.locator('main');
    await expect(main).toContainText('10 km');
    await expect(main).toContainText('52:00');
    await expect(main).toContainText('5:12 /km');
    await expect(main).toContainText('–');
  });

  test('bearbeitet und löscht einen Lauf', async ({ page }) => {
    await enterRun(page, '10', '52');
    await page.goto('./#/history');
    await page.locator('a[href^="#/runs/"]').first().click();

    await page.getByRole('button', { name: 'Bearbeiten' }).click();
    const sheet = page.locator('[data-sheet]');
    await sheet.getByLabel('Ø Puls (bpm)').fill('150');
    await sheet.getByRole('button', { name: 'Lauf speichern' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.locator('main')).toContainText('150');

    await page.getByRole('button', { name: 'Löschen' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Löschen' }).click();
    await expect(page).toHaveURL(/#\/history/);
    await expect(page.getByRole('heading', { name: 'Läufe' })).toHaveCount(0);
  });

  test('zwei Läufe am selben Tag', async ({ page }) => {
    await enterRun(page, '10', '52');
    await enterRun(page, '5', '30');
    await page.goto('./#/history');

    await expect(page.locator('a[href^="#/runs/"]')).toHaveCount(2);
    await expect(page.locator('figure svg circle')).toHaveCount(2);
    await expect(page.locator('[data-week-volume]').first()).toContainText('2 Läufe');
  });

  test('Wochenübersicht läuft bei 320px nicht über', async ({ page }) => {
    await enterRun(page, '10', '52');
    await page.goto('./#/history');

    const weeks = page.locator('[data-week-volume]');
    await expect(weeks.first()).toBeVisible();
    const overflow = await weeks.evaluateAll((nodes) => nodes.filter((n) => n.scrollWidth > n.clientWidth).length);
    expect(overflow).toBe(0);
  });
});
