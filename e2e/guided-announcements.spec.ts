import { expect, test, type Page } from '@playwright/test';
import { resetDatabase } from './helpers';

/*
 * Ansagen erzeugen: Import ohne Schlüssel, Start-Screen mit „Keine Ansagen für
 * diese Vorlage“, Nachholen per „Ansagen erzeugen“. Der Google-Aufruf wird
 * immer abgefangen - es geht nie ein echter Request hinaus. Der Schlüssel ist
 * ein offensichtlicher Platzhalter.
 */
const KEY = 'PLATZHALTER-E2E-0042';
const TEMPLATE_NAME = 'Yoga Abendflow';
const GOOGLE = 'https://texttospeech.googleapis.com/**';

const STEPS = [
  { name: 'Kindhaltung', seconds: 60 },
  { name: 'Taube', seconds: 150, bothSides: true },
];
// Kindhaltung, Taube links, Taube rechts, Geschafft.
const SENTENCES = 4;

async function importTemplate(page: Page) {
  await page.goto('./#/sync');
  await page.waitForTimeout(600);
  await page.getByLabel('Oder JSON einfügen').fill(
    JSON.stringify({
      schemaVersion: 1,
      templates: [{ name: TEMPLATE_NAME, category: 'yoga', steps: STEPS }],
    }),
  );
  await page.getByRole('button', { name: 'Vorschau erzeugen' }).click();
  await page.getByRole('button', { name: 'Import bestätigen' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Eingespielt' })).toBeVisible();
}

async function saveKey(page: Page) {
  await page.goto('./#/settings');
  const section = page.getByTestId('speech-settings');

  await section.getByLabel('Google-Schlüssel').fill(KEY);
  await section.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(section).toContainText('••••0042');
}

async function openStart(page: Page) {
  await page.goto('./');
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Jetzt trainieren' }).click();
  await page
    .locator('[data-sheet]')
    .getByRole('button', { name: new RegExp(TEMPLATE_NAME) })
    .click();
  await expect(page.locator('[data-guided-stage="start"]')).toBeVisible();
}

test.describe('Geführte Vorlage: Ansagen erzeugen', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
  });

  test('ohne Schlüssel klappt der Import, der Start-Screen bietet „Nur Ton“ und das Nachholen', async ({
    page,
  }) => {
    let requests = 0;
    let keyHeader: string | undefined;

    await page.route(GOOGLE, async (route) => {
      requests += 1;
      keyHeader = route.request().headers()['x-goog-api-key'];
      expect(route.request().url()).not.toContain('key=');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ audioContent: 'AAAA' }),
      });
    });

    await importTemplate(page);
    await expect(page.getByRole('status').filter({ hasText: 'Kein Google-Schlüssel' })).toBeVisible();
    expect(requests).toBe(0);

    await openStart(page);

    const voice = page.getByRole('radio', { name: /Stimme \+ Ton/ });

    await expect(page.getByText('Keine Ansagen für diese Vorlage')).toBeVisible();
    await expect(voice).toBeDisabled();
    await expect(page.getByRole('radio', { name: /Nur Ton/ })).toHaveAttribute('aria-checked', 'true');

    // Schlüssel eintragen, zurück auf den Start-Screen, nachholen.
    await saveKey(page);
    await openStart(page);
    await page.getByRole('button', { name: 'Ansagen erzeugen' }).click();

    await expect(voice).toBeEnabled();
    await expect(page.getByText('Keine Ansagen für diese Vorlage')).toHaveCount(0);
    expect(requests).toBe(SENTENCES);
    expect(keyHeader).toBe(KEY);
    await expect(page.locator('body')).not.toContainText(KEY);
  });

  test('ein Google-Fehler beim Nachholen zeigt die Meldung ohne Schlüssel und lässt „Nur Ton“', async ({
    page,
  }) => {
    await page.route(GOOGLE, (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: `API key not valid: ${KEY}` } }),
      }),
    );

    await importTemplate(page);
    await saveKey(page);
    await openStart(page);
    await page.getByRole('button', { name: 'Ansagen erzeugen' }).click();

    const message = page.locator('[data-guided-announcements-message]');

    await expect(message).toContainText('API key not valid');
    await expect(message).not.toContainText(KEY);
    await expect(page.getByRole('radio', { name: /Stimme \+ Ton/ })).toBeDisabled();
    await expect(page.getByText('Keine Ansagen für diese Vorlage')).toBeVisible();
  });

  test('der Import mit Schlüssel erzeugt die Ansagen automatisch', async ({ page }) => {
    let requests = 0;

    await page.route(GOOGLE, async (route) => {
      requests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ audioContent: 'AAAA' }),
      });
    });

    await saveKey(page);
    await importTemplate(page);
    await expect(page.getByRole('status').filter({ hasText: `${SENTENCES} Ansagen erzeugt` })).toBeVisible();
    expect(requests).toBe(SENTENCES);

    await openStart(page);
    await expect(page.getByRole('radio', { name: /Stimme \+ Ton/ })).toBeEnabled();
    await expect(page.getByText('Keine Ansagen für diese Vorlage')).toHaveCount(0);
  });
});
