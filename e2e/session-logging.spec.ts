import { expect, test } from '@playwright/test';
import { collectPageErrors, resetDatabase, seedSampleData, startSampleSession } from './helpers';

/*
 * Deckt die Befunde ab, an denen zuvor Trainingsdaten verloren gingen.
 * Keiner davon laesst sich im jsdom nachstellen: es braucht echte
 * Eingabefelder, einen echten Reload und einen laufenden Timer.
 */
test.describe('Satz-Protokollierung', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
  });

  test('deutsches Dezimalkomma wird gespeichert und ueberlebt einen Reload', async ({ page }) => {
    await startSampleSession(page);

    // Number("52,5") ergibt NaN. Frueher wurde daraus `undefined`, und Dexies
    // Table.update loescht damit die Property - der Wert war weg.
    await page.locator('input[id$="-weight"]').first().fill('82,5');
    await page.locator('input[id$="-reps"]').first().fill('5');
    await page.waitForTimeout(1200); // Autosave abwarten

    await page.reload();
    await page.waitForTimeout(1200);

    await expect(page.locator('input[id$="-weight"]').first()).toHaveValue('82.5');
    await expect(page.locator('input[id$="-reps"]').first()).toHaveValue('5');
  });

  test('eine ungueltige Eingabe laesst den gespeicherten Wert unangetastet', async ({ page }) => {
    await startSampleSession(page);

    const weight = page.locator('input[id$="-weight"]').first();
    await weight.fill('82,5');
    await page.waitForTimeout(1200);

    await weight.fill('abc');
    await page.waitForTimeout(1000);
    await expect(page.getByRole('alert').first()).toBeVisible();

    await page.reload();
    await page.waitForTimeout(1200);

    await expect(page.locator('input[id$="-weight"]').first()).toHaveValue('82.5');
  });

  test('das Speichern eines Feldes ueberschreibt nicht das Nachbarfeld', async ({ page }) => {
    await startSampleSession(page);

    // Genau hier lag ein Fehler, den alle Unit-Tests passierten: der Sync aus
    // der Live-Query warf den gerade getippten Wert im Nachbarfeld weg.
    await page.locator('input[id$="-weight"]').first().fill('60');
    await page.locator('input[id$="-reps"]').first().fill('8');
    await page.waitForTimeout(1400);
    await page.reload();
    await page.waitForTimeout(1200);

    await expect(page.locator('input[id$="-weight"]').first()).toHaveValue('60');
    await expect(page.locator('input[id$="-reps"]').first()).toHaveValue('8');
  });
});

test.describe('Pausentimer', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
  });

  test('laeuft nach einem Reload weiter', async ({ page }) => {
    await startSampleSession(page);

    await page.getByRole('button', { name: /Pause starten/ }).click();
    await expect(page.getByRole('timer')).toBeVisible();

    // Der Vertrag verlangt "recoverable after backgrounding or reload" -
    // deshalb liegt die Deadline in IndexedDB, nicht im UI-Store.
    await page.reload();
    await page.waitForTimeout(1200);

    await expect(page.getByRole('timer')).toBeVisible();
  });

  test('laesst sich abbrechen', async ({ page }) => {
    await startSampleSession(page);

    await page.getByRole('button', { name: /Pause starten/ }).click();
    await expect(page.getByRole('timer')).toBeVisible();

    await page.getByRole('button', { name: 'Pausentimer abbrechen' }).click();
    await page.waitForTimeout(600);

    await expect(page.getByRole('timer')).toBeHidden();
  });
});

test.describe('Session-Lebenszyklus', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
  });

  test('eine abgebrochene Session gibt den Start wieder frei', async ({ page }) => {
    const errors = collectPageErrors(page);
    await startSampleSession(page);

    // Ohne abortSession blockierte eine versehentlich gestartete Session
    // jeden weiteren Trainingsstart - der Status existierte nur im Modell.
    await page.getByRole('button', { name: 'Session abbrechen' }).click();
    await page.waitForURL(/#\/$/);
    await page.waitForTimeout(800);

    await expect(page.getByText('Ein Training laeuft bereits')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Einheit A' }).first()).toBeEnabled();
    expect(errors).toEqual([]);
  });

  test('bei laufendem Training wird das sichtbar gemacht', async ({ page }) => {
    await startSampleSession(page);
    await page.goto('./');
    await page.waitForTimeout(800);

    // Frueher fuehrte ein Tap auf eine andere Vorlage stillschweigend in die
    // laufende Session - fuer den Nutzer sah das aus wie ein Defekt.
    await expect(page.getByText('Ein Training laeuft bereits')).toBeVisible();
  });
});
