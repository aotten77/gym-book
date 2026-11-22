import { expect, test } from '@playwright/test';
import { resetDatabase } from './helpers';

/*
 * Einstellungen → Sprachausgabe. Echte Google-Aufrufe gibt es hier nie: der
 * Request wird abgefangen. Der Schlüssel ist ein offensichtlicher Platzhalter.
 */
const KEY = 'PLATZHALTER-E2E-0042';

test('Schlüssel eintragen, maskiert sehen, prüfen und löschen', async ({ page }) => {
  let sentKeyHeader: string | undefined;

  await page.route('https://texttospeech.googleapis.com/**', async (route) => {
    sentKeyHeader = route.request().headers()['x-goog-api-key'];
    expect(route.request().url()).not.toContain('key=');
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: { message: `API key not valid: ${KEY}` } }),
    });
  });

  await resetDatabase(page);
  await page.goto('./#/settings');

  const section = page.getByTestId('speech-settings');
  await expect(section).toContainText('Noch kein Schlüssel gespeichert.');
  await expect(page.getByTestId('speech-month-chars')).toContainText('diesen Monat: 0 Zeichen');

  await section.getByLabel('Google-Schlüssel').fill(KEY);
  await section.getByRole('button', { name: 'Speichern', exact: true }).click();

  await expect(section).toContainText('••••0042');
  await expect(page.locator('body')).not.toContainText(KEY);

  await section.getByRole('button', { name: 'Schlüssel prüfen' }).click();
  await expect(section.getByRole('alert')).toContainText('API key not valid');
  await expect(section.getByRole('alert')).not.toContainText(KEY);
  expect(sentKeyHeader).toBe(KEY);

  await section.getByRole('button', { name: 'Löschen', exact: true }).click();
  await expect(section).toContainText('Noch kein Schlüssel gespeichert.');
});
