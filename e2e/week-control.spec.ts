import { expect, test } from '@playwright/test';
import { resetDatabase, seedSampleData } from './helpers';

/*
 * Home und Settings hatten vor der Konsolidierung auf resolveWeekControl je
 * eine eigene maxWeek-Formel - bei einem Override oberhalb der höchsten
 * Programmwoche konnten beide Seiten unterschiedliche Werte zeigen. Diese
 * Tests fangen genau diese Divergenz ab, nicht nur die einzelne Seite.
 *
 * Geschrieben wird ausschließlich in den Einstellungen. Der Plan liest nur:
 * eine von Hand gesetzte Woche nennt er in einer Kopfzeile, sonst steht dort
 * nichts.
 */
test.describe('Wochensteuerung', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
  });

  test('ein in den Einstellungen gesetzter Override erscheint identisch auf der Startseite', async ({
    page,
  }) => {
    await page.goto('./#/settings');
    await page.waitForTimeout(900);

    await page.getByRole('switch', { name: 'Woche von Hand setzen' }).click();
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'Override-Woche vor' }).click();
    await page.waitForTimeout(600);

    await expect(page.getByText('Override', { exact: true })).toBeVisible();

    const settingsWeekLabel = await page
      .getByText(/^W\d+$/)
      .first()
      .textContent();

    expect(settingsWeekLabel).toMatch(/^W\d+$/);

    await page.goto('./');
    await page.waitForTimeout(900);

    const override = page.locator('[data-week-override]');
    await expect(override).toContainText(`Woche von Hand gesetzt: ${settingsWeekLabel}`);
    await expect(override.getByRole('link', { name: 'Einstellungen' })).toHaveAttribute('href', '#/settings');
  });

  test('der Reset in den Einstellungen wirkt sofort auch auf der Startseite', async ({ page }) => {
    await page.goto('./#/settings');
    await page.waitForTimeout(900);

    await page.getByRole('switch', { name: 'Woche von Hand setzen' }).click();
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'Override-Woche vor' }).click();
    await page.waitForTimeout(600);

    await page.getByRole('button', { name: 'Wochen-Override zurücksetzen' }).first().click();
    await page.waitForTimeout(600);

    await page.goto('./');
    await page.waitForTimeout(900);

    // Ohne Override hat die Kopfzeile nichts zu sagen und fehlt.
    await expect(page.locator('[data-timeline]')).toBeVisible();
    await expect(page.locator('[data-week-override]')).toHaveCount(0);
  });
});
