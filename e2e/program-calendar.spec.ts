import { expect, test, type Page } from '@playwright/test';
import {
  closeExerciseSheet,
  collectPageErrors,
  completeActiveSet,
  resetDatabase,
  seedSampleData,
} from './helpers';

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

/** Der Montag der Woche, in der `day` liegt (`YYYY-MM-DD`), im Browser gerechnet. */
async function mondayOf(page: Page, day: string) {
  return page.evaluate((value) => {
    const [year, month, date] = value.split('-').map(Number);
    const parsed = new Date(year, month - 1, date);

    parsed.setDate(parsed.getDate() - ((parsed.getDay() + 6) % 7));

    return `${parsed.getFullYear()}-${`${parsed.getMonth() + 1}`.padStart(2, '0')}-${`${parsed.getDate()}`.padStart(2, '0')}`;
  }, day);
}

/** Räumt die Beispiel-Termine weg und lädt den Programm-Tab neu. */
async function startWithEmptyPlan(page: Page) {
  await resetDatabase(page);
  await seedSampleData(page);
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('gym-book-db');

        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          const tx = database.transaction('planEntries', 'readwrite');

          tx.objectStore('planEntries').clear();
          tx.oncomplete = () => {
            database.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.goto('./#/programs');
  await page.waitForTimeout(1200);
}

test.describe('Tagesliste: Einheit und Termin', () => {
  test('+ Einheit startet ein ungeplantes Workout, das danach erledigt steht', async ({ page }) => {
    const errors = collectPageErrors(page);

    await startWithEmptyPlan(page);
    const today = await localDay(page);

    await page.getByRole('button', { name: '+ Einheit' }).click();
    await page.locator('[data-sheet]').getByRole('button', { name: /Einheit A/ }).click();
    await page.waitForURL(/#\/session\//);
    await page.waitForTimeout(600);

    // Der frische Start hat das Fokus-Sheet schon geöffnet.
    await expect(page.locator('[data-sheet]')).toBeVisible();
    await completeActiveSet(page);
    await closeExerciseSheet(page);
    await page.getByRole('button', { name: 'Session abschließen' }).first().click();
    await page.waitForTimeout(1500);

    await page.goto('./#/programs');
    await page.waitForTimeout(1200);

    const cell = page.locator(`[data-calendar-day="${today}"]`);
    await expect(cell).toHaveAttribute('data-day-state', 'erledigt');
    await expect(
      cell.locator('[data-calendar-unit="strength"][data-unit-state="erledigt"]'),
    ).toHaveCount(1);
    await expect(page.locator(`[data-plan-day="${today}"]`)).toContainText('spontan');

    expect(errors).toEqual([]);
  });

  test('ein eingetragener Lauf führt zur Detailseite', async ({ page }) => {
    const errors = collectPageErrors(page);

    await startWithEmptyPlan(page);

    await page.getByRole('button', { name: '+ Einheit' }).click();
    await page.locator('[data-sheet]').getByRole('button', { name: 'Lauf eintragen' }).click();

    const sheet = page.locator('[data-sheet]');
    await sheet.getByLabel('Strecke (km)').fill('10');
    await sheet.getByLabel('Min', { exact: true }).fill('52');
    await sheet.getByRole('button', { name: 'Lauf speichern' }).click();
    await expect(sheet).toHaveCount(0);

    const row = page.locator('[data-day-unit="run"][data-unit-state="erledigt"]');
    await expect(row).toHaveCount(1);
    await row.click();
    await page.waitForURL(/#\/runs\//);

    expect(errors).toEqual([]);
  });

  test('passt bei 320 px mit drei Einheiten an einem Tag', async ({ page }) => {
    const errors = collectPageErrors(page);

    await page.setViewportSize({ width: 320, height: 700 });
    await startWithEmptyPlan(page);
    const tomorrow = await localDay(page, 1);

    await page.evaluate(
      (day) =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open('gym-book-db');

          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const database = open.result;
            const tx = database.transaction(['planEntries', 'workoutTemplates'], 'readwrite');
            const templates = tx.objectStore('workoutTemplates').getAll();

            templates.onsuccess = () => {
              const stamp = new Date().toISOString();
              const template = templates.result.find((item: { name: string }) => item.name === 'Einheit A');
              const longTitle = (label: string) =>
                `${label} mit einem wirklich sehr langen Titel über vierzig Zeichen`;

              tx.objectStore('planEntries').add({
                id: 'a', date: day, kind: 'workout', templateId: template.id, orderInDay: 1, createdAt: stamp, updatedAt: stamp,
              });
              tx.objectStore('planEntries').add({
                id: 'b', date: day, kind: 'run', title: longTitle('Dauerlauf'), orderInDay: 2, createdAt: stamp, updatedAt: stamp,
              });
              tx.objectStore('planEntries').add({
                id: 'c', date: day, kind: 'run', title: longTitle('Intervalle'), orderInDay: 3, createdAt: stamp, updatedAt: stamp,
              });
            };
            tx.oncomplete = () => {
              database.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        }),
      tomorrow,
    );
    // Direkte IndexedDB-Schreibzugriffe melden sich nicht bei den Live-Abfragen.
    await page.reload();
    await page.waitForTimeout(1200);

    await page.locator(`[data-calendar-week="${await mondayOf(page, tomorrow)}"]`).click();
    await expect(page.locator(`[data-calendar-day="${tomorrow}"] [data-calendar-more]`)).toHaveText('+2');
    await expect(page.locator(`[data-plan-day="${tomorrow}"] [data-day-unit]`)).toHaveCount(3);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    expect(errors).toEqual([]);
  });
});
