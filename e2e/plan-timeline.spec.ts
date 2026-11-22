import { devices, expect, test, type Page } from '@playwright/test';
import {
  clearPlanEntries,
  closeExerciseSheet,
  collectPageErrors,
  importPlan,
  openRunLogFromNow,
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
            id: `e2e-alter-lauf-${crypto.randomUUID()}`,
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

/** Die physische Lage einer Woche (Kopf) im Bild - gilt im Hoch- wie im gedrehten Querformat. */
async function weekHeadRect(page: Page, weekKey: string) {
  return page
    .locator(`[data-timeline-week="${weekKey}"] [data-timeline-week-head]`)
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();

      return { x: rect.left, y: rect.top };
    });
}

/**
 * Lädt frühere Wochen nach, holt die erledigte Einheit in den Bild und liefert
 * ihre Zeile samt dem Schlüssel ihrer Woche - die Stelle, an die man nach dem
 * Zurück wieder kommen muss.
 */
async function loadEarlierAndFindSession(page: Page) {
  await addPastRun(page, await localDay(page, -70));
  await addPastRun(page, await localDay(page, -37));
  await openPlan(page);

  const weeks = page.locator('[data-timeline-week]');
  const before = await weeks.count();

  await page.locator('[data-load-earlier]').scrollIntoViewIfNeeded();
  await page.locator('[data-load-earlier]').click();
  await expect(weeks).toHaveCount(before + 4);
  await page.waitForTimeout(800);

  const row = page.locator('[data-unit-state="erledigt"]').filter({ hasText: 'Einheit A' });
  await row.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);

  const weekKey = await row
    .locator('xpath=ancestor::*[@data-timeline-week][1]')
    .getAttribute('data-timeline-week');

  return { row, weekKey: weekKey as string, weeksAfter: before + 4 };
}

