import { expect, test, type Page } from '@playwright/test';
import { collectPageErrors, resetDatabase, seedSampleData } from './helpers';

/*
 * Das Jetzt-Sheet ("Jetzt trainieren") öffnet über den mittleren Tab-Knopf mit
 * `aria-label="Jetzt trainieren"`.
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

/** Die Beispieldaten kennen nur „Einheit A": „Einheit B" entsteht als Kopie samt Übungen. */
async function addSecondWorkout(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('gym-book-db');

        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          const tx = database.transaction(['workoutTemplates', 'workoutTemplateExercises'], 'readwrite');
          const templates = tx.objectStore('workoutTemplates');
          const rows = tx.objectStore('workoutTemplateExercises');
          const all = templates.getAll();

          all.onsuccess = () => {
            const source = all.result.find((item: { name: string }) => item.name === 'Einheit A');
            const stamp = new Date().toISOString();
            const copyId = 'e2e-einheit-b';

            templates.put({ ...source, id: copyId, name: 'Einheit B', updatedAt: stamp });

            const sourceRows = rows.index('templateId').getAll(source.id);

            sourceRows.onsuccess = () => {
              for (const row of sourceRows.result) {
                rows.put({ ...row, id: `${copyId}-${row.id}`, templateId: copyId });
              }
            };
          };
          tx.oncomplete = () => {
            database.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  // Neu laden, damit die Live-Abfragen die Fremdschreibung sicher sehen.
  await page.reload();
  await page.waitForTimeout(800);
}

async function openNowSheet(page: Page) {
  await page.getByRole('button', { name: 'Jetzt trainieren' }).click();
  await expect(page.locator('[data-sheet]')).toBeVisible();
}

test.describe('Jetzt-Sheet', () => {
  test('der Jetzt-Knopf öffnet das Sheet von jedem Tab aus', async ({ page }) => {
    const errors = collectPageErrors(page);

    await startWithEmptyPlan(page);
    await openNowSheet(page);
    await expect(page.locator('[data-sheet]').getByRole('radiogroup')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('der Filter „Mobility" blendet Einheit A aus', async ({ page }) => {
    await startWithEmptyPlan(page);
    await openNowSheet(page);

    const sheet = page.locator('[data-sheet]');
    await expect(sheet.getByRole('button', { name: /Einheit A/ })).toBeVisible();

    await sheet.getByRole('radio', { name: 'Mobility' }).click();
    await expect(sheet.getByRole('button', { name: /Einheit A/ })).toHaveCount(0);
  });

  test('ein Tap auf Einheit A startet und führt in die Session', async ({ page }) => {
    await startWithEmptyPlan(page);
    await openNowSheet(page);

    await page.locator('[data-sheet]').getByRole('button', { name: /Einheit A/ }).click();
    await page.waitForURL(/#\/session\//);
  });

  test('ein zweiter Start bei laufender Session führt in dieselbe Session-URL', async ({ page }) => {
    await startWithEmptyPlan(page);
    await addSecondWorkout(page);
    await openNowSheet(page);
    await page.locator('[data-sheet]').getByRole('button', { name: /Einheit A/ }).click();
    await page.waitForURL(/#\/session\//);
    const firstUrl = page.url();

    // Raus aus der Session (minimieren), dann das zweite Workout über das Sheet starten:
    // `startSessionFromTemplate` gibt die laufende Session zurück, die URL bleibt dieselbe.
    await page.getByRole('button', { name: 'Session minimieren' }).click();
    await openNowSheet(page);
    await page.locator('[data-sheet]').getByRole('button', { name: /Einheit B/ }).click();
    await page.waitForURL(/#\/session\//);

    expect(page.url()).toBe(firstUrl);
  });
});
