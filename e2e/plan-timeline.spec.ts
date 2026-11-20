import { expect, test, type Page } from '@playwright/test';
import {
  clearPlanEntries,
  closeExerciseSheet,
  collectPageErrors,
  importPlan,
  resetDatabase,
  seedSampleData,
} from './helpers';

/*
 * Der Plan als ein Zeitstrahl auf der Startseite. Die Tests laufen auf dem
 * echten heutigen Datum; Wochentage und Montage werden deshalb immer aus dem
 * Datum gerechnet, nie angenommen.
 */

/** Ein lokaler Tag als `YYYY-MM-DD`, `offsetDays` von heute aus, im Browser gerechnet. */
async function localDay(page: Page, offsetDays = 0) {
  return page.evaluate((offset) => {
    const now = new Date();

    now.setDate(now.getDate() + offset);

    return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}-${`${now.getDate()}`.padStart(2, '0')}`;
  }, offsetDays);
}

/** Der Montag der Woche, in der `day` liegt. */
async function mondayOf(page: Page, day: string) {
  return page.evaluate((value) => {
    const [year, month, date] = value.split('-').map(Number);
    const parsed = new Date(year, month - 1, date);

    parsed.setDate(parsed.getDate() - ((parsed.getDay() + 6) % 7));

    return `${parsed.getFullYear()}-${`${parsed.getMonth() + 1}`.padStart(2, '0')}-${`${parsed.getDate()}`.padStart(2, '0')}`;
  }, day);
}

async function openPlan(page: Page) {
  await page.goto('./');
  await page.reload();
  await page.waitForTimeout(1200);
}

/** Ein Lauf weit in der Vergangenheit, direkt in IndexedDB - damit es frühere Wochen nachzuladen gibt. */
async function addPastRun(page: Page, date: string) {
  await page.evaluate(
    (day) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('gym-book-db');

        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          const tx = database.transaction('runLogs', 'readwrite');
          const stamp = new Date().toISOString();

          tx.objectStore('runLogs').add({
            id: 'e2e-alter-lauf',
            date: day,
            distanceKm: 8,
            durationSeconds: 2700,
            createdAt: stamp,
            updatedAt: stamp,
          });
          tx.oncomplete = () => {
            database.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    date,
  );
}

test.describe('Plan als Zeitstrahl', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
    await clearPlanEntries(page);
  });

  test('öffnet auf heute', async ({ page }) => {
    const errors = collectPageErrors(page);

    await openPlan(page);

    await expect(page.locator('[data-timeline-today]')).toBeInViewport();
    await expect(page.locator('[data-timeline-week-head][data-current]')).toHaveCount(1);
    await expect(page.locator('[data-timeline-today]')).toHaveAttribute(
      'data-timeline-day',
      await localDay(page),
    );

    expect(errors).toEqual([]);
  });

  test('reicht bis zur Woche des letzten Termins, mindestens bis nächste Woche', async ({ page }) => {
    const errors = collectPageErrors(page);
    const far = await localDay(page, 70);

    await importPlan(page, [{ date: far, workout: 'Einheit A' }]);
    await openPlan(page);

    await expect(page.locator('[data-timeline-week]').last()).toHaveAttribute(
      'data-timeline-week',
      await mondayOf(page, far),
    );

    await clearPlanEntries(page);
    await openPlan(page);

    await expect(page.locator('[data-timeline-week]').last()).toHaveAttribute(
      'data-timeline-week',
      await mondayOf(page, await localDay(page, 7)),
    );

    expect(errors).toEqual([]);
  });

  test('die Lime-Karte startet den heutigen Termin', async ({ page }) => {
    const errors = collectPageErrors(page);

    await importPlan(page, [{ date: await localDay(page), workout: 'Einheit A' }]);
    await openPlan(page);

    const now = page.locator('[data-now-unit]');
    await expect(now).toHaveCount(1);
    await expect(now).toContainText('Einheit A');
    await now.click();
    await page.waitForURL(/#\/session\//);
    await expect(page.locator('[data-sheet]')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('heute ohne Plan steht „Heute trainieren“ ohne Lime', async ({ page }) => {
    const errors = collectPageErrors(page);

    await openPlan(page);

    await expect(page.locator('[data-now-unit]')).toHaveCount(0);
    const free = page.locator('[data-today-free]');
    await expect(free).toContainText('am längsten her');
    await free.click();
    await expect(page.getByRole('dialog', { name: 'Jetzt trainieren' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('bei laufender Session liegt Lime nur auf dem Streifen, heute offene Termine starten nicht', async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    const today = await localDay(page);

    await importPlan(page, [
      { date: today, workout: 'Einheit A' },
      { date: today, run: { title: 'Intervalle' } },
    ]);
    await openPlan(page);

    const now = page.locator('[data-now-unit]');
    await expect(now).toContainText('Einheit A');
    await now.click();
    await page.waitForURL(/#\/session\//);
    await expect(page.locator('[data-sheet]')).toBeVisible();
    await closeExerciseSheet(page);
    await page.getByRole('button', { name: 'Session minimieren' }).click();
    await page.waitForURL(/#\/$/);
    await page.waitForTimeout(800);

    await expect(page.locator('[data-now-unit]')).toHaveCount(0);
    await expect(
      page.locator('[data-plan-entry]').filter({ hasText: 'Einheit A' }),
    ).toContainText('läuft · Satz');

    await page.locator('[data-plan-entry]').filter({ hasText: 'Intervalle' }).click();
    const sheet = page.locator('[data-sheet]');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('Termin');
    await expect(sheet.getByRole('button', { name: 'Lauf speichern' })).toHaveCount(0);
    await expect(page).toHaveURL(/#\/$/);

    expect(errors).toEqual([]);
  });

  test('das Protokoll zeigt Erledigtes und Seitenvergleiche', async ({ page }) => {
    const errors = collectPageErrors(page);

    await openPlan(page);

    await expect(
      page.locator('[data-unit-state="erledigt"]').filter({ hasText: 'Einheit A' }),
    ).toHaveCount(1);
    const testUnit = page.locator('[data-day-unit="test"]');
    await expect(testUnit).toHaveCount(1);
    await expect(testUnit).toContainText('Seitenvergleich');

    expect(errors).toEqual([]);
  });

  test('frühere Wochen laden nach, ohne dass die Liste springt', async ({ page }) => {
    const errors = collectPageErrors(page);

    await addPastRun(page, await localDay(page, -70));
    await openPlan(page);

    const weeks = page.locator('[data-timeline-week]');
    const loadEarlier = page.locator('[data-load-earlier]');
    await expect(loadEarlier).toBeVisible();

    const before = await weeks.count();
    const firstKey = await weeks.first().getAttribute('data-timeline-week');
    const head = page.locator(`[data-timeline-week="${firstKey}"] [data-timeline-week-head]`);

    // Erst in den Blick holen: der Klick scrollt sonst selbst und verfälscht die Messung.
    await loadEarlier.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const topBefore = await head.evaluate((element) => element.getBoundingClientRect().top);

    await loadEarlier.click();
    await expect(weeks).toHaveCount(before + 4);
    await page.waitForTimeout(800);

    const topAfter = await head.evaluate((element) => element.getBoundingClientRect().top);
    expect(Math.abs(topAfter - topBefore)).toBeLessThanOrEqual(2);

    expect(errors).toEqual([]);
  });

  test('die Pill „Heute“ springt zurück und verschwindet', async ({ page }) => {
    const errors = collectPageErrors(page);

    // Ein Termin in zehn Wochen, damit das Ende des Zeitstrahls weit weg von heute liegt.
    await importPlan(page, [{ date: await localDay(page, 70), workout: 'Einheit A' }]);
    await openPlan(page);

    const pill = page.locator('[data-jump-today]');
    await expect(pill).toBeHidden();

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(pill).toBeVisible();
    await expect(pill).toHaveAttribute('aria-label', 'Zu heute springen');

    await pill.click();
    await expect(page.locator('[data-timeline-today]')).toBeInViewport();
    await expect(pill).toBeHidden();

    expect(errors).toEqual([]);
  });

  test('passt bei 320px', async ({ page }) => {
    const errors = collectPageErrors(page);

    await importPlan(page, [
      {
        date: await localDay(page, 1),
        run: { title: 'Ein sehr langer Titel für einen Lauf am Wochenende im Wald', targetDistanceKm: 12.5 },
      },
    ]);
    await page.setViewportSize({ width: 320, height: 700 });
    await openPlan(page);

    const timeline = page.locator('[data-timeline]');
    const sizes = await timeline.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth);

    const tooWide = await page
      .locator('[data-timeline-week-head]')
      .evaluateAll((heads) => heads.filter((head) => head.getBoundingClientRect().width > window.innerWidth).length);
    expect(tooWide).toBe(0);

    expect(errors).toEqual([]);
  });

  test('folgt über Nacht dem neuen Tag', async ({ page }) => {
    const errors = collectPageErrors(page);
    const lateToday = new Date();

    lateToday.setHours(23, 59, 0, 0);

    const tomorrow = new Date(lateToday.getFullYear(), lateToday.getMonth(), lateToday.getDate() + 1);
    const tomorrowKey = `${tomorrow.getFullYear()}-${`${tomorrow.getMonth() + 1}`.padStart(2, '0')}-${`${tomorrow.getDate()}`.padStart(2, '0')}`;

    await page.clock.install({ time: lateToday });
    await openPlan(page);
    await expect(page.locator('[data-timeline-today]')).not.toHaveAttribute('data-timeline-day', tomorrowKey);

    await page.clock.runFor('02:00');

    await expect(page.locator('[data-timeline-today]')).toHaveAttribute('data-timeline-day', tomorrowKey);

    expect(errors).toEqual([]);
  });
});
