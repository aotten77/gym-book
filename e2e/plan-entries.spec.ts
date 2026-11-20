import { expect, test, type Page } from '@playwright/test';
import {
  clearPlanEntries,
  collectPageErrors,
  completeActiveSet,
  closeExerciseSheet,
  importPlan,
  resetDatabase,
  seedSampleData,
} from './helpers';

/*
 * Termine im Programm-Tab. Das Startdatum liegt auf dem Montag dieser Woche,
 * damit "heute" in Programmwoche 1 liegt und die Terminliste genau diese
 * Woche zeigt.
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

async function setStartToThisMonday(page: Page) {
  await setProgramStart(page, await localDay(page, 0, true));
}

/** Wählt im Raster die Wochenzeile, in der `day` liegt - an einem Sonntag ist morgen schon die nächste Woche. */
async function selectWeekOf(page: Page, day: string) {
  const monday = await page.evaluate((value) => {
    const [year, month, date] = value.split('-').map(Number);
    const parsed = new Date(year, month - 1, date);

    parsed.setDate(parsed.getDate() - ((parsed.getDay() + 6) % 7));

    return `${parsed.getFullYear()}-${`${parsed.getMonth() + 1}`.padStart(2, '0')}-${`${parsed.getDate()}`.padStart(2, '0')}`;
  }, day);

  await page.locator(`[data-calendar-week="${monday}"]`).click();
  await expect(page.locator('[data-plan-week]')).toHaveAttribute('data-plan-week', monday);
}

/** Legt einen Lauf-Termin per Import an und öffnet den Programm-Tab auf der Woche des Tages. */
async function importRun(
  page: Page,
  title: string,
  extra?: { distance?: number; pace?: number; day?: string },
) {
  const day = extra?.day ?? (await localDay(page, 1));

  await importPlan(page, [
    {
      date: day,
      run: {
        title,
        ...(extra?.distance ? { targetDistanceKm: extra.distance } : {}),
        ...(extra?.pace ? { targetPaceSecondsPerKm: extra.pace } : {}),
      },
    },
  ]);
  await page.goto('./#/programs');
  await page.waitForTimeout(1200);
  await selectWeekOf(page, day);
}

/** Legt einen Workout-Termin „Einheit A“ für heute per Import an. */
async function addTodayWorkoutEntry(page: Page) {
  const today = await localDay(page);

  await importPlan(page, [{ date: today, workout: 'Einheit A' }]);
  await page.goto('./#/programs');
  await page.waitForTimeout(1200);
  await selectWeekOf(page, today);
}

