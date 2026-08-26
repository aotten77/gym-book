import { expect, test } from '@playwright/test';
import { resetDatabase, seedSampleData } from './helpers';

/*
 * Home und Settings hatten vor der Konsolidierung auf resolveWeekControl je
 * eine eigene maxWeek-Formel - bei einem Override oberhalb der höchsten
 * Programmwoche konnten beide Seiten unterschiedliche Werte zeigen. Diese
 * Tests fangen genau diese Divergenz ab, nicht nur die einzelne Seite.
 *
 * Die Richtung ist seit dem Umbau umgedreht: geschrieben wird ausschließlich
 * in den Einstellungen, Home liest nur noch. Der dritte Test hält genau das
 * fest - auf Home führt kein Weg mehr zu einem weekOverride.
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

    await expect(
      page
        .locator('#main-content')
        .getByText(settingsWeekLabel ?? '', { exact: true })
        .first(),
    ).toBeVisible();
    await expect(
      page.locator('#main-content').getByText('Von Hand gesetzt - in den Einstellungen zurücksetzen'),
    ).toBeVisible();
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

    /*
     * Auf den Hauptinhalt eingegrenzt: gemeint ist der Wochen-Hinweis auf der
     * Startseite, der nach dem Reset wieder "Programm" statt "Override" zeigt.
     * Ohne die Eingrenzung trifft der Text seit der Umbenennung auch das
     * gleichnamige Reiter-Label in der Navigation.
     */
    await expect(
      page.locator('#main-content').getByText('Programm', { exact: true }),
    ).toBeVisible();
  });

  test('Home schreibt keine Woche - nach dem Antippen steht in den Einstellungen kein Override', async ({
    page,
  }) => {
    await page.goto('./');
    await page.waitForTimeout(900);

    // Die Pfeile sind weg, und mit ihnen der zweite Schreiber auf weekOverride.
    await expect(page.getByRole('button', { name: 'Eine Woche vor' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Eine Woche zurück' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Wochen-Override zurücksetzen' })).toHaveCount(0);

    // Was bleibt, ist die Anzeige - und ein Tap darauf darf nichts schreiben.
    const weekPanel = page.locator('#main-content').getByText(/^W\d+$/).first();
    await expect(weekPanel).toBeVisible();
    await weekPanel.click();
    await page.waitForTimeout(600);

    await page.getByRole('button', { name: 'Woche ändern' }).click();
    await page.waitForTimeout(900);

    await expect(page.getByRole('switch', { name: 'Woche von Hand setzen' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await expect(page.getByText('Override', { exact: true })).toHaveCount(0);
  });
});
