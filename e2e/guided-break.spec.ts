import { expect, test, type Page } from '@playwright/test';
import { collectPageErrors, resetDatabase } from './helpers';

/*
 * Lange Wechsel als Pause: helle Bühne, groß „Pause“, danach die nächste Übung.
 *
 * Die Uhr steuert Playwright (`page.clock`). Ab welcher Länge ein Wechsel eine
 * Pause ist und wann die Countdown-Töne fällig sind, steht in
 * `domain/guided-steps.test.ts` und `domain/guided-run.test.ts`; hier zählt,
 * was der Screen daraus macht. Ton ist nicht prüfbar.
 *
 * Zeitachse: Wechsel 0–5, Beispiel A 5–9, Pause 9–29, Beispiel B 29–33,
 * Wechsel 33–38, Beispiel C 38–42.
 */

const TEMPLATE_NAME = 'Beispiel-Pausen';

const STEPS = [
  { name: 'Beispiel A', seconds: 4 },
  { name: 'Beispiel B', seconds: 4, transitionSeconds: 20, hint: 'Erfundener Beispieltext.' },
  { name: 'Beispiel C', seconds: 4 },
];

const PAPER = 'rgb(242, 242, 239)';
const LIME = 'rgb(220, 242, 90)';

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

/** Vom heutigen Termin im Jetzt-Sheet auf den Start-Screen. */
async function openStart(page: Page) {
  await page.goto('./');
  await page.waitForTimeout(1200);
  await page.locator('[data-now-unit]').click();
  await page.waitForURL(/#\/guided\//);
  await expect(page.locator('[data-guided-stage="start"]')).toBeVisible();
}

/** Vom Start-Screen in den Ablauf, mit Playwrights Uhr. */
async function startRun(page: Page) {
  await openStart(page);

  // Erst nach dem Laden die Uhr übernehmen: Import und Navigation laufen in Echtzeit.
  await page.clock.install();
  await page.getByRole('button', { name: 'Einheit starten' }).click();
  await page.waitForURL(/#\/guided\/run\//);
  await expect(page.locator('[data-guided-stage="run"]')).toBeVisible();
}

const run = (page: Page) => page.locator('[data-guided-run]');
const stage = (page: Page) => page.locator('[data-guided-stage]');
const pauseTitle = (page: Page) => stage(page).getByText(/^pause$/i);

/** Wie viele Elemente der Bühne Limette als Grund oder Schrift tragen. */
function countLime(page: Page) {
  return page.evaluate(
    (lime) =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-guided-stage] *')).filter(
        (element) => {
          const style = getComputedStyle(element);

          return (
            style.backgroundColor === lime || style.color === lime || style.stroke === lime
          );
        },
      ).length,
    LIME,
  );
}

