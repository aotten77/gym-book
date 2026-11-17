import { expect, test, type Page } from '@playwright/test';
import { collectPageErrors, resetDatabase, seedSampleData } from './helpers';

/*
 * Das Jetzt-Sheet ("Jetzt trainieren") öffnet über den mittleren Tab-Knopf mit
 * `aria-label="Jetzt trainieren"`. Den baut erst Task 4 ein - bis dahin gibt es
 * keinen Weg, das Sheet zu öffnen, und die Tests sind deshalb `fixme`.
 * wird in Task 4 aktiviert
 */

/** Beispieldaten ohne Termine: sonst stünde "Einheit A" je nach Wochentag als Lime-Zeile oben. */
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

async function openNowSheet(page: Page) {
  await page.getByRole('button', { name: 'Jetzt trainieren' }).click();
  await expect(page.locator('[data-sheet]')).toBeVisible();
}

test.describe('Jetzt-Sheet', () => {
  test.fixme('der Jetzt-Knopf öffnet das Sheet von jedem Tab aus', async ({ page }) => {
    // wird in Task 4 aktiviert
    const errors = collectPageErrors(page);

    await startWithEmptyPlan(page);
    await openNowSheet(page);
    await expect(page.locator('[data-sheet]').getByRole('radiogroup')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test.fixme('der Filter „Mobility" blendet Einheit A aus', async ({ page }) => {
    // wird in Task 4 aktiviert
    await startWithEmptyPlan(page);
    await openNowSheet(page);

    const sheet = page.locator('[data-sheet]');
    await expect(sheet.getByRole('button', { name: /Einheit A/ })).toBeVisible();

    await sheet.getByRole('radio', { name: 'Mobility' }).click();
    await expect(sheet.getByRole('button', { name: /Einheit A/ })).toHaveCount(0);
  });

  test.fixme('ein Tap auf Einheit A startet und führt in die Session', async ({ page }) => {
    // wird in Task 4 aktiviert
    await startWithEmptyPlan(page);
    await openNowSheet(page);

    await page.locator('[data-sheet]').getByRole('button', { name: /Einheit A/ }).click();
    await page.waitForURL(/#\/session\//);
  });

  test.fixme('ein zweiter Start bei laufender Session führt in dieselbe Session-URL', async ({ page }) => {
    // wird in Task 4 aktiviert
    await startWithEmptyPlan(page);
    await openNowSheet(page);
    await page.locator('[data-sheet]').getByRole('button', { name: /Einheit A/ }).click();
    await page.waitForURL(/#\/session\//);
    const firstUrl = page.url();

    // Raus aus der Session (minimieren), dann ein anderes Workout über das Sheet starten.
    await page.getByRole('button', { name: 'Session minimieren' }).click();
    await openNowSheet(page);
    await page.locator('[data-sheet]').getByRole('button', { name: /Einheit B/ }).click();
    await page.waitForURL(/#\/session\//);

    expect(page.url()).toBe(firstUrl);
  });
});
