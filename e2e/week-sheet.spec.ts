import { expect, test, type Page } from '@playwright/test';
import {
  clearPlanEntries,
  collectPageErrors,
  importPlan,
  resetDatabase,
  seedSampleData,
  setProgramStart,
} from './helpers';

/*
 * Das Wochen-Sheet: ein Tap auf den Wochenkopf des Plans öffnet die Woche zum
 * Lesen. Die Beispieldaten liefern für den Nordic Curl je Woche eine Regel mit
 * `targetSeconds = 8 + weekNumber * 2` - je Woche ein unterscheidbarer Wert
 * (W2 → 12 s, W5 → 18 s). Daran lässt sich prüfen, dass ‹ › wirklich die Woche
 * wechselt und nicht nur den Titel.
 *
 * Gerechnet wird relativ zu heute: die Tests laufen am echten Datum.
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

/** Öffnet das Wochen-Sheet der laufenden Woche über ihren Kopf im Plan. */
async function openCurrentWeekSheet(page: Page) {
  await page.goto('./');
  await page.waitForTimeout(900);
  await page.locator('[data-timeline-week-head][data-current]').click();
  await expect(page.locator('[data-week-sheet]')).toBeVisible();
}

/** Das Sheet selbst: Titel und Knöpfe stehen in seinem Kopf, der Inhalt im `[data-week-sheet]`. */
function weekSheet(page: Page) {
  return page.locator('[data-sheet]');
}

