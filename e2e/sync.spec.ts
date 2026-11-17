import { expect, test } from '@playwright/test';
import { resetDatabase, seedSampleData } from './helpers';

/**
 * Der Abgleich ist der Ort, an dem der Stand an das claude.ai-Projekt geht
 * (Analyse kopieren) und der Plan von dort zurückkommt (Import). Die Zählung
 * "Seitdem: …" deckt `sync-status.test.ts` ab; hier geht es darum, dass die
 * Seite unter `/sync` steht und den Status aus echten Daten liest.
 */
test.describe('Abgleich', () => {
  test('zeigt Senden, Import und den Status auf frischen Beispieldaten', async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
    await page.goto('./#/sync');

    await expect(page.getByRole('heading', { name: 'Abgleich' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Stand an Claude senden' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Bibliothek importieren' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Analyse kopieren' })).toBeVisible();
    await expect(page.getByText('Noch nie gesendet.')).toBeVisible();
    await expect(page.getByText(/Zuletzt kopiert am/)).toHaveCount(0);
  });

  test('zeigt nach dem Kopieren "Seitdem nichts Neues."', async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
    await page.goto('./#/sync');

    await page.getByRole('button', { name: 'Analyse kopieren' }).click();

    await expect(page.getByText(/Analyse kopiert/)).toBeVisible();
    await expect(page.getByText(/Zuletzt kopiert am/)).toBeVisible();
    await expect(page.getByText(/Seitdem nichts Neues\./)).toBeVisible();
  });
});