test.describe('Termine im Programm-Tab', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
    await clearPlanEntries(page);
    await setStartToThisMonday(page);
  });

  test('ein importierter Lauf-Termin öffnet nur die Anzeige', async ({ page }) => {
    const errors = collectPageErrors(page);

    await importRun(page, 'Intervalle 6×400', { distance: 7, pace: 300 });

    const entry = page.locator('[data-plan-entry]').filter({ hasText: 'Intervalle 6×400' });
    await expect(entry).toBeVisible();
    await expect(entry).toContainText('7 km · 5:00 /km');
    await expect(entry).toHaveAttribute('data-plan-entry-state', 'offen');
    await expect(entry).toHaveAttribute('data-day-unit', 'run');
    await expect(page.locator('[data-plan-week]')).toHaveCount(1);

    await entry.click();

    const sheet = page.locator('[data-sheet]');
    await expect(sheet).toContainText('Termin');
    await expect(sheet).toContainText('Intervalle 6×400');
    await expect(sheet).toContainText('7 km · 5:00 /km');
    await expect(sheet.getByRole('button', { name: 'Termin speichern' })).toHaveCount(0);
    await expect(sheet.getByRole('button', { name: 'Termin löschen' })).toHaveCount(0);
    await expect(sheet.getByRole('textbox')).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test('ein laufender Termin führt in die laufende Session', async ({ page }) => {
    const errors = collectPageErrors(page);

    await addTodayWorkoutEntry(page);

    await page.goto('./');
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: /Heute · Einheit A/ }).click();
    await page.waitForURL(/#\/session\//);
    const sessionUrl = page.url();

    await page.goto('./#/programs');
    await page.waitForTimeout(1000);
    const entry = page.locator('[data-plan-entry]').filter({ hasText: 'Einheit A' });
    await expect(entry).toHaveAttribute('data-plan-entry-state', 'belegt');
    // Die belegte Zeile führt direkt in die laufende Session, kein Sheet dazwischen.
    await entry.click();
    await page.waitForURL(/#\/session\//);
    expect(page.url()).toBe(sessionUrl);

    expect(errors).toEqual([]);
  });

  test('passt bei 320px', async ({ page }) => {
    const errors = collectPageErrors(page);

    await page.setViewportSize({ width: 320, height: 700 });
    await importRun(page, 'Ein sehr langer Titel für einen Lauf am Wochenende im Wald', {
      distance: 12.5,
      pace: 330,
    });
    await expect(page.locator('[data-plan-entry]')).toHaveCount(1);
    await page.locator('[data-plan-entry]').click();
    await expect(page.locator('[data-sheet]')).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    expect(errors).toEqual([]);
  });

  test('Home startet den heutigen Termin und markiert ihn erledigt', async ({ page }) => {
    const errors = collectPageErrors(page);

    await addTodayWorkoutEntry(page);
    await expect(page.locator('[data-plan-entry]').filter({ hasText: 'Einheit A' })).toHaveAttribute(
      'data-plan-entry-state',
      'offen',
    );

    await page.goto('./');
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: /Heute · Einheit A/ }).click();
    await page.waitForURL(/#\/session\//);
    await page.waitForTimeout(600);

    // Der frische Start hat das Fokus-Sheet schon geöffnet.
    await expect(page.locator('[data-sheet]')).toBeVisible();
    await completeActiveSet(page);
    await closeExerciseSheet(page);
    await page.getByRole('button', { name: 'Session abschließen' }).first().click();
    await page.waitForTimeout(1500);

    await page.goto('./#/programs');
    await page.waitForTimeout(1000);
    await expect(
      page.locator('[data-plan-entry]').filter({ hasText: 'Einheit A' }),
    ).toHaveAttribute('data-plan-entry-state', 'erledigt');

    expect(errors).toEqual([]);
  });

  test('heute geplantes Workout startet aus der Liste', async ({ page }) => {
    const errors = collectPageErrors(page);
    const today = await localDay(page);

    await addTodayWorkoutEntry(page);

    const row = page.locator(`[data-plan-day="${today}"] [data-plan-entry]`).filter({ hasText: 'Einheit A' });
    await expect(row).toHaveAttribute('data-plan-entry-state', 'offen');
    await row.click();
    await page.waitForURL(/#\/session\//);

    await page.goto('./#/programs');
    await page.waitForTimeout(1000);
    await expect(
      page.locator(`[data-plan-day="${today}"] [data-plan-entry]`).filter({ hasText: 'Einheit A' }),
    ).toHaveAttribute('data-plan-entry-state', 'belegt');

    expect(errors).toEqual([]);
  });

  test('ohne Termine bleibt Am längsten her', async ({ page }) => {
    await page.goto('./');
    await page.waitForTimeout(800);

    await expect(page.getByText('Am längsten her')).toBeVisible();
    await expect(page.getByText('Nächster Termin')).toHaveCount(0);
  });

  test('an einem Tag ohne Termin bleibt jedes Workout startbar', async ({ page }) => {
    // Heute ist nichts geplant, der nächste Termin liegt morgen.
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const iso = (date: Date) =>
            `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          const open = indexedDB.open('gym-book-db');

          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const database = open.result;
            const tx = database.transaction(['planEntries', 'workoutTemplates'], 'readwrite');
            const templates = tx.objectStore('workoutTemplates').getAll();

            templates.onsuccess = () => {
              const stamp = new Date().toISOString();

              tx.objectStore('planEntries').add({
                id: 'morgen',
                date: iso(tomorrow),
                kind: 'workout',
                templateId: templates.result[0].id,
                orderInDay: 1,
                createdAt: stamp,
                updatedAt: stamp,
              });
            };
            tx.oncomplete = () => {
              database.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        }),
    );

    await page.goto('./');
    await page.waitForTimeout(800);

    await expect(page.getByText(/Nächster Termin/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Einheit A/ })).toBeVisible();
  });
});

test.describe('Terminliste nach Programmende', () => {
  test('nach Programmende folgt die Liste der Auswahl im Raster', async ({ page }) => {
    const errors = collectPageErrors(page);

    await resetDatabase(page);
    await seedSampleData(page);
    // Acht Programmwochen ab Januar 2020 sind lange vorbei.
    await setProgramStart(page, '2020-01-06');

    await expect(page.getByRole('tab', { name: /· W\d/ })).toHaveCount(0);

    const week = page.locator('[data-plan-week]');
    await expect(week).toHaveAttribute('data-plan-week', await localDay(page, 0, true));
    await expect(page.getByRole('button', { name: 'Vorherige Woche' })).toHaveCount(0);

    const nextMonday = await localDay(page, 7, true);

    await page.locator(`[data-calendar-week="${nextMonday}"]`).click();
    await expect(week).toHaveAttribute('data-plan-week', nextMonday);

    expect(errors).toEqual([]);
  });
});

/** Setzt `scheduledWeekdays` am Workout „Einheit A“ - so, wie es vor den Terminen gespeichert war. */
async function setLegacyWeekdays(page: Page, weekdays: number[]) {
  await page.evaluate(
    (days) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('gym-book-db');

        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          const tx = database.transaction('workoutTemplates', 'readwrite');
          const store = tx.objectStore('workoutTemplates');
          const all = store.getAll();

          all.onsuccess = () => {
            for (const template of all.result) {
              if (template.name === 'Einheit A') {
                store.put({ ...template, scheduledWeekdays: days });
              }
            }
          };
          tx.oncomplete = () => {
            database.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    weekdays,
  );
}

async function todayIsoWeekday(page: Page) {
  return page.evaluate(() => ((new Date().getDay() + 6) % 7) + 1);
}

test.describe('Wochentage in Termine umwandeln', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
    await clearPlanEntries(page);
    await setLegacyWeekdays(page, [await todayIsoWeekday(page)]);
  });

  test('wandelt bis zum Programmende um und ist danach erledigt', async ({ page }) => {
    const errors = collectPageErrors(page);
    const today = await localDay(page);

    await setStartToThisMonday(page);

    // Vor der Umwandlung weist der Programm-Tab darauf hin - neutral, mit Weg in die Einstellungen.
    const hint = page.locator('[data-plan-weekday-hint]');
    await expect(hint).toContainText('Feste Wochentage noch nicht umgewandelt');
    await hint.click();
    await expect(page).toHaveURL(/#\/settings/);
    await page.waitForTimeout(800);

    const convert = page.getByRole('button', { name: 'Wochentage umwandeln' });
    await expect(convert).toBeEnabled();
    await convert.click();

    const dialog = page.locator('[role="dialog"], [role="alertdialog"]');
    // Acht Programmwochen ab diesem Montag, je einmal der heutige Wochentag.
    await expect(dialog).toContainText('8 Termine');
    await expect(dialog.getByLabel('Für wie viele Wochen?')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Umwandeln' }).click();

    await expect(page.getByRole('status').filter({ hasText: 'angelegt' })).toHaveText(
      '8 Termine angelegt.',
    );
    const card = page
      .locator('div')
      .filter({ has: page.getByText('Wochentage in Termine umwandeln', { exact: true }) })
      .last();
    await expect(card).toContainText('Nichts zu tun.');
    await expect(convert).toBeDisabled();

    await page.goto('./#/programs');
    await page.waitForTimeout(1000);
    await expect(
      page.locator(`[data-plan-day="${today}"] [data-plan-entry]`).filter({ hasText: 'Einheit A' }),
    ).toHaveCount(1);
    await expect(page.locator('[data-plan-weekday-hint]')).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test('fragt ohne Startdatum nach der Zahl der Wochen', async ({ page }) => {
    const errors = collectPageErrors(page);
    const today = await localDay(page);

    await page.goto('./#/settings');
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: 'Wochentage umwandeln' }).click();

    const dialog = page.locator('[role="dialog"], [role="alertdialog"]');
    const weeks = dialog.getByLabel('Für wie viele Wochen?');
    await expect(weeks).toBeVisible();
    await weeks.fill('1');
    await expect(dialog).toContainText('1 Termin von');
    await dialog.getByRole('button', { name: 'Umwandeln' }).click();

    await expect(page.getByRole('status').filter({ hasText: 'angelegt' })).toHaveText(
      '1 Termin angelegt.',
    );
    await expect(page.getByRole('button', { name: 'Wochentage umwandeln' })).toBeDisabled();

    await page.goto('./#/programs');
    await page.waitForTimeout(1000);
    await expect(
      page.locator(`[data-plan-day="${today}"] [data-plan-entry]`).filter({ hasText: 'Einheit A' }),
    ).toHaveCount(1);

    expect(errors).toEqual([]);
  });
});
