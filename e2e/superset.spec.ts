import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  closeExerciseSheet,
  completeActiveSet,
  openExerciseSheet,
  resetDatabase,
  seedSampleData,
  selectSetRow,
  startSampleSession,
} from './helpers';

/**
 * Eine Zeile der Planungsliste.
 *
 * Auf `p` eingegrenzt, weil der Progressions-Block darunter dieselben
 * Beschriftungen als `option` in einem Auswahlfeld führt.
 */
function plannedRow(page: Page, label: string): Locator {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return page.locator('p').filter({ hasText: new RegExp(`^${escaped}$`) });
}

async function linkWithPrevious(page: Page, name: string) {
  await page.getByRole('button', { name: `${name} mit voriger Übung verbinden` }).click();
  await page.waitForTimeout(600);
}

test.describe('Supersatz in der laufenden Einheit', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
  });

  test('verbindet zwei Übungen und führt sie als einen Block', async ({ page }) => {
    await startSampleSession(page);

    // Verbunden wird in der Übung selbst, also im Sheet.
    await openExerciseSheet(page, 'Bulgarian Split Squat');
    await linkWithPrevious(page, 'Bulgarian Split Squat');
    await closeExerciseSheet(page);

    /*
     * Aus zwei Blöcken wird einer: die Liste zeigt den Supersatz als eine
     * Karte mit beiden Mitgliedern, nicht als zwei Karten mit einem Rahmen
     * darum.
     */
    const superset = page.locator('section[data-block-status]', {
      hasText: 'Supersatz',
    });
    await expect(superset).toBeVisible();
    await expect(page.locator('section[data-block-status]')).toHaveCount(2);

    // Die Verbindung liegt in IndexedDB, nicht im UI-Zustand.
    await page.reload();
    await page.waitForTimeout(1200);

    await expect(
      page.locator('section[data-block-status]', { hasText: 'Supersatz' }),
    ).toBeVisible();
  });

  test('wechselt nach einer Runde zur Partnerübung, ohne das Sheet zu schließen', async ({
    page,
  }) => {
    await startSampleSession(page);
    await openExerciseSheet(page, 'Bulgarian Split Squat');
    await linkWithPrevious(page, 'Bulgarian Split Squat');
    await closeExerciseSheet(page);

    // Beide Mitglieder stehen im selben Sheet - dafür ist die Gruppe da.
    await openExerciseSheet(page, 'Front Squat');
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: /Front Squat/ })).toBeVisible();
    await expect(sheet.getByRole('heading', { name: /Bulgarian Split Squat/ })).toBeVisible();

    // Warmup des Front Squat abhaken - damit ist dessen Runde vollständig.
    await completeActiveSet(page);

    /*
     * Der Wechsel innerhalb der Gruppe bleibt im Sheet: dort geht es ohne
     * Umbau weiter. Die Pause des Front Squat läuft dabei weiter.
     */
    await expect(sheet).toBeVisible();
    await expect(page.getByRole('timer')).toBeVisible();

    await closeExerciseSheet(page);

    // In der Liste hängt die laufende Pause an der Übung, zu der sie gehört.
    const superset = page.locator('section[data-block-status]', {
      hasText: 'Supersatz',
    });
    await expect(superset.getByText(/^\d{2}:\d{2}$/).first()).toBeVisible();
  });

  test('führt bei einer einseitigen Übung getrennte Pausen für links und rechts', async ({
    page,
  }) => {
    await startSampleSession(page);
    await openExerciseSheet(page, 'Bulgarian Split Squat');

    /*
     * Beide Seiten werden gezielt ausgewählt. Die Aufwärmzeilen bleiben bewusst
     * offen - sie sind bei einer einseitigen Übung selbst nach Seiten geteilt
     * und würden dieselben zwei Spuren belegen, um die es hier geht. Nachrücken
     * würden sie trotzdem: die nächste offene Zeile ist die *erste* offene, und
     * das ist das Aufwärmen.
     */
    await selectSetRow(page, 'Satz 1 · links');
    await completeActiveSet(page);
    await selectSetRow(page, 'Satz 1 · rechts');
    await completeActiveSet(page);

    // Eine Seite trägt die große Zahl, die andere steht als Chip daneben.
    await expect(page.getByRole('timer')).toBeVisible();
    await closeExerciseSheet(page);

    const block = page.locator('section[data-block-status]', {
      hasText: 'Bulgarian Split Squat',
    });
    await expect(block.getByText(/^(Links|Rechts) /).first()).toBeVisible();
    await expect(block.getByText(/^(Links|Rechts) /)).toHaveCount(2);

    // Beide Spuren liegen in IndexedDB und überstehen einen Reload.
    await page.reload();
    await page.waitForTimeout(1400);

    await expect(page.getByRole('timer')).toBeVisible();
    await expect(
      page
        .locator('section[data-block-status]', {
          hasText: 'Bulgarian Split Squat',
        })
        .getByText(/^(Links|Rechts) /),
    ).toHaveCount(2);
  });

  test('löst eine Verbindung wieder', async ({ page }) => {
    await startSampleSession(page);
    await openExerciseSheet(page, 'Bulgarian Split Squat');
    await linkWithPrevious(page, 'Bulgarian Split Squat');

    await page
      .getByRole('button', {
        name: 'Bulgarian Split Squat aus dem Supersatz lösen',
      })
      .click();
    await page.waitForTimeout(900);
    await closeExerciseSheet(page);

    await expect(page.locator('section[data-block-status]')).toHaveCount(3);
    await expect(page.locator('section[data-block-status]', { hasText: 'Supersatz' })).toHaveCount(
      0,
    );
  });
});