test.describe('Geführte Einheit: lange Wechsel als Pause', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
  });

  test('eine lange Pause steht hell mit PAUSE, ein kurzer Wechsel bleibt dunkel', async ({
    page,
  }) => {
    const errors = collectPageErrors(page);

    await importGuidedTemplate(page);
    await startRun(page);

    // Der erste Wechsel (0–5): dunkel, keine Pause.
    await page.clock.runFor(2000);
    await expect(run(page)).toHaveAttribute('data-guided-section', 'transition');
    await expect(stage(page)).toHaveAttribute('data-guided-tone', 'dark');
    await expect(run(page)).not.toHaveAttribute('data-guided-pause', /.*/);
    await expect(pauseTitle(page)).toHaveCount(0);

    // Die Pause (9–29): hell, groß „Pause“, danach Beispiel B.
    await page.clock.runFor(10_000);
    await expect(run(page)).toHaveAttribute('data-guided-section', 'transition');
    await expect(stage(page)).toHaveAttribute('data-guided-tone', 'light');
    await expect(run(page)).toHaveAttribute('data-guided-pause', 'true');
    await expect(pauseTitle(page)).toBeVisible();
    await expect(stage(page)).toContainText('Danach');
    await expect(page.locator('[data-guided-name]')).toContainText('Beispiel B');
    await expect(page.locator('[data-guided-meta]')).toContainText('Pause · noch');
    expect(await countLime(page)).toBe(0);

    // Der kurze Wechsel vor Beispiel C (33–38): wieder dunkel.
    await page.clock.runFor(23_000);
    await expect(run(page)).toHaveAttribute('data-guided-section', 'transition');
    await expect(stage(page)).toHaveAttribute('data-guided-tone', 'dark');
    await expect(run(page)).not.toHaveAttribute('data-guided-pause', /.*/);
    await expect(pauseTitle(page)).toHaveCount(0);
    await expect(page.locator('[data-guided-meta]')).toContainText('Wechsel · noch');

    expect(errors).toEqual([]);
  });

  test('Pausieren in der Pause friert ein und bleibt hell, die Dialoge bleiben lesbar', async ({
    page,
  }) => {
    const errors = collectPageErrors(page);

    await importGuidedTemplate(page);
    await startRun(page);
    await page.clock.runFor(12_000);
    await expect(run(page)).toHaveAttribute('data-guided-pause', 'true');

    // Der Hinweis zu Beispiel B auf der hellen Bühne: dunkler Dialog, helle Schrift.
    await page.getByRole('button', { name: 'Hinweis: Beispiel B' }).click();
    const hint = page.locator('[data-guided-hint-text]');

    await expect(hint).toHaveText('Erfundener Beispieltext.');
    await expect(hint).toHaveCSS('color', PAPER);
    await page.getByRole('button', { name: 'Hinweis schließen' }).click();

    await page.getByRole('button', { name: 'Pausieren', exact: true }).click();
    await expect(run(page)).toHaveAttribute('data-guided-phase', 'paused');
    await expect(page.locator('[data-guided-stage="pause"]')).toHaveAttribute(
      'data-guided-tone',
      'light',
    );
    await expect(run(page)).toHaveAttribute('data-guided-pause', 'true');
    await expect(stage(page)).toContainText('Pausiert');

    // „Einheit beenden …“ auf der hellen Bühne: der Dialog ist dunkel und lesbar.
    await page.getByRole('button', { name: 'Einheit beenden …' }).click();
    const dialog = page.getByRole('dialog', { name: 'Einheit beenden?' });

    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Einheit beenden?' })).toHaveCSS(
      'color',
      PAPER,
    );
    await dialog.getByRole('button', { name: 'Weiter pausiert' }).click();

    await page.getByRole('button', { name: 'Weiter', exact: true }).click();
    await expect(run(page)).toHaveAttribute('data-guided-phase', 'transition');
    await expect(stage(page)).toHaveAttribute('data-guided-tone', 'light');

    expect(errors).toEqual([]);
  });

  test('Start-Screen zeigt die Pause vor dem Schritt', async ({ page }) => {
    const errors = collectPageErrors(page);

    await importGuidedTemplate(page);
    await openStart(page);

    const pauses = page.locator('[data-guided-step-pause]');

    await expect(pauses).toHaveCount(1);
    await expect(pauses).toHaveText('20 s Pause');
    await expect(page.locator('[data-guided-step="1"] [data-guided-step-pause]')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('der Pausieren-Knopf zeigt nur das Symbol', async ({ page }) => {
    const errors = collectPageErrors(page);

    await importGuidedTemplate(page);
    await startRun(page);

    // In Beispiel A (5–9).
    await page.clock.runFor(6000);
    await expect(run(page)).toHaveAttribute('data-guided-phase', 'exercise');

    const pauseButton = page.getByRole('button', { name: 'Pausieren', exact: true });

    await expect(pauseButton).toBeVisible();
    await expect(pauseButton).toHaveText('');

    const box = await pauseButton.boundingBox();

    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(errors).toEqual([]);
  });
});
