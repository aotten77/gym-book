import { expect, test, type Page } from '@playwright/test';
import { collectPageErrors, resetDatabase, seedSampleData } from './helpers';

/*
 * Der Trainingskalender unter "Programm": sechs Kalenderwochen, ab der
 * Vorwoche. Die Beispieldaten legen Termine für "Einheit A" auf Montag und
 * Donnerstag der laufenden Woche (vier Wochen lang), tragen aber kein
 * Startdatum ein - das Raster braucht keins, nur die "W..."-Beschriftung.
 */

/** Ein lokaler Tag als `YYYY-MM-DD`, `offsetDays` von heute aus, im Browser gerechnet. */
async function localDay(page: Page, offsetDays = 0, mondayOfWeek = false) {
  return page.evaluate(
    ({ offset, monday }) => {
      const now = new Date();

      if (monday) {
        now.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      }

      now.setDate(now.getDate() + offset);

      const month = `${now.getMonth() + 1}`.padStart(2, '0');
      const day = `${now.getDate()}`.padStart(2, '0');

      return `${now.getFullYear()}-${month}-${day}`;
    },
    { offset: offsetDays, monday: mondayOfWeek },
  );
}

async function setProgramStart(page: Page, date: string) {
  await page.goto('./#/settings');
  await page.waitForTimeout(1200);
  await page.getByLabel('Programmstart').fill(date);
  await page.waitForTimeout(900);

  await page.goto('./#/programs');
  await page.waitForTimeout(1200);
}

test.describe('Trainingskalender', () => {
  test('zeigt das Raster ohne Programm', async ({ page }) => {
    const errors = collectPageErrors(page);

    await resetDatabase(page);
    await page.goto('./#/programs');
    await page.waitForTimeout(1200);

    const thisMonday = await localDay(page, 0, true);

    await expect(page.locator('[data-calendar-week]')).toHaveCount(6);
    await expect(page.locator(`[data-calendar-week="${thisMonday}"]`)).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('[data-calendar-today]')).toHaveCount(1);
    await expect(page.getByText('Kein Programm aktiv')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Programm verwalten' }).first()).toBeVisible();
    await expect(page.locator('[data-week-volume]')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('zeigt Termine ohne Startdatum', async ({ page }) => {
    const errors = collectPageErrors(page);

    await resetDatabase(page);
    await seedSampleData(page);
    await page.goto('./#/programs');
    await page.waitForTimeout(1200);

    const nextThursday = await localDay(page, 3 + 7, true);
    const cell = page.locator(`[data-calendar-day="${nextThursday}"]`);

    await expect(cell).toHaveAttribute('data-day-state', 'geplant');
    await expect(
      cell.locator('[data-calendar-unit="strength"][data-unit-state="geplant"]'),
    ).toHaveCount(1);

    // Der Montag dieser Woche: erledigt, wenn die Beispiel-Session darauf fällt (heute − 6 Tage).
    const expected = await page.evaluate(() => {
      const iso = (date: Date) =>
        `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
      const now = new Date();
      const monday = new Date(now);
      monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      const sessionDay = new Date(now);
      sessionDay.setDate(now.getDate() - 6);

      if (iso(monday) === iso(sessionDay)) return 'erledigt';

      return iso(monday) === iso(now) ? 'geplant' : 'leer';
    });

    await expect(page.locator(`[data-calendar-day="${await localDay(page, 0, true)}"]`)).toHaveAttribute(
      'data-day-state',
      expected,
    );

    expect(errors).toEqual([]);
  });

  test('blättert per Zeile und per Pfeil, die Liste folgt', async ({ page }) => {
    const errors = collectPageErrors(page);

    await resetDatabase(page);
    await seedSampleData(page);
    await page.goto('./#/programs');
    await page.waitForTimeout(1200);

    const nextMonday = await localDay(page, 7, true);

    await page.locator(`[data-calendar-week="${nextMonday}"]`).click();
    await expect(page.locator('[data-plan-week]')).toHaveAttribute('data-plan-week', nextMonday);
    await expect(page.locator('[data-week-volume]')).toHaveAttribute('data-week-volume', nextMonday);

    await page.getByRole('button', { name: 'Spätere Wochen' }).click();
    await page.getByRole('button', { name: 'Spätere Wochen' }).click();

    const farMonday = await localDay(page, 7 * 7, true);

    await expect(page.locator('[data-calendar-week]').first()).toHaveAttribute(
      'data-calendar-week',
      farMonday,
    );
    await expect(page.locator(`[data-calendar-week="${farMonday}"]`)).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('[data-plan-week]')).toHaveAttribute('data-plan-week', farMonday);
    await expect(page.locator('[data-week-volume]')).toHaveAttribute('data-week-volume', farMonday);

    await page.getByRole('button', { name: 'Frühere Wochen' }).click();

    await expect(page.locator('[data-calendar-week]').first()).toHaveAttribute(
      'data-calendar-week',
      await localDay(page, 7 * 3, true),
    );
    await expect(page.locator(`[data-calendar-week="${farMonday}"]`)).toHaveAttribute(
      'aria-selected',
      'true',
    );

    expect(errors).toEqual([]);
  });

  test('beschriftet Programmwochen nur mit Startdatum und schreibt keinen Override', async ({
    page,
  }) => {
    const errors = collectPageErrors(page);

    await resetDatabase(page);
    await seedSampleData(page);
    await setProgramStart(page, await localDay(page, 0, true));

    await expect(
      page.getByRole('tab', { name: /· W1( |$)/ }),
    ).toHaveAttribute('data-calendar-week', await localDay(page, 0, true));
    await expect(page.getByRole('tab', { name: /· W\d/ }).first()).toHaveAttribute(
      'data-calendar-week',
      await localDay(page, 0, true),
    );

    await page.getByRole('tab', { name: /· W5/ }).click();
    await page.waitForTimeout(500);
    await expect(page.getByText('3 × 18 s', { exact: false }).first()).toBeVisible();

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

    await resetDatabase(page);
    await seedSampleData(page);
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
});
