import { expect, test, type Page } from '@playwright/test';
import { collectPageErrors, resetDatabase, silentWavBase64 } from './helpers';

/*
 * Gesprochene Anleitung: der Schalter „Mit Anleitung“ auf dem Start-Screen,
 * der lange erste Wechsel im Ablauf und die Anleitung hinter dem „i“.
 *
 * Google wird abgefangen und antwortet mit einer stillen WAV von 10 s: die
 * lässt sich in WebKit dekodieren und messen. Der Wechsel vor Beispiel A ist
 * mit Anleitung also ⌈0,7 + 10 + 2⌉ = 13 s statt 5 s.
 */
const KEY = 'PLATZHALTER-E2E-0042';
const TEMPLATE_NAME = 'Beispiel-Mobility';
const GOOGLE = 'https://texttospeech.googleapis.com/**';
const GUIDANCE = 'Erfundener Beispieltext.';
const STEPS = [
  { name: 'Beispiel A', seconds: 4, guidance: GUIDANCE },
  { name: 'Beispiel B', seconds: 4 },
];

/** `measurable: false` antwortet mit Bytes, die sich nicht dekodieren und messen lassen. */
async function interceptGoogle(page: Page, { measurable = true } = {}) {
  const audioContent = measurable ? silentWavBase64(10) : 'AAAA';

  await page.unroute(GOOGLE);
  await page.route(GOOGLE, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ audioContent }),
    }),
  );
}

async function saveKey(page: Page) {
  await page.goto('./#/settings');

  const section = page.getByTestId('speech-settings');

  await section.getByLabel('Google-Schlüssel').fill(KEY);
  await section.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(section).toContainText('••••0042');
}

async function importTemplate(page: Page, { withKey = false, measurable = true } = {}) {
  await page.goto('./#/sync');
  await page.waitForTimeout(600);
  await page.getByLabel('Oder JSON einfügen').fill(
    JSON.stringify({
      schemaVersion: 1,
      templates: [{ name: TEMPLATE_NAME, category: 'mobility', steps: STEPS }],
    }),
  );
  await page.getByRole('button', { name: 'Vorschau erzeugen' }).click();
  await page.getByRole('button', { name: 'Import bestätigen' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Eingespielt' })).toBeVisible();

  if (withKey) {
    // Beispiel A, Beispiel B, Geschafft. und Beispiel A mit Anleitung.
    await expect(page.getByText('4 Ansagen erzeugt', { exact: false })).toBeVisible();
  }

  if (withKey && !measurable) {
    await expect(page.getByText('Die Länge der Anleitung ließ sich', { exact: false })).toBeVisible();
  }
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

const toggle = (page: Page) => page.locator('[data-guided-guidance]');
const run = (page: Page) => page.locator('[data-guided-run]');

test.describe('Geführte Einheit: gesprochene Anleitung', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
  });

  test('der Schalter steht nur bei „Stimme + Ton“ und nennt die Dauer mit Anleitung', async ({
    page,
  }) => {
    const errors = collectPageErrors(page);

    await interceptGoogle(page);
    await saveKey(page);
    await importTemplate(page, { withKey: true });
    await openStart(page);

    await expect(toggle(page)).toBeVisible();
    await expect(toggle(page)).toBeEnabled();
    await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');

    const box = await toggle(page).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('[data-guided-facts]')).toContainText('mit Anleitung');
    // Der Schalter kostet eine Zeile: der Start bleibt im Querformat sichtbar.
    await expect(page.getByRole('button', { name: 'Einheit starten' })).toBeInViewport({
      ratio: 1,
    });

    await page.getByRole('radio', { name: /Nur Ton/ }).click();
    await expect(toggle(page)).toHaveCount(0);
    await expect(page.locator('[data-guided-facts]')).not.toContainText('mit Anleitung');
    expect(errors).toEqual([]);
  });

  test('ohne Ansagen ist „Stimme + Ton“ gesperrt und der Schalter fehlt', async ({ page }) => {
    const errors = collectPageErrors(page);

    await interceptGoogle(page);
    await importTemplate(page);
    await openStart(page);

    await expect(page.getByRole('radio', { name: /Stimme \+ Ton/ })).toBeDisabled();
    await expect(toggle(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('ohne gemessene Anleitung ist der Schalter gesperrt, bis ein neuer Lauf sie misst', async ({
    page,
  }) => {
    const errors = collectPageErrors(page);

    await interceptGoogle(page, { measurable: false });
    await saveKey(page);
    await importTemplate(page, { withKey: true, measurable: false });
    await openStart(page);
    await page.getByRole('radio', { name: /Stimme \+ Ton/ }).click();

    await expect(toggle(page)).toBeVisible();
    await expect(toggle(page)).toBeDisabled();
    await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('[data-guided-no-announcements]')).toHaveText(
      'Anleitung noch nicht erzeugt',
    );

    await interceptGoogle(page);
    await page.getByRole('button', { name: 'Ansagen erzeugen' }).click();
    await expect(toggle(page)).toBeEnabled();
    await expect(page.locator('[data-guided-no-announcements]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('mit Anleitung ist der erste Wechsel lang, und „Sofort starten“ beendet ihn', async ({
    page,
  }) => {
    const errors = collectPageErrors(page);

    await interceptGoogle(page);
    await saveKey(page);
    await importTemplate(page, { withKey: true });
    await openStart(page);
    await toggle(page).click();

    // Erst nach dem Laden die Uhr übernehmen: Import und Navigation laufen in Echtzeit.
    await page.clock.install();
    await page.getByRole('button', { name: 'Einheit starten' }).click();
    await page.waitForURL(/#\/guided\/run\//);

    await expect(run(page)).toHaveAttribute('data-guided-section', 'transition');
    await expect(run(page)).toHaveAttribute('data-guided-remaining', /^1[23]$/);

    await page.getByRole('button', { name: 'Sofort starten' }).click();
    await expect(run(page)).toHaveAttribute('data-guided-section', 'exercise');
    await expect(page.locator('[data-guided-name]')).toContainText('Beispiel A');
    expect(errors).toEqual([]);
  });

  test('das „i“ zeigt die Anleitung, auch ohne Hinweis', async ({ page }) => {
    const errors = collectPageErrors(page);

    await interceptGoogle(page);
    await importTemplate(page);
    await openStart(page);

    await page.getByRole('button', { name: 'Hinweis: Beispiel A' }).click();
    await expect(page.locator('[data-guided-guidance-text]')).toHaveText(GUIDANCE);
    await page.getByRole('button', { name: 'Hinweis schließen' }).click();
    await expect(page.locator('[data-guided-guidance-text]')).toHaveCount(0);

    // Beispiel B hat weder Hinweis noch Anleitung: kein „i“.
    await expect(page.getByRole('button', { name: 'Hinweis: Beispiel B' })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
