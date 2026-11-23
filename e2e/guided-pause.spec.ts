import { expect, test, type Page } from '@playwright/test';
import { collectPageErrors, resetDatabase } from './helpers';

/*
 * Pause, Beenden und Verkleinern einer geführten Einheit.
 *
 * Die Uhr steuert Playwright (`page.clock`): die Zeit der Pause wird in einem
 * Sprung von einer Minute geprüft, ohne zu warten. Wie sich der Stand aus den
 * Ereignissen ergibt, steht in `domain/guided-run.test.ts`; hier zählt, was
 * der Screen daraus macht. Ton ist nicht prüfbar.
 *
 * Kurze Einheit: Wechsel 5 s, Kindhaltung 4 s, Wechsel 5 s, Taube links 3 s,
 * Seitenwechsel 3 s, Taube rechts 3 s - zusammen 23 s.
 */

const TEMPLATE_NAME = 'Yoga Kurzflow';

const STEPS = [
  { name: 'Kindhaltung', seconds: 4 },
  { name: 'Taube', seconds: 6, bothSides: true },
];

function localDateKey(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${date.getFullYear()}-${month}-${day}`;
}

async function importGuidedTemplate(page: Page) {
  await page.goto('./#/sync');
  await page.waitForTimeout(600);
  await page.getByLabel('Oder JSON einfügen').fill(
    JSON.stringify({
      schemaVersion: 1,
      templates: [{ name: TEMPLATE_NAME, category: 'yoga', steps: STEPS }],
      planEntries: [{ date: localDateKey(), workout: TEMPLATE_NAME }],
    }),
  );
  await page.getByRole('button', { name: 'Vorschau erzeugen' }).click();
  await page.getByRole('button', { name: 'Import bestätigen' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Eingespielt' })).toBeVisible();
}

/** Vom heutigen Termin im Jetzt-Sheet auf den Start-Screen und von dort in den Ablauf. */
async function startRun(page: Page) {
  await page.goto('./');
  await page.waitForTimeout(1200);
  await page.locator('[data-now-unit]').click();
  await page.waitForURL(/#\/guided\//);
  await expect(page.locator('[data-guided-stage="start"]')).toBeVisible();

  // Erst nach dem Laden die Uhr übernehmen: Import und Navigation laufen in Echtzeit.
  await page.clock.install();
  await page.getByRole('button', { name: 'Einheit starten' }).click();
  await page.waitForURL(/#\/guided\/run\//);
  await expect(page.locator('[data-guided-stage="run"]')).toBeVisible();
}

const run = (page: Page) => page.locator('[data-guided-run]');

test.describe('Geführte Einheit: Pause, Beenden, Verkleinern', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
  });

  test('Pause hält die Zeit an, Weiter setzt sie fort, Neustart setzt den Schritt zurück', async ({
    page,
  }) => {
    const errors = collectPageErrors(page);

    await importGuidedTemplate(page);
    await startRun(page);

    // In der Kindhaltung (Sekunde 5 bis 9).
    await page.clock.runFor(6500);
    await expect(run(page)).toHaveAttribute('data-guided-phase', 'exercise');
    await expect(page.locator('[data-guided-name]')).toContainText('Kindhaltung');

    await page.getByRole('button', { name: 'Pause' }).click();

    const stage = page.locator('[data-guided-stage="pause"]');

    await expect(stage).toBeVisible();
    await expect(stage).toHaveAttribute('data-guided-tone', 'dark');
    await expect(stage).toContainText('Pausiert');
    await expect(page.locator('[data-guided-name]')).toContainText('Kindhaltung');

    const frozen = await run(page).getAttribute('data-guided-remaining');

    // Eine Minute vergeht: die Einheit steht, und sie ist nicht zu Ende gelaufen.
    await page.clock.runFor(60_000);
    await expect(run(page)).toHaveAttribute('data-guided-phase', 'paused');
    await expect(run(page)).toHaveAttribute('data-guided-remaining', frozen ?? '');
    await expect(page.locator('[data-guided-stage="finished"]')).toHaveCount(0);

    // Höchstens eine Lime-Fläche: der Pause-Screen hat keine.
    const limeCount = await page.evaluate(() => {
      const lime = 'rgb(220, 242, 90)';

      return Array.from(document.querySelectorAll<HTMLElement>('[data-guided-stage] *')).filter(
        (element) => {
          const style = getComputedStyle(element);

          return style.backgroundColor === lime || style.color === lime;
        },
      ).length;
    });

    expect(limeCount).toBeLessThanOrEqual(1);

    // Schritt neu starten: die Kindhaltung steht wieder bei ihren vollen 4 s, die Pause bleibt.
    await page.getByRole('button', { name: 'Schritt neu starten' }).click();
    await expect(run(page)).toHaveAttribute('data-guided-phase', 'paused');
    await expect(run(page)).toHaveAttribute('data-guided-remaining', '4');

    // Weiter: die Zeit läuft wieder, der Ablauf steht in der Übung, nicht in der Pause.
    await page.getByRole('button', { name: 'Weiter', exact: true }).click();
    await expect(page.locator('[data-guided-stage="run"]')).toBeVisible();
    await expect(run(page)).toHaveAttribute('data-guided-phase', 'exercise');

    // Nach 4,5 s ist die Kindhaltung durch - die Einheit läuft ihren Weg.
    await page.clock.runFor(4500);
    await expect(run(page)).toHaveAttribute('data-guided-section', 'transition');
    await expect(page.locator('[data-guided-name]')).toContainText('Taube');

    expect(errors).toEqual([]);
  });

  test('Einheit beenden fragt nach, bricht ab und lässt den Termin offen', async ({ page }) => {
    const errors = collectPageErrors(page);

    await importGuidedTemplate(page);
    await startRun(page);
    await page.clock.runFor(6500);

    await page.getByRole('button', { name: 'Pause' }).click();
    await page.getByRole('button', { name: 'Einheit beenden …' }).click();

    const dialog = page.getByRole('dialog', { name: 'Einheit beenden?' });

    await expect(dialog).toBeVisible();

    // Zurück aus der Rückfrage: die Einheit steht weiter pausiert.
    await dialog.getByRole('button', { name: 'Weiter pausiert' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(run(page)).toHaveAttribute('data-guided-phase', 'paused');

    // Bestätigen: abgebrochen, zurück in der App, keine laufende Einheit mehr.
    await page.getByRole('button', { name: 'Einheit beenden …' }).click();
    await page
      .getByRole('dialog', { name: 'Einheit beenden?' })
      .getByRole('button', { name: 'Einheit beenden' })
      .click();
    await page.waitForURL(/#\/$/);
    await page.waitForTimeout(800);
    await expect(page.getByText('Training läuft')).toHaveCount(0);

    // Der Termin ist nicht erledigt, sondern offen.
    await expect(
      page
        .locator(`[data-timeline-day="${localDateKey()}"] [data-plan-entry]`)
        .filter({ hasText: TEMPLATE_NAME }),
    ).toHaveAttribute('data-plan-entry-state', 'offen');

    expect(errors).toEqual([]);
  });

  test('das X verkleinert auch aus der Pause, die Leiste führt zurück, die Pause bleibt', async ({
    page,
  }) => {
    await importGuidedTemplate(page);
    await startRun(page);
    await page.clock.runFor(6500);
    await page.getByRole('button', { name: 'Pause' }).click();

    await page.getByRole('button', { name: 'Verkleinern' }).click();
    await page.waitForTimeout(600);

    // Die Leiste zeigt die Einheit, und sie führt auf den geführten Screen - nicht in die Session.
    const bar = page.getByRole('button', { name: /Training läuft/ });

    await expect(bar).toBeVisible();
    await bar.click();
    await page.waitForURL(/#\/guided\/run\//);
    await expect(run(page)).toHaveAttribute('data-guided-phase', 'paused');

    // Und der Weg über das Jetzt-Sheet: zurück verkleinern, dort „Training läuft · zurück“.
    await page.getByRole('button', { name: 'Verkleinern' }).click();
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'Jetzt trainieren' }).click();
    await page.getByRole('link', { name: /Training läuft · zurück/ }).click();
    await page.waitForURL(/#\/guided\/run\//);
    await expect(page.locator('[data-guided-stage="pause"]')).toBeVisible();
  });
});