test.describe('Wochen-Sheet', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
    // Programmwochen ("W2") gibt es nur mit Startdatum: Woche 1 = diese Woche.
    await setProgramStart(page, await localDay(page, 0, true));
    await clearPlanEntries(page);
    await importPlan(page, [
      { date: await localDay(page, 0, true), workout: 'Einheit A' },
      { date: await localDay(page, 3, true), workout: 'Einheit A' },
    ]);
  });

  test('öffnet über den Kopf der laufenden Woche mit Kacheln und Vorgaben', async ({ page }) => {
    const errors = collectPageErrors(page);

    await openCurrentWeekSheet(page);

    const sheet = weekSheet(page);

    await expect(sheet.getByRole('heading', { name: /^W1/ })).toBeVisible();
    await expect(sheet.getByText('diese Woche')).toBeVisible();
    await expect(page.locator('[data-week-tile="strength"]')).toBeVisible();
    await expect(page.locator('[data-week-tile="mobility"]')).toBeVisible();
    await expect(page.locator('[data-week-tile="run"]')).toBeVisible();
    await expect(sheet.getByRole('heading', { name: 'Vorgaben W1' })).toBeVisible();
    await expect(sheet.getByRole('heading', { name: 'Einheit A' })).toBeVisible();
    await expect(sheet.getByText('Nur zum Lesen.', { exact: false })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('zeigt je Woche die Vorgaben, die der Sessionstart schreiben würde', async ({ page }) => {
    const errors = collectPageErrors(page);

    await openCurrentWeekSheet(page);

    const sheet = weekSheet(page);

    // Das Workout steht da, mit der überschriebenen Übung.
    await expect(sheet.getByRole('heading', { name: 'Einheit A' })).toBeVisible();
    await expect(sheet.getByText('Nordic Curl Iso').first()).toBeVisible();

    await sheet.getByRole('button', { name: 'Nächste Woche' }).click();
    await expect(sheet.getByRole('heading', { name: 'Vorgaben W2' })).toBeVisible();
    await expect(sheet.getByText('3 × 12 s', { exact: false }).first()).toBeVisible();

    for (let step = 0; step < 3; step += 1) {
      await sheet.getByRole('button', { name: 'Nächste Woche' }).click();
    }

    await expect(sheet.getByRole('heading', { name: 'Vorgaben W5' })).toBeVisible();
    await expect(sheet.getByText('3 × 18 s', { exact: false }).first()).toBeVisible();
    await expect(sheet.getByText('3 × 12 s', { exact: false })).toHaveCount(0);

    // Die Regel überschreibt die Sekunden - die Zeile trägt das Abzeichen ihrer Woche.
    await expect(sheet.locator('[data-rule-badge]').first()).toHaveText('W5');

    expect(errors).toEqual([]);
  });

  test('kennzeichnet eine Deload-Woche und zeigt weniger Sätze', async ({ page }) => {
    const errors = collectPageErrors(page);

    await page.goto('./#/programs/manage');
    await page.waitForTimeout(1200);

    await page.getByRole('button', { name: 'Woche 2 umbenennen' }).click();
    await page.waitForTimeout(400);
    await page.getByLabel('Art der Woche').selectOption('deload');
    await page.getByRole('button', { name: 'Speichern' }).first().click();
    await page.waitForTimeout(900);

    // Weniger Sätze für genau diese Woche - die Reduktion von Hand, als Regel in W2.
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open('gym-book-db');

          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const database = open.result;
            const tx = database.transaction(['programWeeks', 'progressionRules'], 'readwrite');
            const weeks = tx.objectStore('programWeeks').getAll();

            weeks.onsuccess = () => {
              const weekTwo = (weeks.result as { id: string; weekNumber: number }[]).find(
                (week) => week.weekNumber === 2,
              );
              const rules = tx.objectStore('progressionRules').getAll();

              rules.onsuccess = () => {
                for (const rule of rules.result as { programWeekId: string }[]) {
                  if (rule.programWeekId === weekTwo?.id) {
                    tx.objectStore('progressionRules').put({ ...rule, workSetCount: 2 });
                  }
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

    await openCurrentWeekSheet(page);

    const sheet = weekSheet(page);

    await sheet.getByRole('button', { name: 'Nächste Woche' }).click();

    // Die Art steht im Titel - beschreibend, sie ändert keine Zielwerte.
    await expect(sheet.getByRole('heading', { name: /^W2 · Deload/ })).toBeVisible();

    const row = sheet.locator('[data-week-row]').filter({ hasText: 'Nordic Curl Iso' });

    await expect(row.getByText('2 × 12 s', { exact: false })).toBeVisible();
    await expect(row.locator('[data-rule-badge]')).toHaveText('W2');

    expect(errors).toEqual([]);
  });

  test('blättern schreibt keinen Override', async ({ page }) => {
    await openCurrentWeekSheet(page);

    const sheet = weekSheet(page);

    await sheet.getByRole('button', { name: 'Nächste Woche' }).click();
    await sheet.getByRole('button', { name: 'Nächste Woche' }).click();
    await sheet.getByRole('button', { name: 'Vorige Woche' }).click();
    await expect(sheet.getByRole('heading', { name: /^W2/ })).toBeVisible();
    await sheet.getByRole('button', { name: 'Woche schließen' }).click();

    await page.goto('./#/settings');
    await page.waitForTimeout(900);

    await expect(page.getByRole('switch', { name: 'Woche von Hand setzen' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await expect(page.getByText('Override', { exact: true })).toHaveCount(0);
  });

  test('sagt in der laufenden Woche, dass ein Start die von Hand gesetzte Woche trainiert', async ({
    page,
  }) => {
    await page.goto('./#/settings');
    await page.waitForTimeout(900);
    await page.getByRole('switch', { name: 'Woche von Hand setzen' }).click();
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'Override-Woche vor' }).click();
    await page.waitForTimeout(600);
    await expect(page.getByText(/^Override/)).toBeVisible();

    await openCurrentWeekSheet(page);

    await expect(page.locator('[data-week-sheet]')).toContainText('Von Hand auf W2 gesetzt');
    await expect(page.locator('[data-week-sheet]')).toContainText('nicht W1');

    // In einer anderen Woche gilt der Hinweis nicht: er betrifft nur, was ein Start jetzt trainiert.
    await weekSheet(page).getByRole('button', { name: 'Nächste Woche' }).click();
    await expect(weekSheet(page).getByRole('heading', { name: /^W2/ })).toBeVisible();
    await expect(page.locator('[data-week-sheet]')).not.toContainText('Von Hand auf');
  });

  test('klappt die Basiswerte eines Workouts auf', async ({ page }) => {
    await openCurrentWeekSheet(page);

    const block = page.locator('[data-week-prescription]').first();
    const toggle = block.getByRole('button', { name: /weitere wie im Workout/ });
    const rowsBefore = await block.locator('[data-week-row]').count();

    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();

    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(await block.locator('[data-week-row]').count()).toBeGreaterThan(rowsBefore);
  });

  test('läuft bei 320px nicht über', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await openCurrentWeekSheet(page);

    const overflow = await page.evaluate(() => {
      const tile = document.querySelector('[data-week-tile]');
      const grid = tile?.parentElement;
      const root = document.querySelector('[data-week-sheet]');

      return {
        grid: grid ? grid.scrollWidth - grid.clientWidth : null,
        root: root ? root.scrollWidth - root.clientWidth : null,
      };
    });

    expect(overflow.grid).not.toBeNull();
    expect(overflow.grid).toBeLessThanOrEqual(0);
    expect(overflow.root).toBeLessThanOrEqual(0);
  });
});
