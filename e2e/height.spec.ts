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
 * Die Höhe in Zentimetern - die Stufe eines Step-Downs. Anders als das Band
 * tritt sie *nicht* an die Stelle der Kilos, sondern daneben: die Bühne trägt
 * dann eine Wertebox mehr, und genau das ist auf 320px die Stelle, an der ein
 * Feld sonst aus dem Bild rutscht.
 */
test.describe('Höhe in Zentimetern', () => {
  test('Übung mit Höhe anlegen, Satz loggen, Historie prüfen', async ({ page }) => {
    const errors = collectPageErrors(page);

    await resetDatabase(page);
    // Beispieldaten zuerst: sie sind nur bei leerer Bibliothek möglich.
    await seedSampleData(page);

    await page.goto('./#/exercises');
    await page.waitForTimeout(900);

    await page.getByRole('button', { name: 'Anlegen' }).first().click();
    await page.getByLabel('Name').fill('Step-Down');
    await page.getByRole('button', { name: 'Ohne Höhe' }).click();
    await expect(page.getByRole('button', { name: 'Höhe in cm mitschreiben' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: 'Anlegen' }).last().click();
    await page.waitForTimeout(1000);

    const sessionUrl = await startSampleSession(page);

    await page.getByRole('button', { name: 'Übung hinzufügen' }).first().click();
    await page.waitForTimeout(500);
    await page.getByLabel('Übung', { exact: true }).selectOption({ label: 'Step-Down' });
    await page.waitForTimeout(500);

    // Die Höhe steht neben dem Gewicht, nicht an seiner Stelle - anders als
    // beim Band, das die Kilos verdrängt.
    await expect(page.getByLabel('Ziel-Höhe in cm')).toBeVisible();
    await expect(page.getByLabel('Ziel-Gewicht')).toBeVisible();

    await page.getByLabel('Ziel-Höhe in cm').fill('20');
    await page.getByRole('button', { name: 'Zur Session hinzufügen' }).click();
    await page.waitForTimeout(1200);

    await openExerciseSheet(page, 'Step-Down');

    // `exact`, weil die beiden Schrittknöpfe denselben Namen tragen und ihn
    // nur erweitern ("Höhe in cm um 5 erhöhen").
    const heightField = page
      .locator('[data-sheet]')
      .getByLabel('Höhe in cm', { exact: true })
      .first();
    await expect(heightField).toBeVisible();

    // Die Ziel-Höhe steht auf dem großen Knopf: sie ist die Vorgabe, die das
    // Abhaken übernimmt, solange nichts eingetragen ist.
    const actionButton = page.locator('[data-sheet]').getByRole('button', { name: /abhaken$/ });
    await expect(actionButton).toHaveAccessibleName(/20 cm/);

    // Der Schritt der Knöpfe ist 5 cm - Stufen und Boxen kommen in dieser
    // Teilung, und aus einem leeren Feld startet er bei der Vorgabe.
    await page.locator('[data-sheet]').getByRole('button', { name: 'Höhe in cm um 5 erhöhen' }).click();
    await expect(heightField).toHaveValue('25');
    await expect(actionButton).toHaveAccessibleName(/25 cm/);

    await page.waitForTimeout(900);

    // Der Wert muss einen Reload überstehen: im Training passiert genau das
    // durch ein Service-Worker-Update mitten im Satz.
    await page.goto(sessionUrl);
    await page.waitForTimeout(1200);
    await openExerciseSheet(page, 'Step-Down');
    await expect(
      page.locator('[data-sheet]').getByLabel('Höhe in cm', { exact: true }).first(),
    ).toHaveValue('25');

    await completeActiveSet(page);
    await closeExerciseSheet(page);

    await page.getByRole('button', { name: 'Session abschließen' }).first().click();
    await page.waitForTimeout(1500);

    await page.goto('./#/history');
    await page.waitForTimeout(1000);
    await page.getByRole('link', { name: /Einheit A/ }).first().click();
    await page.waitForTimeout(1200);

    // In der Historie steht die Höhe in Zentimetern, deutsch geschrieben.
    await expect(page.getByText('25 cm').first()).toBeVisible();

    expect(errors).toEqual([]);
  });
});
