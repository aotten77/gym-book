import { expect, test } from '@playwright/test';
import { collectPageErrors, resetDatabase, seedSampleData } from './helpers';

/*
 * Der Trainingskalender unter "Programm".
 *
 * Die Beispieldaten legen "Einheit A" auf Montag und Donnerstag, tragen aber
 * kein Startdatum ein - genau die Ausgangslage, in der das Raster den Plan
 * zeigen darf und Termine nicht. Der dritte Test setzt das Startdatum und
 * prüft, dass daraus Daten und ein markiertes Heute werden.
 */
test.describe('Trainingskalender', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
  });

  test('zeigt den Wochenplan und ohne Startdatum keine Termine', async ({ page }) => {
    const errors = collectPageErrors(page);

    await page.goto('./#/programs');
    await page.waitForTimeout(1200);

    const calendar = page.locator('[data-training-calendar]');
    await expect(calendar).toBeVisible();

    // Der Plan steht einmal unter dem Raster, nicht in jeder Zeile.
    await expect(calendar.getByText('Einheit A').first()).toBeVisible();

    // Montag und Donnerstag sind geplant, der Mittwoch ist leer.
    const firstWeek = calendar.locator('[data-calendar-week="1"]');
    await expect(firstWeek.locator('[data-calendar-day="1"]')).toHaveAttribute(
      'data-day-state',
      'geplant',
    );
    await expect(firstWeek.locator('[data-calendar-day="4"]')).toHaveAttribute(
      'data-day-state',
      'geplant',
    );
    await expect(firstWeek.locator('[data-calendar-day="3"]')).toHaveAttribute(
      'data-day-state',
      'leer',
    );

    // Ohne Startdatum kennt keine Woche einen Montag - und der Kalender sagt das.
    await expect(page.getByText('Noch kein Startdatum')).toBeVisible();
    await expect(calendar.locator('[data-calendar-today]')).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test('bleibt die Wochenauswahl und schreibt dabei keinen Override', async ({ page }) => {
    const errors = collectPageErrors(page);

    await page.goto('./#/programs');
    await page.waitForTimeout(1200);

    await page.getByRole('tab', { name: 'W5' }).click();
    await page.waitForTimeout(500);

    await expect(page.getByRole('tab', { name: 'W5' })).toHaveAttribute('aria-selected', 'true');
    // Die Auswahl wechselt wirklich die Woche - W5 gibt dem Nordic Curl 18 s.
    await expect(page.getByText('3 × 18 s', { exact: false }).first()).toBeVisible();

    // Woche 5 *ansehen* ist nicht Woche 5 *trainieren*.
    await page.goto('./#/settings');
    await page.waitForTimeout(900);
    await expect(page.getByRole('switch', { name: 'Woche von Hand setzen' })).toHaveAttribute(
      'aria-checked',
      'false',
    );

    expect(errors).toEqual([]);
  });

  test('nimmt einen Trainingstag aus dem Workout auf', async ({ page }) => {
    const errors = collectPageErrors(page);

    await page.goto('./#/templates');
    await page.waitForTimeout(1200);
    await page.getByRole('link', { name: 'Bearbeiten' }).first().click();
    await page.waitForTimeout(900);

    await page.getByRole('button', { name: 'Samstag' }).click();
    await page.getByRole('button', { name: 'Workout speichern' }).click();
    await page.waitForTimeout(900);

    await expect(page.getByRole('button', { name: 'Samstag' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await page.goto('./#/programs');
    await page.waitForTimeout(1200);

    const calendar = page.locator('[data-training-calendar]');
    await expect(calendar.locator('[data-calendar-week="1"] [data-calendar-day="6"]')).toHaveAttribute(
      'data-day-state',
      'geplant',
    );
    await expect(calendar.getByText('Sa · Einheit A')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('macht aus dem Startdatum Termine und ein markiertes Heute', async ({ page }) => {
    const errors = collectPageErrors(page);

    // Der Montag dieser Woche - dann liegt "heute" in Programmwoche 1.
    const monday = await page.evaluate(() => {
      const now = new Date();
      now.setDate(now.getDate() - ((now.getDay() + 6) % 7));

      const month = `${now.getMonth() + 1}`.padStart(2, '0');
      const day = `${now.getDate()}`.padStart(2, '0');

      return `${now.getFullYear()}-${month}-${day}`;
    });

    await page.goto('./#/settings');
    await page.waitForTimeout(1200);
    await page.getByLabel('Programmstart').fill(monday);
    await page.waitForTimeout(900);

    await page.goto('./#/programs');
    await page.waitForTimeout(1200);

    const calendar = page.locator('[data-training-calendar]');

    await expect(page.getByText('Noch kein Startdatum')).toHaveCount(0);
    // Genau ein Tag im ganzen Raster ist heute.
    await expect(calendar.locator('[data-calendar-today]')).toHaveCount(1);
    await expect(
      calendar.locator('[data-calendar-today]').locator('xpath=ancestor::*[@data-calendar-week][1]'),
    ).toHaveAttribute('data-calendar-week', '1');

    // Spätere Wochen sind geplant, nicht verpasst.
    await expect(calendar.locator('[data-calendar-week="8"] [data-calendar-day="1"]')).toHaveAttribute(
      'data-day-state',
      'geplant',
    );

    expect(errors).toEqual([]);
  });
});
