import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { resetDatabase, seedSampleData } from './helpers';

/**
 * Der Analyse-Export endet in einer Datei, und der Weg dorthin - Blob, File,
 * Anker-Klick - ist genau der Teil, den jsdom nicht hat. Die Regeln des
 * Inhalts stehen in `analysis-export.test.ts`; hier geht es darum, dass in
 * WebKit tatsächlich ein lesbares ZIP herauskommt.
 */
test.describe('Analyse-Export', () => {
  test('lädt ein ZIP mit den vier Dateien herunter', async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
    await page.goto('./#/settings');

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Analyse-Export/ }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^gym-book-analyse-\d{4}-\d{2}-\d{2}\.zip$/);

    const path = await download.path();
    expect(path).toBeTruthy();

    /*
     * Der Inhalt wird hier nicht entpackt - Playwright bringt keinen
     * ZIP-Leser mit. Die Dateinamen stehen im Archiv aber unkomprimiert
     * neben ihren Headern, und die Kopfsignatur "PK" ist eindeutig genug,
     * um ein kaputtes Archiv von einem gültigen zu unterscheiden.
     */
    const archive = readFileSync(path as string);

    expect(archive.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(archive.toString('latin1')).toContain('sessions.csv');
    expect(archive.toString('latin1')).toContain('progression.csv');
    expect(archive.toString('latin1')).toContain('tests.csv');
    expect(archive.toString('latin1')).toContain('meta.json');
    // Die Kopfzeile der Tabelle liegt unkomprimiert im Archiv.
    expect(archive.toString('utf8')).toContain('datum,wochentag,einheit,pos,uebung,seite');
  });

  test('rührt das Datum der letzten Sicherung nicht an', async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
    await page.goto('./#/settings');

    await expect(page.getByText('Noch nie gesichert')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Analyse-Export/ }).click();
    await downloadPromise;

    await expect(page.getByText(/Analyse-Export erstellt/)).toBeVisible();
    /*
     * Ein Analyse-Export ist keine Sicherung. Zählte er als eine, wäre die
     * Erinnerung auf der Startseite abgeschaltet - ausgerechnet von einer
     * Datei, die einen Datenverlust nicht rückgängig machen könnte.
     */
    await expect(page.getByText('Noch nie gesichert')).toBeVisible();
  });
});
