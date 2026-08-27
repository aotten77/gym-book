import { expect, test, type Page } from '@playwright/test';
import {
  collectPageErrors,
  completeActiveSet,
  minimizeRestMode,
  openExerciseSheet,
  resetDatabase,
  seedSampleData,
  startSampleSession,
} from './helpers';

/*
 * Die Steigerungs-Marke, satzweise.
 *
 * Der Aufbau trainiert erst eine Einheit und sieht dann in der nächsten nach -
 * anders lässt sich diese Regel nicht prüfen, denn sie ist eine Aussage über
 * die *letzte* Ausführung genau dieser Satzzeile.
 *
 * Der Front Squat der Beispieldaten hat drei Arbeitssätze und ein Ziel von
 * 5 Wdh. Die erste Einheit läuft als Rampe: 30 / 35 / 40 kg, jeder Satz mit
 * seinen 5 Wdh. Genau daran scheiterte der Vorgänger dieser Regel - er nahm
 * das Minimum über alle Sätze und bot am ersten Satz 32,5 kg an, unterhalb der
 * tatsächlichen Arbeitslast. Hier bekommt jeder der drei Sätze seine eigene
 * Antwort.
 */

/** Die Rampe eines Arbeitssatzes eintragen und abhaken. */
async function logWorkSet(page: Page, { reps, weight }: { reps: number; weight: number }) {
  const sheet = page.locator('[data-sheet]');

  await minimizeRestMode(page);
  await sheet.getByLabel('Wdh', { exact: true }).first().fill(String(reps));
  await sheet.getByLabel('Gewicht in kg', { exact: true }).first().fill(String(weight));
  // Über dem Autosave-Fenster (600 ms), sonst hakt das Abhaken einen Satz ab,
  // dessen Werte noch im Draft stehen.
  await page.waitForTimeout(800);
  await completeActiveSet(page);
}

/**
 * Trainiert eine vollständige erste Einheit des Front Squat als Rampe.
 *
 * `reps` je Arbeitssatz - so lässt sich ein einzelner Satz unter dem Ziel
 * halten, ohne die anderen anzufassen.
 */
