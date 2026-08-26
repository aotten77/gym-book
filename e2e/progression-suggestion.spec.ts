import { expect, test, type Page } from '@playwright/test';
import {
  closeExerciseSheet,
  collectPageErrors,
  completeActiveSet,
  openExerciseSheet,
  resetDatabase,
  seedSampleData,
  startSampleSession,
} from './helpers';

/*
 * Die Doppelprogression als Vorschlag.
 *
 * Der Aufbau nutzt die Beispieldaten: der Front Squat hat dort eine
 * abgeschlossene Einheit mit dreimal 4 Wdh bei 82,5 kg hinter sich. Wird im
 * Workout die Spanne auf 3-4 gesetzt, ist sie damit oben ausgereizt - genau
 * die Lage, in der der Vorschlag erscheinen soll.
 *
 * Der wichtigste Schritt steht im ersten Test am Ende: ohne Tap auf den Chip
 * wird der *alte* Wert gespeichert. Das ist die Grenze zwischen "Vorschlag"
 * und "stillem Überschreiben", und sie liegt in einer einzigen Zeile
 * (`adoptPlaceholders` sieht den Vorschlag nicht).
 */

/** Setzt die Wiederholungsspanne des Front Squat im Workout auf 3-4. */
async function planRepRange(page: Page) {
  await page.goto('./#/templates');
  await page.waitForTimeout(900);

  await page.getByRole('link', { name: 'Bearbeiten' }).first().click();
  await page.waitForTimeout(900);

  await page.getByRole('button', { name: 'Front Squat bearbeiten' }).click();
  await page.locator('[data-sheet]').waitFor();
  await page.waitForTimeout(400);

  /*
   * Auf das Sheet eingegrenzt: die Seite trägt darunter die
   * Progressions-Tabelle, und die hat je Programmwoche ein weiteres Feld
   * "Ziel-Wdh".
   */
  const sheet = page.locator('[data-sheet]');
  await sheet.getByLabel('Ziel-Wdh', { exact: true }).fill('3');
  await sheet.getByLabel('Ziel-Wdh bis').fill('4');
  await page.getByRole('button', { name: 'Änderung speichern' }).click();
  await page.waitForTimeout(1000);

  // Die Spanne steht danach als Bereich in der Zeile, nicht als eine Zahl.
  await expect(page.getByText('3 x 3–4 Wdh').first()).toBeVisible();
}

/**
 * Bringt den ersten Arbeitssatz auf die Bühne.
 *
 * Über den Aufwärmsatz hinweg, und zwar durch Abhaken statt durch Auswählen:
 * so ist Satz 1 danach die erste *offene* Zeile und liegt auch nach einem
 * Reload von selbst wieder groß da.
 */
async function openFirstWorkSet(page: Page) {
  await openExerciseSheet(page, 'Front Squat');
  await completeActiveSet(page);
  await page.waitForTimeout(400);
}

test.describe('Steigerungsvorschlag', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
    await planRepRange(page);
  });

  test('erscheint am ersten Arbeitssatz, überlebt den Reload und schreibt ohne Tap nichts', async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    const sessionUrl = await startSampleSession(page);

    await openFirstWorkSet(page);

    const suggestion = page.getByRole('button', { name: 'Auf 85 kg übernehmen' });
    await expect(suggestion).toBeVisible();

    /*
     * Reload-fest, weil nichts gespeichert wird: der Vorschlag ist eine reine
     * Funktion der persistierten Zeilen. Das Sheet schließt der Reload
     * vertragsgemäß, es muss also neu geöffnet werden.
     */
    await page.goto(sessionUrl);
    await page.waitForTimeout(1200);
    await openExerciseSheet(page, 'Front Squat');
    await expect(page.getByRole('button', { name: 'Auf 85 kg übernehmen' })).toBeVisible();

    // Der große Knopf verspricht den *alten* Wert - er ist es, der geschrieben
    // wird, solange niemand den Chip antippt.
    const actionButton = page.locator('[data-sheet]').getByRole('button', { name: /abhaken$/ });
    await expect(actionButton).toHaveAccessibleName(/82,5 kg/);

    await completeActiveSet(page);

    await expect(page.locator('[data-sheet]').getByText('82,5 kg × 4').first()).toBeVisible();
    await expect(page.locator('[data-sheet]').getByText('85 kg')).toHaveCount(0);

    // Ab Satz 2 ist die Last des Tages gesetzt - der Chip ist weg.
    await expect(page.getByRole('button', { name: 'Auf 85 kg übernehmen' })).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test('übernimmt den Vorschlag genau dann, wenn er angetippt wird', async ({ page }) => {
    const errors = collectPageErrors(page);
    const sessionUrl = await startSampleSession(page);

    await openFirstWorkSet(page);

    await page.getByRole('button', { name: 'Auf 85 kg übernehmen' }).click();
    await page.waitForTimeout(400);

    const weightField = page
      .locator('[data-sheet]')
      .getByLabel('Gewicht in kg', { exact: true })
      .first();
    await expect(weightField).toHaveValue('85');

    // Nach der Benutzung verschwindet er: das Feld ist nicht mehr leer.
    await expect(page.getByRole('button', { name: 'Auf 85 kg übernehmen' })).toHaveCount(0);

    const actionButton = page.locator('[data-sheet]').getByRole('button', { name: /abhaken$/ });
    await expect(actionButton).toHaveAccessibleName(/85 kg/);

    await completeActiveSet(page);
    await closeExerciseSheet(page);

    // Erst der Reload beweist, dass der Wert wirklich in der Datenbank steht.
    await page.goto(sessionUrl);
    await page.waitForTimeout(1200);
    await openExerciseSheet(page, 'Front Squat');
    await expect(page.locator('[data-sheet]').getByText('85 kg × 4').first()).toBeVisible();

    expect(errors).toEqual([]);
  });
});
