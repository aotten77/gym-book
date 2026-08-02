import { expect, test } from '@playwright/test';
import {
  collectPageErrors,
  closeExerciseSheet,
  completeActiveSet,
  openExerciseSheet,
  resetDatabase,
  seedSampleData,
  startSampleSession,
} from './helpers';

/*
 * Übungen mit Widerstandsbändern protokollieren statt Kilo eine Stufe aus dem
 * Band-Katalog. Der Weg läuft komplett über `<select>` - und genau daran ist
 * die App unter WebKit schon einmal gescheitert: mit nativem `appearance`
 * ignoriert Safari ein `min-height` und lässt das Feld auf 22px zusammenfallen.
 */
test.describe('Band-Übungen', () => {
  test('Katalog anlegen, Satz mit Band loggen, Historie prüfen', async ({ page }) => {
    const errors = collectPageErrors(page);

    await resetDatabase(page);
    // Beispieldaten zuerst: sie sind nur bei leerer Bibliothek möglich.
    await seedSampleData(page);

    await page.goto('./#/settings');
    await page.waitForTimeout(900);

    await page.getByRole('button', { name: 'Standard-Bänder einfügen' }).click();
    await page.waitForTimeout(900);
    await expect(page.getByText('gelb', { exact: true })).toBeVisible();

    // Reihenfolge ist bei Bändern der Inhalt, nicht Kosmetik.
    await page.getByRole('button', { name: 'rot nach oben' }).click();
    await page.waitForTimeout(700);
    await expect(page.getByRole('button', { name: 'rot nach oben' })).toBeDisabled();

    await page.goto('./#/exercises');
    await page.waitForTimeout(900);

    await page.getByRole('button', { name: 'Anlegen' }).first().click();
    await page.getByLabel('Name').fill('Band Pull-Apart');
    await page.getByLabel('Belastung').selectOption('band');
    await page.getByRole('button', { name: 'Anlegen' }).last().click();
    await page.waitForTimeout(1000);

    const sessionUrl = await startSampleSession(page);

    // Die Session-Steuerung steht oben und unten - hier der obere Block.
    await page.getByRole('button', { name: 'Übung hinzufügen' }).first().click();
    await page.waitForTimeout(500);
    await page.getByLabel('Übung', { exact: true }).selectOption({ label: 'Band Pull-Apart' });
    await page.waitForTimeout(500);

    // Kilo und Band schließen sich aus: für diese Übung darf es kein
    // Gewichtsfeld geben.
    await expect(page.getByLabel('Ziel-Band')).toBeVisible();
    await expect(page.getByLabel('Ziel-Gewicht')).toBeHidden();

    await page.getByLabel('Ziel-Band').selectOption({ label: 'gelb' });
    await page.getByRole('button', { name: 'Zur Session hinzufügen' }).click();
    await page.waitForTimeout(1200);

    // Die Satzfelder stehen im Fokus-Sheet, nicht in der Liste.
    await openExerciseSheet(page, 'Band Pull-Apart');

    const bandSelect = page.locator('select[id$="-bandId"]').first();
    await expect(bandSelect).toBeVisible();

    const selectHeight = await bandSelect.evaluate((element) => element.getBoundingClientRect().height);
    expect(selectHeight).toBeGreaterThanOrEqual(44);

    await bandSelect.selectOption({ label: 'grün' });
    await page.waitForTimeout(900);

    // Der Wert muss einen Reload überstehen - im Training passiert genau das
    // durch ein Service-Worker-Update mitten im Satz.
    await page.goto(sessionUrl);
    await page.waitForTimeout(1200);
    await openExerciseSheet(page, 'Band Pull-Apart');
    await expect(page.locator('select[id$="-bandId"]').first()).toHaveValue(/.+/);

    await completeActiveSet(page);

    // Das Sheet liegt als Modal über der Seite und fängt Klicks ab - erst zu,
    // dann abschließen. Genau so läuft es auch am Gerät.
    await closeExerciseSheet(page);

    await page.getByRole('button', { name: 'Session abschließen' }).first().click();
    await page.waitForTimeout(1500);

    await page.goto('./#/history');
    await page.waitForTimeout(1000);
    await page.getByRole('link', { name: /Einheit A/ }).first().click();
    await page.waitForTimeout(1200);

    // In der Historie steht der Bandname, keine erfundene Zahl.
    await expect(page.getByText('grün').first()).toBeVisible();

    expect(errors).toEqual([]);
  });
});
