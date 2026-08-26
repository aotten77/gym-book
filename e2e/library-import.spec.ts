import { expect, test } from '@playwright/test';
import { resetDatabase, seedSampleData } from './helpers';

/*
 * Der Import wird ausschließlich über die Oberfläche ausgelöst: Text einfügen,
 * Vorschau lesen, bestätigen. Die Regeln selbst sind in
 * `domain/library-import.test.ts` geprüft - hier geht es um den Weg dorthin,
 * inklusive der Frage, ob der zweite Lauf sichtbar nichts mehr tut.
 */

const PAYLOAD = JSON.stringify({
  schemaVersion: 1,
  exercises: [
    {
      name: 'Einbeiniges RDL',
      instructions: '4 s absenken, Bewegung aus der Hüfte.',
      trackingMode: 'reps_weight',
      unilateral: true,
    },
  ],
  templates: [{ name: 'Mobility (Mi, 25 min)' }],
  templateAssignments: [
    {
      template: 'Einheit A',
      exercise: 'Einbeiniges RDL',
      orderIndex: 2,
      workSetCount: 3,
      includeWarmup: false,
    },
  ],
  bandLevels: [{ name: 'Schwarz', orderIndex: 1 }],
});

async function pasteAndPreview(page: import('@playwright/test').Page, payload: string) {
  await page.getByLabel('Oder JSON einfügen').fill(payload);
  await page.getByRole('button', { name: 'Vorschau erzeugen' }).click();
  await page.waitForTimeout(600);
}

test.describe('Bibliotheks-Import', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
    await page.goto('./#/settings');
    await page.waitForTimeout(900);
  });

  test('zeigt eine Vorschau, schreibt erst nach Bestätigung und wiederholt sich nicht', async ({
    page,
  }) => {
    await pasteAndPreview(page, PAYLOAD);

    // Vorschau steht, geschrieben ist noch nichts.
    await expect(page.getByText('Vorschau: Eingefügter Text')).toBeVisible();
    await expect(page.getByText('Einbeiniges RDL').first()).toBeVisible();
    await expect(page.getByText('NEU').first()).toBeVisible();

    await page.goto('./#/exercises');
    await page.waitForTimeout(700);
    await expect(page.getByText('Einbeiniges RDL')).toHaveCount(0);

    await page.goto('./#/settings');
    await page.waitForTimeout(900);
    await pasteAndPreview(page, PAYLOAD);
    await page.getByRole('button', { name: 'Import bestätigen' }).click();
    await page.waitForTimeout(900);

    await expect(page.getByRole('status').filter({ hasText: 'Eingespielt' })).toBeVisible();

    await page.goto('./#/exercises');
    await page.waitForTimeout(700);
    await expect(page.getByText('Einbeiniges RDL').first()).toBeVisible();

    // Zweiter Lauf derselben Nutzlast: nichts mehr zu tun, und der Knopf ist
    // gar nicht erst bedienbar.
    await page.goto('./#/settings');
    await page.waitForTimeout(900);
    await pasteAndPreview(page, PAYLOAD);

    await expect(page.getByText('Alles steht schon so in der Datenbank')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import bestätigen' })).toBeDisabled();
  });

  test('bricht mit der beanstandeten Zeile ab, statt halb zu schreiben', async ({ page }) => {
    await pasteAndPreview(
      page,
      JSON.stringify({
        schemaVersion: 1,
        exercises: [{ name: 'Pallof Press', trackingMode: 'reps_weight', unilateral: true }],
        templateAssignments: [
          { template: 'Einheit Z', exercise: 'Pallof Press', orderIndex: 1, workSetCount: 3 },
        ],
      }),
    );

    await expect(page.getByRole('alert')).toContainText('Zuordnung 1');
    await expect(page.getByRole('alert')).toContainText('Einheit Z');
    await expect(page.getByRole('button', { name: 'Import bestätigen' })).toHaveCount(0);

    await page.goto('./#/exercises');
    await page.waitForTimeout(700);
    await expect(page.getByText('Pallof Press')).toHaveCount(0);
  });
});
