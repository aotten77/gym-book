import { expect, test, type Page } from '@playwright/test';
import { closeExerciseSheet, collectPageErrors, importPlan, resetDatabase, seedSampleData } from './helpers';

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
  await page.goto('./');
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

/** Der lokale Tag `offset` Tage von heute, so wie die App ihn rechnet (`YYYY-MM-DD`). */
async function dayKey(page: Page, offset: number) {
  return page.evaluate((days) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');

    return `${date.getFullYear()}-${month}-${day}`;
  }, offset);
}

/** Der Termin-Tag der laufenden Session (`planDateSnapshot`), `null` ohne Termin. */
async function activePlanDate(page: Page) {
  return page.evaluate(
    () =>
      new Promise<string | null>((resolve, reject) => {
        const open = indexedDB.open('gym-book-db');

        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          const request = database.transaction('workoutSessions').objectStore('workoutSessions').getAll();

          request.onsuccess = () => {
            database.close();
            const active = request.result.find((session: { status: string }) => session.status === 'active');
            resolve(active?.planDateSnapshot ?? null);
          };
          request.onerror = () => reject(request.error);
        };
      }),
  );
}

/** Einheit A morgen, Einheit B gestern: je ein Eintrag unter „Geplant“ und „Nachholen“. */
async function planAroundToday(page: Page) {
  await startWithEmptyPlan(page);
  await addSecondWorkout(page);
  await importPlan(page, [
    { date: await dayKey(page, 1), workout: 'Einheit A' },
    { date: await dayKey(page, -1), workout: 'Einheit B' },
  ]);
  await page.goto('./');
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
    await expect(page.locator('[data-sheet] [data-now-section="spontan"]')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('ohne Termine steht alles unter „Spontan“, Filter gibt es keine', async ({ page }) => {
    await startWithEmptyPlan(page);
    await openNowSheet(page);

    const sheet = page.locator('[data-sheet]');
    await expect(sheet.locator('[data-now-section="spontan"]').getByRole('button', { name: /Einheit A/ })).toBeVisible();
    await expect(sheet.locator('[data-now-section="geplant"]')).toHaveCount(0);
    await expect(sheet.locator('[data-now-section="nachholen"]')).toHaveCount(0);
    await expect(sheet.getByRole('radiogroup')).toHaveCount(0);
  });

  test('Geplant und Nachholen stehen unter Spontan, gefüllt aus dem Plan', async ({ page }) => {
    await planAroundToday(page);
    await openNowSheet(page);

    const sheet = page.locator('[data-sheet]');
    const sections = sheet.locator('[data-now-section]');

    await expect(sections).toHaveCount(3);
    expect(await sections.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-now-section')))).toEqual(
      ['nachholen', 'spontan', 'geplant'],
    );
    await expect(sheet.locator('[data-now-section="geplant"]')).toContainText('Einheit A');
    await expect(sheet.locator('[data-now-section="nachholen"]')).toContainText('Einheit B');
    // Einheit B steht ab heute nirgends mehr im Plan - also auch spontan.
    await expect(sheet.locator('[data-now-section="spontan"]')).toContainText('Einheit B');
    await expect(sheet.locator('[data-now-section="spontan"]')).not.toContainText('Einheit A');
  });

  test('ein geplantes Workout von morgen fragt und zieht den Termin vor', async ({ page }) => {
    await planAroundToday(page);
    await openNowSheet(page);

    await page.locator('[data-now-section="geplant"]').getByRole('button', { name: /Einheit A/ }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Einheit A ist für');
    await dialog.getByRole('button', { name: /vorziehen$/ }).click();
    await page.waitForURL(/#\/session\//);

    expect(await activePlanDate(page)).toBe(await dayKey(page, 1));
  });

  test('„Zusätzlich trainieren“ startet ohne Termin', async ({ page }) => {
    await planAroundToday(page);
    await openNowSheet(page);

    await page.locator('[data-now-section="geplant"]').getByRole('button', { name: /Einheit A/ }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Zusätzlich trainieren' }).click();
    await page.waitForURL(/#\/session\//);

    expect(await activePlanDate(page)).toBeNull();
  });

  test('ein Termin von gestern lässt sich nachholen', async ({ page }) => {
    await planAroundToday(page);
    await openNowSheet(page);

    await page.locator('[data-now-section="nachholen"]').getByRole('button', { name: /Einheit B/ }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Einheit B war für');
    await dialog.getByRole('button', { name: /nachholen$/ }).click();
    await page.waitForURL(/#\/session\//);

    expect(await activePlanDate(page)).toBe(await dayKey(page, -1));
  });

  test('„Abbrechen“ schließt die Rückfrage, ohne zu starten', async ({ page }) => {
    await planAroundToday(page);
    await openNowSheet(page);

    await page.locator('[data-now-section="geplant"]').getByRole('button', { name: /Einheit A/ }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Abbrechen' }).click();

    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.locator('[data-sheet] [data-now-section="geplant"]')).toBeVisible();
    expect(page.url()).not.toMatch(/#\/session\//);
  });

  test('ein Tap auf Einheit A startet und führt in die Session', async ({ page }) => {
    await startWithEmptyPlan(page);
    await openNowSheet(page);

    await page.locator('[data-sheet]').getByRole('button', { name: /Einheit A/ }).click();
    await page.waitForURL(/#\/session\//);
  });

  test('bei laufender Session zeigt das Sheet „Training läuft“ statt der Startoptionen', async ({ page }) => {
    await startWithEmptyPlan(page);
    await addSecondWorkout(page);
    await openNowSheet(page);
    await page.locator('[data-sheet]').getByRole('button', { name: /Einheit A/ }).click();
    await page.waitForURL(/#\/session\//);
    const sessionUrl = page.url();

    // Der frische Start hat das Fokus-Sheet geöffnet; es muss weg, bevor der Minimieren-Knopf erreichbar ist.
    await closeExerciseSheet(page);
    await page.getByRole('button', { name: 'Session minimieren' }).click();
    await openNowSheet(page);

    const sheet = page.locator('[data-sheet]');
    const back = sheet.getByRole('link', { name: /Training läuft · zurück/ });

    // Kein stummer zweiter Start: keine Sektionen, keine Startzeilen, dafür der Satz dazu.
    await expect(back).toBeVisible();
    await expect(back).toContainText('Einheit A');
    await expect(sheet.getByText('Ein Training läuft bereits')).toBeVisible();
    await expect(sheet.locator('[data-now-section]')).toHaveCount(0);
    await expect(sheet.getByRole('button', { name: /Einheit B/ })).toHaveCount(0);
    await expect(sheet.getByText('Heute geplant')).toHaveCount(0);
    // „Erfassen" sind keine Session-Starts und bleiben.
    await expect(sheet.getByRole('button', { name: 'Lauf eintragen' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Test erfassen' })).toBeVisible();

    // Rückkehr, kein Start: dieselbe Session, ohne offenes Fokus-Sheet.
    await back.click();
    await page.waitForURL(/#\/session\//);
    await page.waitForTimeout(800);

    expect(page.url()).toBe(sessionUrl);
    await expect(page.getByRole('button', { name: 'Session minimieren' })).toBeVisible();
    await expect(page.locator('[data-sheet]')).toBeHidden();
  });

  test('bei 320px läuft keine Sektion über den Rand', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await planAroundToday(page);
    await openNowSheet(page);

    const sheet = page.locator('[data-sheet]');
    await expect(sheet.locator('[data-now-section]')).toHaveCount(3);

    const sticksOut = await sheet.evaluate((root) => {
      const edge = root.getBoundingClientRect().right + 0.5;

      return Array.from(root.querySelectorAll('[data-now-section] *'))
        .filter((node) => node.getBoundingClientRect().right > edge || node.scrollWidth > node.clientWidth + 0.5)
        .map((node) => node.outerHTML.slice(0, 80));
    });

    expect(sticksOut).toEqual([]);
  });

  test('bei 320px sind „Lauf eintragen“ und „Test erfassen“ nicht abgeschnitten', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await startWithEmptyPlan(page);
    await openNowSheet(page);

    // `truncate` schneidet still ab: sichtbar wird das nur als scrollWidth > clientWidth.
    for (const name of ['Lauf eintragen', 'Test erfassen']) {
      const label = page
        .locator('[data-sheet]')
        .getByRole('button', { name })
        .locator('span')
        .filter({ hasText: name });
      const clipped = await label.evaluate((element) => element.scrollWidth - element.clientWidth);

      expect(clipped, `${name} wird abgeschnitten`).toBeLessThanOrEqual(0);
    }
  });
});