test.describe('Supersatz im Template', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
  });

  test('verbindet zwei geplante Übungen und verschiebt den Block am Stück', async ({ page }) => {
    await page.goto('./#/templates');
    await page.waitForTimeout(800);
    await page.getByRole('link', { name: 'Bearbeiten' }).first().click();
    await page.waitForTimeout(800);

    await linkWithPrevious(page, 'Bulgarian Split Squat');
    await page.waitForTimeout(600);

    await expect(page.getByRole('group', { name: /Supersatz/ })).toBeVisible();
    await expect(plannedRow(page, '1. Front Squat')).toBeVisible();
    await expect(plannedRow(page, '2. Bulgarian Split Squat')).toBeVisible();

    // Der Block wandert als Ganzes an das Ende - die Gruppe bleibt zusammen.
    await page.getByRole('button', { name: 'Supersatz nach unten', exact: true }).click();
    await page.waitForTimeout(900);

    await expect(plannedRow(page, '1. Nordic Curl Iso')).toBeVisible();
    await expect(plannedRow(page, '2. Front Squat')).toBeVisible();
    await expect(plannedRow(page, '3. Bulgarian Split Squat')).toBeVisible();
  });

  /*
   * Die Übersicht schrieb den Zusammenhang früher als "· Supersatz" ans Ende
   * der Zieldaten - ein Wort in der einen Zeile sagt aber nicht, mit welcher
   * anderen sie zusammengehört. Sie trägt jetzt dieselbe Klammer wie die
   * Bearbeiten-Ansicht.
   */
  test('zeigt den Supersatz in der Workout-Übersicht als Block', async ({ page }) => {
    await page.goto('./#/templates');
    await page.waitForTimeout(800);
    await page.getByRole('link', { name: 'Bearbeiten' }).first().click();
    await page.waitForTimeout(800);

    await linkWithPrevious(page, 'Bulgarian Split Squat');
    await page.waitForTimeout(600);

    await page.goto('./#/templates');
    await page.waitForTimeout(900);

    const block = page.getByRole('group', {
      name: 'Supersatz: Front Squat und Bulgarian Split Squat',
    });

    await expect(block).toBeVisible();
    await expect(block.locator('p').filter({ hasText: /^1\. Front Squat$/ })).toBeVisible();
    await expect(
      block.locator('p').filter({ hasText: /^2\. Bulgarian Split Squat$/ }),
    ).toBeVisible();
    // Die dritte Übung steht daneben, nicht darin.
    await expect(block.locator('p').filter({ hasText: /^3\. Nordic Curl Iso$/ })).toHaveCount(0);
  });
});