async function trainRamp(page: Page, reps: [number, number, number]) {
  await startSampleSession(page);
  await openExerciseSheet(page, 'Front Squat');

  // Der Aufwärmsatz zuerst - er ist die erste offene Zeile.
  await completeActiveSet(page);

  const weights = [30, 35, 40];

  for (const [index, count] of reps.entries()) {
    await logWorkSet(page, { reps: count, weight: weights[index] });
  }

  /*
   * Zugeklappt hat sich das Sheet mit dem letzten Satz von selbst - das ist
   * sein Vertrag, sobald im Block nichts mehr offen ist. Nur die Pause liegt
   * noch darüber und muss weg, bevor die Liste wieder bedienbar ist.
   */
  await minimizeRestMode(page);
  await expect(page.locator('[data-sheet]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Session abschließen' }).click();
  await page.waitForURL(/#\/$/);
  await page.waitForTimeout(800);
}

/** Die Satzzeilen der Bühne, in der Reihenfolge, in der sie stehen. */
function setRows(page: Page) {
  return page.locator('[data-sheet] [data-set-row]');
}

test.describe('Steigerungs-Marke', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
  });

  test('steht an jedem Arbeitssatz der Rampe, nicht am Warmup, und überlebt den Reload', async ({
    page,
  }) => {
    const errors = collectPageErrors(page);

    await trainRamp(page, [5, 5, 5]);

    const sessionUrl = await startSampleSession(page);
    await openExerciseSheet(page, 'Front Squat');

    /*
     * Vier Zeilen: Aufwärmen, dann drei Arbeitssätze. Die Marke trägt nur, wer
     * beim letzten Mal in *dieser* Zeile das Ziel erreicht hat - der
     * Aufwärmsatz reizt nichts aus.
     */
    await expect(setRows(page)).toHaveCount(4);
    await expect(setRows(page).nth(0)).not.toHaveAttribute('data-progression-hint');
    await expect(setRows(page).nth(1)).toHaveAttribute('data-progression-hint', '');
    await expect(setRows(page).nth(2)).toHaveAttribute('data-progression-hint', '');
    await expect(setRows(page).nth(3)).toHaveAttribute('data-progression-hint', '');

    // Die Auskunft steht im Namen der Zeile, nicht nur als Pfeil im Bild.
    await expect(setRows(page).nth(1)).toHaveAccessibleName(/Steigerung möglich/);

    /*
     * Reload-fest, weil nichts gespeichert wird: die Marke ist eine reine
     * Funktion der persistierten Zeilen. Das Sheet schließt der Reload
     * vertragsgemäß, es muss also neu geöffnet werden.
     */
    await page.goto(sessionUrl);
    await page.waitForTimeout(1200);
    await openExerciseSheet(page, 'Front Squat');
    await expect(setRows(page).nth(1)).toHaveAttribute('data-progression-hint', '');

    expect(errors).toEqual([]);
  });

  test('lässt genau den Satz aus, der unter dem Ziel geblieben ist', async ({ page }) => {
    const errors = collectPageErrors(page);

    // Satz 2 bleibt bei 4 von 5 - das ist der Fall, den eine Regel pro Übung
    // nicht ausdrücken kann: sie schwiege dann zu allen dreien.
    await trainRamp(page, [5, 4, 5]);

    await startSampleSession(page);
    await openExerciseSheet(page, 'Front Squat');

    await expect(setRows(page).nth(1)).toHaveAttribute('data-progression-hint', '');
    await expect(setRows(page).nth(2)).not.toHaveAttribute('data-progression-hint');
    await expect(setRows(page).nth(3)).toHaveAttribute('data-progression-hint', '');

    expect(errors).toEqual([]);
  });

  test('zeigt die Marke im Ruhemodus, ohne dort etwas anzubieten', async ({ page }) => {
    const errors = collectPageErrors(page);

    await trainRamp(page, [5, 5, 5]);

    await startSampleSession(page);
    await openExerciseSheet(page, 'Front Squat');

    // Aufwärmen abhaken, danach den ersten Arbeitssatz - erst dann wartet die
    // Pause auf Satz 2, und der trägt die Marke.
    await completeActiveSet(page);
    await page.locator('[data-sheet]').getByRole('button', { name: /abhaken$/ }).click();
    await page.waitForTimeout(900);

    /*
     * Weggelegt bleibt weggelegt, solange Übung und Seite dieselben sind - und
     * die Pause des Aufwärmsatzes hat `completeActiveSet` gerade minimiert.
     * Also den Reiter wieder aufziehen, wie im Training auch.
     */
    const widget = page.locator('[data-rest-widget]');

    if (await widget.isVisible().catch(() => false)) {
      await widget.click();
      await page.waitForTimeout(400);
    }

    const restMode = page.getByRole('dialog', { name: /^Pause · / });
    await expect(restMode).toBeVisible();
    await expect(restMode.locator('[data-rest-hint]')).toHaveText(/Steigerung möglich/);

    // Nur Anzeige: die drei Handlungen des Ruhemodus sind unverändert, und die
    // Marke ist keine vierte.
    await expect(restMode.getByRole('button', { name: 'Weiter' })).toBeVisible();
    await expect(restMode.getByRole('button')).toHaveCount(4); // minimieren, −15 s, Weiter, +30 s

    expect(errors).toEqual([]);
  });

  test('schweigt, wenn die Übung nicht gesteigert werden soll', async ({ page }) => {
    const errors = collectPageErrors(page);

    await trainRamp(page, [5, 5, 5]);

    // Der Schalter sitzt an der Übung und gilt damit in jedem Workout.
    await page.goto('./#/exercises');
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: 'Front Squat bearbeiten' }).click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Steigerung vorschlagen' }).click();
    await page.getByRole('button', { name: 'Speichern', exact: true }).click();
    await page.waitForTimeout(900);

    await startSampleSession(page);
    await openExerciseSheet(page, 'Front Squat');

    await expect(setRows(page)).toHaveCount(4);
    await expect(page.locator('[data-sheet] [data-progression-hint]')).toHaveCount(0);

    expect(errors).toEqual([]);
  });
});
