import { expect, test } from '@playwright/test';
import { collectPageErrors, resetDatabase, seedSampleData } from './helpers';

/*
 * Die Wochenansicht des Programm-Reiters.
 *
 * Die Beispieldaten liefern für den Nordic Curl je Woche eine Regel mit
 * `targetSeconds = 8 + weekNumber * 2` - also je Woche einen unterscheidbaren
 * Wert (W2 → 12 s, W5 → 18 s). Daran lässt sich prüfen, dass die Auswahl
 * wirklich die Woche wechselt und nicht nur den Chip einfärbt.
 *
 * Der zweite Test schützt die Fehlerklasse aus Teil 1 vor der Rückkehr durch
 * die andere Tür: eine Woche *ansehen* darf keinen `weekOverride` schreiben.
 */
test.describe('Programm-Wochenansicht', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
  });

  test('zeigt je Woche die Vorgaben, die der Sessionstart schreiben würde', async ({ page }) => {
    const errors = collectPageErrors(page);

    await page.goto('./#/programs');
    await page.waitForTimeout(1200);

    // Das Workout steht da, mit seinen Übungen.
    await expect(page.getByRole('heading', { name: 'Einheit A' })).toBeVisible();
    await expect(page.getByText('Nordic Curl Iso').first()).toBeVisible();

    await page.getByRole('tab', { name: 'W2' }).click();
    await page.waitForTimeout(500);
    await expect(page.getByText('3 × 12 s', { exact: false }).first()).toBeVisible();

    await page.getByRole('tab', { name: 'W5' }).click();
    await page.waitForTimeout(500);
    await expect(page.getByText('3 × 18 s', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('3 × 12 s', { exact: false })).toHaveCount(0);

    // Die Regel überschreibt die Sekunden - genau dieses Feld ist markiert.
    await expect(page.getByText('Woche', { exact: true }).first()).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('schreibt beim Wochenwechsel keinen Override', async ({ page }) => {
    await page.goto('./#/programs');
    await page.waitForTimeout(1200);

    await page.getByRole('tab', { name: 'W5' }).click();
    await page.waitForTimeout(500);
    await expect(page.getByRole('tab', { name: 'W5' })).toHaveAttribute('aria-selected', 'true');

    /*
     * Die Limettenfläche hängt an der *wirksamen* Woche, nicht am gewählten
     * Chip - sie darf beim Blättern nicht mitwandern.
     */
    await expect(page.getByText('Diese Woche')).toBeVisible();

    await page.goto('./#/settings');
    await page.waitForTimeout(900);

    await expect(page.getByRole('switch', { name: 'Woche von Hand setzen' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await expect(page.getByText('Override', { exact: true })).toHaveCount(0);
  });

  test('plant eine Zeile für genau eine Woche und nimmt sie wieder zurück', async ({ page }) => {
    const errors = collectPageErrors(page);

    await page.goto('./#/programs');
    await page.waitForTimeout(1200);

    await page.getByRole('tab', { name: 'W2' }).click();
    await page.waitForTimeout(500);

    await page.getByRole('button', { name: 'Front Squat für diese Woche planen' }).click();
    await page.locator('[data-sheet]').waitFor();
    await page.waitForTimeout(400);

    const sheet = page.locator('[data-sheet]');
    // Leer heißt "wie im Workout" - der Basiswert steht als Platzhalter.
    await expect(sheet.getByLabel('Ziel-Gewicht in kg')).toHaveAttribute('placeholder', '82,5 kg');

    await sheet.getByLabel('Ziel-Gewicht in kg').fill('90');
    await page.getByRole('button', { name: 'Wochenwerte speichern' }).click();
    await page.waitForTimeout(1000);

    await expect(page.getByText('90 kg').first()).toBeVisible();
    await expect(page.getByText('Woche', { exact: true }).first()).toBeVisible();

    // Genau eine Woche: W1 steht unverändert auf dem Basiswert.
    await page.getByRole('tab', { name: 'W1' }).click();
    await page.waitForTimeout(500);
    await expect(page.getByText('82,5 kg').first()).toBeVisible();
    await expect(page.getByText('90 kg')).toHaveCount(0);

    await page.getByRole('tab', { name: 'W2' }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Front Squat für diese Woche planen' }).click();
    await page.locator('[data-sheet]').waitFor();
    await page.waitForTimeout(400);

    await page.getByRole('button', { name: 'Auf Basiswerte zurück' }).click();
    await page.waitForTimeout(1000);

    await expect(page.getByText('90 kg')).toHaveCount(0);
    await expect(page.getByText('82,5 kg').first()).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('kennzeichnet eine Deload-Woche und plant weniger Sätze', async ({ page }) => {
    const errors = collectPageErrors(page);

    await page.goto('./#/programs/manage');
    await page.waitForTimeout(1200);

    await page.getByRole('button', { name: 'Woche 2 umbenennen' }).click();
    await page.waitForTimeout(400);
    await page.getByLabel('Art der Woche').selectOption('deload');
    await page.getByRole('button', { name: 'Speichern' }).first().click();
    await page.waitForTimeout(900);

    await page.goto('./#/programs');
    await page.waitForTimeout(1200);
    await page.getByRole('tab', { name: 'W2' }).click();
    await page.waitForTimeout(500);

    // Die Art steht am Wochenkopf - beschreibend, sie ändert keine Zielwerte.
    await expect(page.getByText('Deload', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('3 × 5 Wdh', { exact: false }).first()).toBeVisible();

    // Weniger Sätze für genau diese Woche - das ist die Reduktion von Hand.
    await page.getByRole('button', { name: 'Front Squat für diese Woche planen' }).click();
    await page.locator('[data-sheet]').waitFor();
    await page.waitForTimeout(400);
    await page.locator('[data-sheet]').getByLabel('Arbeitssätze').fill('2');
    await page.getByRole('button', { name: 'Wochenwerte speichern' }).click();
    await page.waitForTimeout(1000);

    await expect(page.getByText('2 × 5 Wdh', { exact: false }).first()).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('führt weiter zur Verwaltung', async ({ page }) => {
    await page.goto('./#/programs');
    await page.waitForTimeout(1200);

    await page.getByRole('button', { name: 'Programm verwalten' }).click();
    await page.waitForTimeout(900);

    await expect(page).toHaveURL(/#\/programs\/manage$/);
    await expect(page.getByRole('heading', { name: 'Neues Programm' })).toBeVisible();
  });
});
