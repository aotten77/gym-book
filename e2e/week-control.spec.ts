import { expect, test } from '@playwright/test';
import { resetDatabase, seedSampleData } from './helpers';

/*
 * Home und Settings hatten vor der Konsolidierung auf resolveWeekControl je
 * eine eigene maxWeek-Formel - bei einem Override oberhalb der höchsten
 * Programmwoche konnten beide Seiten unterschiedliche Werte zeigen. Dieser
 * Test fängt genau diese Divergenz ab, nicht nur die einzelne Seite.
 */
test.describe('Wochensteuerung', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
  });

  test('ein von der Startseite gesetzter Override erscheint identisch in den Einstellungen', async ({
    page,
  }) => {
    await page.goto('./');
    await page.waitForTimeout(900);

    await page.getByRole('button', { name: 'Eine Woche vor' }).click();
    await page.waitForTimeout(600);

    const homeWeekLabel = await page
      .getByText(/^W\d+$/)
      .first()
      .textContent();

    await page.goto('./#/settings');
    await page.waitForTimeout(900);

    await expect(page.getByText('Override').first()).toBeVisible();
    await expect(page.getByText(homeWeekLabel ?? '').first()).toBeVisible();
  });

  test('der Reset in den Einstellungen wirkt sofort auch auf der Startseite', async ({ page }) => {
    await page.goto('./');
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: 'Eine Woche vor' }).click();
    await page.waitForTimeout(600);

    await page.goto('./#/settings');
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: 'Wochen-Override zurücksetzen' }).first().click();
    await page.waitForTimeout(600);

    await page.goto('./');
    await page.waitForTimeout(900);

    await expect(page.getByText('Programm', { exact: true })).toBeVisible();
  });
});
