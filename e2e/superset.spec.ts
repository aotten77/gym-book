import { expect, test, type Locator, type Page } from '@playwright/test';
import { resetDatabase, seedSampleData, startSampleSession } from './helpers';

/** Die Karte einer Übung, unabhängig von einer Supersatz-Kennzeichnung davor. */
function exerciseCard(page: Page, name: string): Locator {
  return page
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 2, name: new RegExp(name) }) });
}

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

test.describe('Supersatz', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
  });

  test('verbindet zwei Übungen und kennzeichnet sie als Block', async ({ page }) => {
    await startSampleSession(page);

    await linkWithPrevious(page, 'Bulgarian Split Squat');

    await expect(page.getByRole('group', { name: /Supersatz/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'A · Front Squat' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'B · Bulgarian Split Squat' })).toBeVisible();

    // Die Verbindung liegt in IndexedDB, nicht im UI-Zustand.
    await page.reload();
    await page.waitForTimeout(1200);

    await expect(page.getByRole('group', { name: /Supersatz/ })).toBeVisible();
  });

  test('wechselt nach einem Satz zur Partnerübung und lässt deren Pause weiterlaufen', async ({
    page,
  }) => {
    await startSampleSession(page);
    await linkWithPrevious(page, 'Bulgarian Split Squat');

    // Warmup des Front Squat abhaken - damit ist dessen Runde vollständig.
    await exerciseCard(page, 'Front Squat')
      .getByRole('button', { name: 'Satz als erledigt markieren' })
      .first()
      .click();
    await page.waitForTimeout(900);

    // Der Fokus steht jetzt beim Partner, die Pause läuft für den Front Squat.
    await expect(
      exerciseCard(page, 'Bulgarian Split Squat').getByText('Aktiv', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Pause · Front Squat')).toBeVisible();
    await expect(page.getByRole('timer')).toBeVisible();

    // Satz beim Partner abhaken: der Fokus geht zurück, jetzt laufen zwei Pausen.
    await exerciseCard(page, 'Bulgarian Split Squat')
      .getByRole('button', { name: 'Satz als erledigt markieren' })
      .first()
      .click();
    await page.waitForTimeout(900);

    await expect(exerciseCard(page, 'Front Squat').getByText('Aktiv', { exact: true })).toBeVisible();
    await expect(page.getByText('Pause · Front Squat')).toBeVisible();

    // Die Pause des Partners läuft als Chip weiter und holt den Fokus zurück.
    const partnerChip = page.getByRole('button', { name: /Zu Bulgarian Split Squat wechseln/ });
    await expect(partnerChip).toBeVisible();

    await partnerChip.click();
    await page.waitForTimeout(600);

    await expect(page.getByText('Pause · Bulgarian Split Squat')).toBeVisible();
  });

  test('führt bei einer einseitigen Übung getrennte Pausen für links und rechts', async ({
    page,
  }) => {
    await startSampleSession(page);

    const card = exerciseCard(page, 'Bulgarian Split Squat');
    const completeButtons = card.getByRole('button', { name: 'Satz als erledigt markieren' });

    // Reihenfolge in der Karte: Warmup, Satz 1 links, Satz 1 rechts, ...
    await completeButtons.nth(1).click();
    await page.waitForTimeout(900);
    await completeButtons.nth(1).click();
    await page.waitForTimeout(900);

    // Eine Seite trägt die große Zahl, die andere steht als Chip daneben.
    await expect(page.getByRole('timer')).toBeVisible();
    const otherSideChip = page.getByRole('button', {
      name: /Zu Bulgarian Split Squat · (links|rechts) wechseln/,
    });
    await expect(otherSideChip).toBeVisible();

    // Beide Spuren liegen in IndexedDB und überstehen einen Reload.
    await page.reload();
    await page.waitForTimeout(1400);

    await expect(page.getByRole('timer')).toBeVisible();
    await expect(otherSideChip).toBeVisible();
  });

  test('löst eine Verbindung wieder', async ({ page }) => {
    await startSampleSession(page);
    await linkWithPrevious(page, 'Bulgarian Split Squat');

    await page
      .getByRole('button', { name: 'Bulgarian Split Squat aus dem Supersatz lösen' })
      .click();
    await page.waitForTimeout(900);

    await expect(page.getByRole('group', { name: /Supersatz/ })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Front Squat', exact: true })).toBeVisible();
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
    await expect(plannedRow(page, '1. A · Front Squat')).toBeVisible();
    await expect(plannedRow(page, '2. B · Bulgarian Split Squat')).toBeVisible();

    // Der Block wandert als Ganzes an das Ende - die Gruppe bleibt zusammen.
    await page.getByRole('button', { name: 'Supersatz nach unten', exact: true }).click();
    await page.waitForTimeout(900);

    await expect(plannedRow(page, '1. Nordic Curl Iso')).toBeVisible();
    await expect(plannedRow(page, '2. A · Front Squat')).toBeVisible();
    await expect(plannedRow(page, '3. B · Bulgarian Split Squat')).toBeVisible();
  });
});
