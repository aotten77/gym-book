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
 * Nach dem letzten Satz eines Blocks bleibt das Fokus-Sheet offen: die Übung
 * steht waldgrün als fertig darin, darunter ruhig, was danach kommt, und der
 * große Knopf im Fuß heißt "Weiter: …". Gesprungen wird erst auf den Tap.
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

  test('zeigt die Übung als fertig und öffnet erst auf Tap die nächste', async ({ page }) => {
    await startSampleSession(page);
    await finishFrontSquat(page);

    const sheet = page.locator('[data-sheet]');
    const finished = sheet.locator('[data-sheet-finished]');

    await expect(finished).toBeVisible();
    await expect(finished.getByRole('heading', { name: 'Front Squat' })).toBeVisible();
    await expect(sheet.getByText('Übung fertig', { exact: true })).toBeVisible();
    await expect(sheet.locator('[data-sheet-next]')).toContainText('Bulgarian Split Squat');

    // Keine Bühne, kein Abhaken - und die Pause steht weiter als Chip im Fuß.
    await expect(sheet.locator('[data-set-row]')).toHaveCount(0);
    await expect(sheet.getByRole('button', { name: /abhaken$/ })).toHaveCount(0);
    await expect(page.getByRole('timer')).toHaveCount(1);

    // Kein Selbstsprung: auch nach einer Weile steht dasselbe Bild.
    await page.waitForTimeout(1200);
    await expect(finished).toBeVisible();

    const next = sheet.getByRole('button', { name: 'Weiter: Bulgarian Split Squat' });
    await expect(next).toHaveAttribute('data-sheet-continue', '');
    await next.click();
    await page.waitForTimeout(400);

    await expect(finished).toHaveCount(0);
    await expect(sheet.getByRole('heading', { name: /Bulgarian Split Squat/ })).toBeVisible();
    await expect(sheet.getByRole('button', { name: /abhaken$/ })).toBeVisible();
  });

  test('der Ruhemodus nennt nach dem letzten Satz die nächste Übung', async ({ page }) => {
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

    // Weggelegt liegt darunter das Fertig-Bild.
    await minimizeRestMode(page);
    await expect(page.locator('[data-sheet-finished]')).toBeVisible();
  });

  test('nach der letzten offenen Übung führt der Knopf zur Übersicht', async ({ page }) => {
    await startSampleSession(page);

    await page.getByRole('button', { name: 'Bulgarian Split Squat auslassen' }).click();
    await page.getByRole('button', { name: 'Nordic Curl Iso auslassen' }).click();
    await page.waitForTimeout(600);

    await finishFrontSquat(page);

    const sheet = page.locator('[data-sheet]');
    await expect(sheet.getByText('Alle Übungen fertig', { exact: true })).toBeVisible();
    await expect(sheet.locator('[data-sheet-next]')).toHaveCount(0);
    // Nichts mehr, worauf gewartet würde: kein Ruhemodus, die Pause steht im Fuß.
    await expect(page.getByRole('dialog', { name: /^Pause · / })).toHaveCount(0);
    await expect(page.getByRole('timer')).toHaveCount(1);

    await sheet.getByRole('button', { name: 'Zur Übersicht' }).click();
    await page.waitForTimeout(400);

    await expect(sheet).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Session abschließen' }).first()).toBeVisible();
  });

  test('„Weiter“ öffnet einen Supersatz als ganzen Block', async ({ page }) => {
    await startSampleSession(page);

    await openExerciseSheet(page, 'Nordic Curl Iso');
    await page.getByRole('button', { name: 'Nordic Curl Iso mit voriger Übung verbinden' }).click();
    await page.waitForTimeout(600);
    await closeExerciseSheet(page);

    await finishFrontSquat(page);

    const sheet = page.locator('[data-sheet]');
    await expect(sheet.locator('[data-sheet-next]')).toContainText(
      'Bulgarian Split Squat + Nordic Curl Iso',
    );

    await sheet.getByRole('button', { name: 'Weiter: Bulgarian Split Squat' }).click();
    await page.waitForTimeout(400);

    await expect(sheet.getByRole('heading', { name: /Bulgarian Split Squat/ })).toBeVisible();
    await expect(sheet.getByRole('heading', { name: /Nordic Curl Iso/ })).toBeVisible();
  });
});
