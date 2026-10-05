import { expect, test, type Page } from '@playwright/test';
import {
  collectPageErrors,
  completeActiveSet,
  closeExerciseSheet,
  openExerciseSheet,
  resetDatabase,
  seedSampleData,
} from './helpers';

/*
 * Termine im Programm-Tab. Das Startdatum liegt auf dem Montag dieser Woche,
 * damit "heute" in Programmwoche 1 liegt und die Terminliste genau diese
 * Woche zeigt.
 */
async function setStartToThisMonday(page: Page) {
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
}

/*
 * Die Beispieldaten bringen Termine für Einheit A mit. Diese Tests gehen von
 * einem leeren Plan aus, also räumen sie ihn vorher leer.
 */
async function clearPlanEntries(page: Page) {
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
}

async function addRun(page: Page, title: string, extra?: { distance?: string; pace?: string }) {
  await page.getByRole('button', { name: 'Termin hinzufügen' }).click();

  const sheet = page.locator('[data-sheet]');
  await sheet.getByRole('button', { name: 'Lauf', exact: true }).click();
  await sheet.getByLabel('Titel').fill(title);

  if (extra?.distance) {
    await sheet.getByLabel('Strecke (km)').fill(extra.distance);
  }

  if (extra?.pace) {
    await sheet.getByLabel('Pace (m:ss pro km)').fill(extra.pace);
  }

  await sheet.getByRole('button', { name: 'Termin speichern' }).click();
}

test.describe('Termine im Programm-Tab', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
    await clearPlanEntries(page);
    await setStartToThisMonday(page);
  });

  test('legt einen Lauf-Termin an und zeigt die Vorgabe', async ({ page }) => {
    const errors = collectPageErrors(page);

    await expect(page.getByText('Keine Termine in dieser Woche')).toBeVisible();

    await addRun(page, 'Intervalle 6×400', { distance: '7', pace: '5:00' });

    const entry = page.locator('[data-plan-entry]').filter({ hasText: 'Intervalle 6×400' });
    await expect(entry).toBeVisible();
    await expect(entry).toContainText('7 km · 5:00 /km');
    await expect(entry).toHaveAttribute('data-plan-entry-state', 'offen');
    await expect(page.locator('[data-plan-week]')).toHaveCount(1);

    expect(errors).toEqual([]);
  });

  test('Serie legt Termine an und meldet Duplikate', async ({ page }) => {
    const errors = collectPageErrors(page);

    async function createSeries() {
      const sheet = page.locator('[data-sheet]');

      await sheet.getByLabel('Workout', { exact: true }).selectOption({ label: 'Einheit A' });
      await sheet.getByRole('button', { name: 'Montag' }).click();
      await sheet.getByRole('button', { name: 'Donnerstag' }).click();
      await sheet.getByLabel('Wochen', { exact: true }).fill('2');
      await sheet.getByRole('button', { name: 'Serie anlegen' }).click();
      await page.waitForTimeout(600);
    }

    await page.getByRole('button', { name: 'Serie anlegen' }).click();
    await createSeries();
    await expect(page.locator('[data-sheet]').getByRole('status')).toContainText('4 angelegt');

    // Zweiter Durchlauf: die Wochentage stehen noch, nur die Meldung ändert sich.
    await page.locator('[data-sheet]').getByLabel('Wochen', { exact: true }).fill('2');
    await page.locator('[data-sheet]').getByRole('button', { name: 'Serie anlegen' }).click();
    await expect(page.locator('[data-sheet]').getByRole('status')).toContainText('gab es schon');

    expect(errors).toEqual([]);
  });

  test('Doppelter Termin zeigt die Meldung', async ({ page }) => {
    const errors = collectPageErrors(page);

    await addRun(page, 'Dauerlauf');
    await expect(page.locator('[data-plan-entry]').filter({ hasText: 'Dauerlauf' })).toBeVisible();

    await addRun(page, 'Dauerlauf');
    await expect(page.locator('[data-sheet]').getByRole('alert')).toContainText('schon im Plan');

    expect(errors).toEqual([]);
  });

  test('passt bei 320px', async ({ page }) => {
    const errors = collectPageErrors(page);

    await page.setViewportSize({ width: 320, height: 700 });
    await addRun(page, 'Ein sehr langer Titel für einen Lauf am Wochenende im Wald', {
      distance: '12,5',
      pace: '5:30',
    });
    await expect(page.locator('[data-plan-entry]')).toHaveCount(1);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    expect(errors).toEqual([]);
  });

  test('Home startet den heutigen Termin und markiert ihn erledigt', async ({ page }) => {
    const errors = collectPageErrors(page);

    await page.getByRole('button', { name: 'Termin hinzufügen' }).click();
    const sheet = page.locator('[data-sheet]');
    await sheet.getByLabel('Workout', { exact: true }).selectOption({ label: 'Einheit A' });
    await sheet.getByRole('button', { name: 'Termin speichern' }).click();
    await expect(page.locator('[data-plan-entry]').filter({ hasText: 'Einheit A' })).toHaveAttribute(
      'data-plan-entry-state',
      'offen',
    );

    await page.goto('./');
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: /Heute · Einheit A/ }).click();
    await page.waitForURL(/#\/session\//);
    await page.waitForTimeout(600);

    await openExerciseSheet(page);
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

  test('ohne Termine bleibt Am längsten her', async ({ page }) => {
    await page.goto('./');
    await page.waitForTimeout(800);

    await expect(page.getByText('Am längsten her')).toBeVisible();
    await expect(page.getByText('Nächster Termin')).toHaveCount(0);
  });
});
