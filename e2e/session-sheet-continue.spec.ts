import { expect, test, type Page } from '@playwright/test';
import {
  closeExerciseSheet,
  completeActiveSet,
  minimizeRestMode,
  openExerciseSheet,
  resetDatabase,
  seedSampleData,
  startSampleSession,
} from './helpers';

/*
 * Nach dem letzten Satz eines Blocks öffnet das Fokus-Sheet sofort den
 * nächsten offenen Block - kein Fertig-Bild, kein "Weiter"-Knopf dazwischen.
 * Die Atempause ist der Ruhemodus, der die Pause des fertigen Blocks zeigt.
 * Nach dem allerletzten Satz schließt sich das Sheet.
 */

/** Aufwärmsatz plus drei Arbeitssätze - der ganze Front Squat der Beispieleinheit. */
async function finishFrontSquat(page: Page) {
  await openExerciseSheet(page, 'Front Squat');

  for (let index = 0; index < 4; index += 1) {
    await completeActiveSet(page);
  }
}

test.describe('Fokus-Sheet nach dem letzten Satz', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
  });

  test('springt direkt in die nächste Übung', async ({ page }) => {
    await startSampleSession(page);
    await finishFrontSquat(page);

    const sheet = page.locator('[data-sheet]');

    await expect(sheet.getByRole('heading', { name: /Bulgarian Split Squat/ })).toBeVisible();
    await expect(sheet.getByRole('heading', { name: /Front Squat/ })).toHaveCount(0);
    await expect(sheet.getByRole('button', { name: /abhaken$/ })).toBeEnabled();
    await expect(sheet.getByText('Übung fertig', { exact: true })).toHaveCount(0);
    await expect(sheet.getByRole('button', { name: /^Weiter: / })).toHaveCount(0);
    await expect(page.getByRole('timer')).toHaveCount(1);
  });

  test('der Ruhemodus zeigt die Pause der fertigen Übung und nennt die nächste', async ({
    page,
  }) => {
    await startSampleSession(page);
    await openExerciseSheet(page, 'Front Squat');

    for (let index = 0; index < 3; index += 1) {
      await completeActiveSet(page);
    }

    // Den letzten Satz ohne den Helfer abhaken - der legt die Pause sofort weg.
    await page.locator('[data-sheet]').getByRole('button', { name: /abhaken$/ }).click();
    await page.waitForTimeout(800);

    const restMode = page.getByRole('dialog', { name: /^Pause · Front Squat/ });
    await expect(restMode).toBeVisible();
    await expect(restMode).toContainText(/Danach( ·|:) Bulgarian Split Squat · /);

    // Weggelegt liegt darunter schon die nächste Übung.
    await minimizeRestMode(page);
    await expect(
      page.locator('[data-sheet]').getByRole('heading', { name: /Bulgarian Split Squat/ }),
    ).toBeVisible();
  });

  test('nach der letzten offenen Übung schließt sich das Sheet', async ({ page }) => {
    await startSampleSession(page);

    await page.getByRole('button', { name: 'Bulgarian Split Squat auslassen' }).click();
    await page.getByRole('button', { name: 'Nordic Curl Iso auslassen' }).click();
    await page.waitForTimeout(600);

    await finishFrontSquat(page);

    // Nichts mehr, worauf gewartet würde: kein Ruhemodus, die Pause steht in der Leiste.
    await expect(page.locator('[data-sheet]')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: /^Pause · / })).toHaveCount(0);
    await expect(page.getByRole('timer')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Session abschließen' }).first()).toBeVisible();
  });

  test('ein Supersatz als nächster Block öffnet sich als ganzer', async ({ page }) => {
    await startSampleSession(page);

    await openExerciseSheet(page, 'Nordic Curl Iso');
    await page.getByRole('button', { name: 'Nordic Curl Iso mit voriger Übung verbinden' }).click();
    await page.waitForTimeout(600);
    await closeExerciseSheet(page);

    await finishFrontSquat(page);

    const sheet = page.locator('[data-sheet]');
    await expect(sheet.getByRole('heading', { name: /Bulgarian Split Squat/ })).toBeVisible();
    await expect(sheet.getByRole('heading', { name: /Nordic Curl Iso/ })).toBeVisible();
  });
});
