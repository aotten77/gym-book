import { expect, test, type Page } from '@playwright/test';
import {
  clearPlanEntries,
  collectPageErrors,
  completeActiveSet,
  closeExerciseSheet,
  importPlan,
  resetDatabase,
  seedSampleData,
  setProgramStart,
} from './helpers';

/*
 * Termine im Plan (Zeitstrahl). Das Startdatum liegt auf dem Montag dieser
 * Woche, damit "heute" in Programmwoche 1 liegt.
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

async function setStartToThisMonday(page: Page) {
  await setProgramStart(page, await localDay(page, 0, true));
}

/** Legt einen Lauf-Termin per Import an und öffnet den Plan. */
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
  await page.goto('./');
  await page.waitForTimeout(1200);
  await expect(page.locator(`[data-timeline-day="${day}"]`)).toBeVisible();
}

/** Legt einen Workout-Termin „Einheit A“ für heute per Import an. */
async function addTodayWorkoutEntry(page: Page) {
  const today = await localDay(page);

  await importPlan(page, [{ date: today, workout: 'Einheit A' }]);
  await page.goto('./');
  await page.waitForTimeout(1200);
  await expect(page.locator(`[data-timeline-day="${today}"]`)).toBeVisible();
}

test.describe('Termine im Plan', () => {
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

    await page.goto('./');
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

  test('die Lime-Karte startet den heutigen Termin und markiert ihn erledigt', async ({ page }) => {
    const errors = collectPageErrors(page);
    const today = await localDay(page);

    await addTodayWorkoutEntry(page);
    await expect(page.locator('[data-plan-entry]').filter({ hasText: 'Einheit A' })).toHaveAttribute(
      'data-plan-entry-state',
      'offen',
    );

    await page.goto('./');
    await page.waitForTimeout(800);
    await expect(page.locator('[data-now-unit]')).toHaveCount(1);
    await page.getByRole('button', { name: /Heute · Einheit A/ }).click();
    await page.waitForURL(/#\/session\//);
    await page.waitForTimeout(600);

    // Der frische Start hat das Fokus-Sheet schon geöffnet.
    await expect(page.locator('[data-sheet]')).toBeVisible();
    await completeActiveSet(page);
    await closeExerciseSheet(page);
    await page.getByRole('button', { name: 'Session abschließen' }).first().click();
    await page.waitForTimeout(1500);

    await page.goto('./');
    await page.waitForTimeout(800);
    await expect(
      page.locator(`[data-timeline-day="${today}"] [data-plan-entry]`).filter({ hasText: 'Einheit A' }),
    ).toHaveAttribute('data-plan-entry-state', 'erledigt');

    expect(errors).toEqual([]);
  });

  test('die Notiz des Termins steht als Banner über der Session, auch bei 320px', async ({ page }) => {
    const errors = collectPageErrors(page);
    const today = await localDay(page);

    await page.setViewportSize({ width: 320, height: 700 });
    await importPlan(page, [
      { date: today, workout: 'Einheit A', notes: 'Beispielnotiz, Sprünge nur angedeutet' },
    ]);
    await page.goto('./');
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /Heute · Einheit A/ }).click();
    await page.waitForURL(/#\/session\//);
    await page.waitForTimeout(600);
    await closeExerciseSheet(page);

    const banner = page.locator('[data-plan-note]');
    await expect(banner).toContainText('Beispielnotiz, Sprünge nur angedeutet');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // Ein Tipp blendet es aus, ein Reload holt es zurück.
    await banner.click();
    await expect(banner).toHaveCount(0);
    await page.reload();
    await expect(page.locator('[data-plan-note]')).toContainText('Beispielnotiz');

    expect(errors).toEqual([]);
  });

  test('ohne Termin heute steht „Heute trainieren“ mit „am längsten her“', async ({ page }) => {
    await page.goto('./');
    await page.waitForTimeout(800);

    await expect(page.locator('[data-now-unit]')).toHaveCount(0);
    const free = page.locator('[data-today-free]');
    await expect(free).toContainText('Heute trainieren');
    await expect(free).toContainText('am längsten her: Einheit A');
  });
});

test.describe('Zeitstrahl nach Programmende', () => {
  test('nach Programmende trägt keine Woche mehr eine Programmwoche', async ({ page }) => {
    const errors = collectPageErrors(page);

    await resetDatabase(page);
    await seedSampleData(page);
    // Acht Programmwochen ab Januar 2020 sind lange vorbei.
    await setProgramStart(page, '2020-01-06');

    const heads = page.locator('[data-timeline-week-head]');
    await expect(heads.first()).toBeVisible();
    await expect(heads.filter({ hasText: /· W\d/ })).toHaveCount(0);
    await expect(page.locator(`[data-timeline-week="${await localDay(page, 0, true)}"] [data-timeline-week-head][data-current]`)).toHaveCount(1);

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

    // Vor der Umwandlung weist der Plan darauf hin - neutral, mit Weg in die Einstellungen.
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

    await page.goto('./');
    await page.waitForTimeout(1000);
    await expect(
      page.locator(`[data-timeline-day="${today}"] [data-plan-entry]`).filter({ hasText: 'Einheit A' }),
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

    await page.goto('./');
    await page.waitForTimeout(1000);
    await expect(
      page.locator(`[data-timeline-day="${today}"] [data-plan-entry]`).filter({ hasText: 'Einheit A' }),
    ).toHaveCount(1);

    expect(errors).toEqual([]);
  });
});
