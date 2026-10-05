import { expect, test } from '@playwright/test';
import { collectPageErrors, resetDatabase, seedSampleData } from './helpers';

/*
 * Der Trainingskalender unter "Programm".
 *
 * Die Beispieldaten legen Termine für "Einheit A" auf Montag und Donnerstag
 * der laufenden Woche (vier Wochen lang), tragen aber kein Startdatum ein -
 * genau die Ausgangslage, in der das Raster keine Daten kennt und das sagt.
 * Der letzte Test setzt das Startdatum und prüft, dass daraus Daten, ein
 * markiertes Heute und geplante bzw. verpasste Termine werden.
 */
test.describe('Trainingskalender', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
  });

  test('zeigt das Raster und ohne Startdatum keine Termine', async ({ page }) => {
    const errors = collectPageErrors(page);

    await page.goto('./#/programs');
    await page.waitForTimeout(1200);

    const calendar = page.locator('[data-training-calendar]');
    await expect(calendar).toBeVisible();

    // Ohne Startdatum kennt keine Woche einen Montag - und der Kalender sagt das.
    await expect(page.getByText('Noch kein Startdatum')).toBeVisible();
    await expect(calendar.locator('[data-calendar-today]')).toHaveCount(0);
    await expect(calendar.locator('[data-calendar-day][data-day-state="geplant"]')).toHaveCount(0);

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

  test('führt vom Workout in den Programm-Tab', async ({ page }) => {
    const errors = collectPageErrors(page);

    await page.goto('./#/templates');
    await page.waitForTimeout(1200);
    await page.getByRole('link', { name: 'Bearbeiten' }).first().click();
    await page.waitForTimeout(900);

    // Feste Wochentage gibt es am Workout nicht mehr.
    await expect(page.getByRole('button', { name: 'Samstag' })).toHaveCount(0);

    await page.getByRole('link', { name: 'Termine im Programm-Tab' }).click();
    await page.waitForTimeout(900);
    await expect(page).toHaveURL(/#\/programs$/);

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

    // Montag und Donnerstag der laufenden Woche tragen die Termine der Beispieldaten:
    // vergangene sind verpasst (oder erledigt, falls die Beispiel-Session auf den Tag fällt),
    // heutige und künftige geplant.
    const expected = await page.evaluate(() => {
      const iso = (date: Date) =>
        `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
      const now = new Date();
      const monday = new Date(now);
      monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      const sessionDay = new Date(now);
      sessionDay.setDate(now.getDate() - 6);

      return [1, 4].map((weekday) => {
        const day = new Date(monday);
        day.setDate(monday.getDate() + weekday - 1);

        if (iso(day) === iso(sessionDay)) return 'erledigt';

        return iso(day) < iso(now) ? 'verpasst' : 'geplant';
      });
    });

    await expect(calendar.locator('[data-calendar-week="1"] [data-calendar-day="1"]')).toHaveAttribute(
      'data-day-state',
      expected[0],
    );
    await expect(calendar.locator('[data-calendar-week="1"] [data-calendar-day="4"]')).toHaveAttribute(
      'data-day-state',
      expected[1],
    );
    // Spätere Wochen sind geplant, nicht verpasst.
    await expect(calendar.locator('[data-calendar-week="4"] [data-calendar-day="1"]')).toHaveAttribute(
      'data-day-state',
      'geplant',
    );

    expect(errors).toEqual([]);
  });
});