/** Erwartet, dass die Woche nach der Rückkehr an derselben Stelle steht. */
async function expectWeekBackAt(page: Page, weekKey: string, expected: { x: number; y: number }) {
  await expect(page.locator('[data-timeline-week]')).not.toHaveCount(0);
  await page.waitForTimeout(800);

  const rect = await weekHeadRect(page, weekKey);

  expect(Math.abs(rect.x - expected.x)).toBeLessThanOrEqual(3);
  expect(Math.abs(rect.y - expected.y)).toBeLessThanOrEqual(3);
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
    await expect(page).toHaveURL(/\/(#\/)?$/);
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
    // Ein Lauf im Bereich, den der eine Tap lädt: die früheren Wochen wachsen erst mit ihren Daten.
    await addPastRun(page, await localDay(page, -37));
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

  test('heute ist beim Öffnen und nach der Pill im Bild, auch wenn die Woche davor voll ist', async ({ page }) => {
    const errors = collectPageErrors(page);
    const today = await localDay(page);
    const monday = await mondayOf(page, today);

    await importPlan(page, [{ date: today, workout: 'Einheit A' }]);

    // Viele erledigte Läufe an den Tagen vor heute in dieser Woche (offene Termine der Vergangenheit zeigt der Plan nicht):
    // heute liegt am Wochenanfang unter dem Bildrand. Ist heute ein Montag, gibt es davor nichts - dann gilt nur die Zusicherung selbst.
    for (let offset = -6; offset < 0; offset += 1) {
      const day = await localDay(page, offset);

      if (day >= monday) {
        for (let index = 0; index < 10; index += 1) {
          await addPastRun(page, day);
        }
      }
    }

    await openPlan(page);

    const todayRow = page.locator('[data-timeline-today]');
    await expect(todayRow).toBeInViewport();

    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator('[data-jump-today]')).toBeVisible();
    await page.locator('[data-jump-today]').click();
    await expect(todayRow).toBeInViewport();
    await expect(page.locator('[data-jump-today]')).toBeHidden();

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

  test('passt bei 320px mit drei Einheiten an einem Tag', async ({ page }) => {
    const errors = collectPageErrors(page);
    const tomorrow = await localDay(page, 1);
    const longTitle = (label: string) => `${label} mit einem wirklich sehr langen Titel über vierzig Zeichen`;

    await importPlan(page, [
      { date: tomorrow, workout: 'Einheit A' },
      { date: tomorrow, run: { title: longTitle('Dauerlauf') } },
      { date: tomorrow, run: { title: longTitle('Intervalle') } },
    ]);
    await page.setViewportSize({ width: 320, height: 700 });
    await openPlan(page);

    await expect(page.locator(`[data-timeline-day="${tomorrow}"] [data-day-unit]`)).toHaveCount(3);

    const sizes = await page.locator('[data-timeline]').evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    expect(errors).toEqual([]);
  });

  test('ein eingetragener Lauf steht erledigt da und führt zur Detailseite', async ({ page }) => {
    const errors = collectPageErrors(page);

    await openPlan(page);
    await openRunLogFromNow(page);

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

  test('Zurück aus der Einheit führt an dieselbe Stelle im Plan', async ({ page }) => {
    const errors = collectPageErrors(page);
    const { row, weekKey, weeksAfter } = await loadEarlierAndFindSession(page);
    const expected = await weekHeadRect(page, weekKey);

    await row.click();
    await page.waitForURL(/#\/history\/session\//);
    await page.getByRole('button', { name: 'Zurück' }).click();
    await expect(page).toHaveURL(/\/(#\/)?$/);

    await expect(page.locator('[data-timeline-week]')).toHaveCount(weeksAfter);
    await expectWeekBackAt(page, weekKey, expected);

    expect(errors).toEqual([]);
  });

  test('die Zurück-Geste (goBack) führt an dieselbe Stelle im Plan', async ({ page }) => {
    const errors = collectPageErrors(page);
    const { row, weekKey } = await loadEarlierAndFindSession(page);
    const expected = await weekHeadRect(page, weekKey);

    await row.click();
    await page.waitForURL(/#\/history\/session\//);
    await page.goBack();
    await expect(page).toHaveURL(/\/(#\/)?$/);

    await expectWeekBackAt(page, weekKey, expected);

    expect(errors).toEqual([]);
  });

  test('aus einem Lauf führt die Zurück-Geste an dieselbe Stelle im Plan', async ({ page }) => {
    const errors = collectPageErrors(page);

    await loadEarlierAndFindSession(page);

    const run = page.locator('[data-day-unit="run"][data-unit-state="erledigt"]').first();
    await run.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);

    const weekKey = (await run
      .locator('xpath=ancestor::*[@data-timeline-week][1]')
      .getAttribute('data-timeline-week')) as string;
    const expected = await weekHeadRect(page, weekKey);

    await run.click();
    await page.waitForURL(/#\/runs\//);
    await page.goBack();
    await expect(page).toHaveURL(/\/(#\/)?$/);

    await expectWeekBackAt(page, weekKey, expected);

    expect(errors).toEqual([]);
  });

  test('der Plan-Tab öffnet nach der Rückkehr wieder auf heute', async ({ page }) => {
    const errors = collectPageErrors(page);
    const { row } = await loadEarlierAndFindSession(page);

    await row.click();
    await page.waitForURL(/#\/history\/session\//);
    await page.goBack();
    await expect(page).toHaveURL(/\/(#\/)?$/);

    await page.getByRole('link', { name: 'Fortschritt' }).click();
    await page.waitForURL(/#\/history$/);
    await page.getByRole('link', { name: 'Plan', exact: true }).click();
    await expect(page).toHaveURL(/\/(#\/)?$/);
    await page.waitForTimeout(800);

    await expect(page.locator('[data-timeline-today]')).toBeInViewport();

    expect(errors).toEqual([]);
  });

  test('aus dem Fortschritt führt Zurück wieder in den Fortschritt', async ({ page }) => {
    const errors = collectPageErrors(page);

    await page.goto('./#/history');
    await page.waitForTimeout(800);
    await page.locator('a[href*="/history/session/"]').first().click();
    await page.waitForURL(/#\/history\/session\//);
    await page.getByRole('button', { name: 'Zurück' }).click();
    await page.waitForURL(/#\/history$/);

    expect(errors).toEqual([]);
  });

  test('ein Deep Link auf die Einheit führt mit Zurück nie ins Leere', async ({ page }) => {
    const errors = collectPageErrors(page);

    await page.goto('./#/history');
    await page.waitForTimeout(600);
    const href = await page.locator('a[href*="/history/session/"]').first().getAttribute('href');

    // Kaltstart direkt auf der Detailseite: keine Herkunft, also in den Verlauf.
    await page.goto(`./${href}`);
    await page.reload();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'Zurück' }).click();
    await page.waitForURL(/#\/history$/);

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

/*
 * Im Querformat dreht `index.css` die App um 90 Grad, und es scrollt das Kind
 * von `#root` statt des Fensters. Gemessen wird die physische Lage des Kopfes
 * (`getBoundingClientRect`, beide Achsen) - das ist, was man sieht.
 */
test.describe('Plan als Zeitstrahl im Querformat', () => {
  const landscape = devices['iPhone 13 landscape'];

  test.use({
    viewport: landscape.viewport,
    screen: landscape.screen,
    userAgent: landscape.userAgent,
    deviceScaleFactor: landscape.deviceScaleFactor,
    isMobile: landscape.isMobile,
    hasTouch: landscape.hasTouch,
  });

  test('frühere Wochen laden nach, ohne dass die Liste springt', async ({ page }) => {
    const errors = collectPageErrors(page);

    await resetDatabase(page);
    await seedSampleData(page);
    await clearPlanEntries(page);
    await addPastRun(page, await localDay(page, -70));
    // Ein Lauf im Bereich, den der eine Tap lädt: die früheren Wochen wachsen erst mit ihren Daten.
    await addPastRun(page, await localDay(page, -37));
    await openPlan(page);

    expect(
      await page.evaluate(
        () => matchMedia('(orientation: landscape) and (max-height: 520px) and (pointer: coarse)').matches,
      ),
    ).toBe(true);

    const weeks = page.locator('[data-timeline-week]');
    const loadEarlier = page.locator('[data-load-earlier]');
    await expect(loadEarlier).toHaveCount(1);

    const before = await weeks.count();
    const firstKey = await weeks.first().getAttribute('data-timeline-week');
    const head = page.locator(`[data-timeline-week="${firstKey}"] [data-timeline-week-head]`);

    // Den gedrehten Scroll-Container an den Anfang setzen, damit der Knopf im Bild ist und der Klick nicht selbst scrollt.
    await page.evaluate(() => {
      const container = document.querySelector<HTMLElement>('#root > *');

      if (container) {
        container.scrollTop = 0;
      }
    });
    await page.waitForTimeout(300);
    const rectBefore = await head.evaluate((element) => {
      const rect = element.getBoundingClientRect();

      return { x: rect.left, y: rect.top };
    });

    await loadEarlier.click();
    await expect(weeks).toHaveCount(before + 4);
    await page.waitForTimeout(800);

    const rectAfter = await head.evaluate((element) => {
      const rect = element.getBoundingClientRect();

      return { x: rect.left, y: rect.top };
    });
    expect(Math.abs(rectAfter.x - rectBefore.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(rectAfter.y - rectBefore.y)).toBeLessThanOrEqual(2);

    expect(errors).toEqual([]);
  });

  test('Zurück aus der Einheit führt an dieselbe Stelle im Plan', async ({ page }) => {
    const errors = collectPageErrors(page);

    await resetDatabase(page);
    await seedSampleData(page);
    await clearPlanEntries(page);

    const { row, weekKey } = await loadEarlierAndFindSession(page);
    const expected = await weekHeadRect(page, weekKey);

    await row.click();
    await page.waitForURL(/#\/history\/session\//);
    await page.getByRole('button', { name: 'Zurück' }).click();
    await expect(page).toHaveURL(/\/(#\/)?$/);

    await expectWeekBackAt(page, weekKey, expected);

    expect(errors).toEqual([]);
  });
});
