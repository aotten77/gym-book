import { expect, test, type Page } from '@playwright/test';
import { collectPageErrors, resetDatabase } from './helpers';

/*
 * Der Start-Screen einer geführten Vorlage.
 *
 * Die Vorlage kommt wie in der Praxis über den Bibliotheks-Import, und der
 * Screen wird dort geöffnet, wo ihn ein Mensch öffnet: im Jetzt-Sheet und im
 * Plan. Geprüft wird, was nur ein echter WebKit-Viewport zeigt - die Lage im
 * Querformat, egal wie das Handy liegt, der helle Grund und die unveränderte
 * Leistenfarbe (dunkel werden erst die Screens des laufenden Ablaufs).
 * Was die Schritte sind und wie sie sich auflösen, steht in
 * `domain/guided-steps.test.ts`.
 */

const TEMPLATE_NAME = 'Yoga Abendflow';

const STEPS = [
  { name: 'Kindhaltung', seconds: 60 },
  {
    name: 'Herabschauender Hund',
    seconds: 60,
    hint: 'Hüfte nach hinten oben schieben, Fersen Richtung Boden.',
  },
  { name: 'Taube', seconds: 150, bothSides: true, hint: 'Das vordere Schienbein liegt quer.' },
];

/** Das Papier der App, wie `app` in tailwind.config.js und `theme-color` in index.html. */
const PAPER = 'rgb(242, 242, 239)';
const INK = 'rgb(12, 18, 16)';
const LIME = 'rgb(220, 242, 90)';

function localDateKey(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${date.getFullYear()}-${month}-${day}`;
}

async function pastePayload(page: Page, extra: Record<string, unknown> = {}) {
  await page.goto('./#/sync');
  await page.waitForTimeout(600);
  await page.getByLabel('Oder JSON einfügen').fill(
    JSON.stringify({
      schemaVersion: 1,
      templates: [{ name: TEMPLATE_NAME, category: 'yoga', steps: STEPS }],
      ...extra,
    }),
  );
  await page.getByRole('button', { name: 'Vorschau erzeugen' }).click();
}

async function importGuidedTemplate(page: Page, extra: Record<string, unknown> = {}) {
  await pastePayload(page, extra);
  await page.getByRole('button', { name: 'Import bestätigen' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Eingespielt' })).toBeVisible();
}

async function openStartFromNowSheet(page: Page) {
  await page.goto('./');
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Jetzt trainieren' }).click();
  await page
    .locator('[data-sheet]')
    .getByRole('button', { name: new RegExp(TEMPLATE_NAME) })
    .click();
  await page.waitForURL(/#\/guided\//);
  await expect(page.locator('[data-guided-stage="start"]')).toBeVisible();
}

/** Lage und Farbe der Bühne, an den gerenderten Maßen statt am Klassennamen. */
async function readStage(page: Page) {
  return page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>('[data-guided-stage]')!;
    const styles = getComputedStyle(stage);

    return {
      transform: styles.transform,
      background: styles.backgroundColor,
      // Layout-Box: bei einer Drehung ist `getBoundingClientRect` wieder die Hülle.
      boxWidth: stage.offsetWidth,
      boxHeight: stage.offsetHeight,
      inBody: stage.parentElement === document.body,
      themeColor: document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content,
    };
  });
}

test.describe('Geführte Vorlage: Start-Screen', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
  });

  test('die Import-Vorschau nennt die geführte Vorlage mit ihren Schritten', async ({ page }) => {
    await pastePayload(page);

    await expect(page.getByText('Vorschau: Eingefügter Text')).toBeVisible();
    await expect(page.getByText('Schritte: — → geführt, 3 Schritte')).toBeVisible();

    // Dieselbe Datei noch einmal: nichts mehr zu tun.
    await page.getByRole('button', { name: 'Import bestätigen' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Eingespielt' })).toBeVisible();
    await pastePayload(page);
    await expect(page.getByText('Alles steht schon so in der Datenbank')).toBeVisible();
  });

  test('das Jetzt-Sheet führt auf den Start-Screen: hell, mit Schritten und Kennzahlen', async ({
    page,
  }) => {
    const errors = collectPageErrors(page);

    await importGuidedTemplate(page);
    await openStartFromNowSheet(page);

    // Hell auf Papier, die Leistenfarbe bleibt.
    const stage = await readStage(page);

    expect(stage.background).toBe(PAPER);
    expect(stage.themeColor).toBe('#f2f2ef');
    expect(stage.inBody).toBe(true);

    await expect(page.getByRole('heading', { name: TEMPLATE_NAME })).toBeVisible();
    await expect(page.getByText('Geführt · Yoga')).toBeVisible();

    // Links die Schritte, bei einem beidseitigen die Seiten und „je Seite“-Dauer.
    const rows = page.locator('[data-guided-step]');

    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Kindhaltung');
    await expect(rows.nth(0)).toContainText('1:00');
    await expect(rows.nth(2)).toContainText('Taube');
    await expect(rows.nth(2)).toContainText('L · R');
    await expect(rows.nth(2)).toContainText('2 × 1:15');

    // Rechts die Kennzahlen als eine Zeile, die sich seitlich scrollen lässt.
    const facts = page.locator('[data-guided-facts]');

    await expect(facts.getByRole('listitem')).toHaveText(['3 Schritte', '≈ 5 min', '1 beidseitig']);
    expect(
      await facts.evaluate((element) => {
        const styles = getComputedStyle(element);

        return { wrap: styles.flexWrap, overflowX: styles.overflowX };
      }),
    ).toEqual({ wrap: 'nowrap', overflowX: 'auto' });

    // Der Startknopf steht in Tinte und ist bedienbar.
    const start = page.getByRole('button', { name: 'Einheit starten' });

    await expect(start).toBeEnabled();
    expect(await start.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(INK);

    // Höchstens eine Lime-Fläche; auf dem Start-Screen ist nichts „jetzt dran“.
    const limeCount = await page.evaluate((lime) => {
      const stageElement = document.querySelector('[data-guided-stage]')!;

      return [stageElement, ...stageElement.querySelectorAll('*')].filter(
        (element) => getComputedStyle(element).backgroundColor === lime,
      ).length;
    }, LIME);

    expect(limeCount).toBeLessThanOrEqual(1);

    // Das X führt dorthin zurück, wo man herkam.
    await page.getByRole('button', { name: 'Start-Screen schließen' }).click();
    await expect(page.locator('[data-guided-stage]')).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content,
      ),
    ).toBe('#f2f2ef');

    expect(errors).toEqual([]);
  });

  test('steht im Querformat, egal wie das Handy liegt', async ({ page }) => {
    await importGuidedTemplate(page);
    await openStartFromNowSheet(page);

    const portrait = page.viewportSize()!;

    // Hochkant: der Screen ist um 90 Grad gedreht und mit vertauschten Maßen
    // aufgespannt, so breit wie das Handy hoch ist.
    const standing = await readStage(page);

    // matrix(0, 1, -1, 0) ist die Drehung im Uhrzeigersinn.
    expect(standing.transform.startsWith('matrix(0, 1, -1, 0')).toBe(true);
    expect(standing.boxWidth).toBe(portrait.height);
    expect(standing.boxHeight).toBe(portrait.width);
    expect(standing.boxWidth).toBeGreaterThan(standing.boxHeight);

    // Quer: die Seite ist selbst im Querformat, der Screen füllt sie ungedreht.
    // Anders als die App steht er nicht in `#root`, das die Sperre zurückdreht.
    await page.setViewportSize({ width: portrait.height, height: portrait.width });
    await page.waitForTimeout(800);

    const lying = await readStage(page);

    expect(lying.transform).toBe('none');
    expect(lying.boxWidth).toBe(portrait.height);
    expect(lying.boxHeight).toBe(portrait.width);
    expect(lying.inBody).toBe(true);
    expect(lying.background).toBe(PAPER);

    // In beiden Lagen steht dasselbe da und ist bedienbar.
    await expect(page.locator('[data-guided-step]')).toHaveCount(3);
    await expect(page.getByRole('heading', { name: TEMPLATE_NAME })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start-Screen schließen' })).toBeVisible();
  });

  test('das „i“ öffnet den Hinweis im Info-Fenster und nur Schritte mit Hinweis haben eins', async ({
    page,
  }) => {
    await importGuidedTemplate(page);
    await openStartFromNowSheet(page);

    await expect(page.getByRole('button', { name: 'Hinweis: Kindhaltung' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Hinweis: Taube' }).click();

    const dialog = page.getByRole('dialog', { name: 'Hinweis · Taube' });

    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Das vordere Schienbein liegt quer.');

    // Die Karte ist Tinte auch auf der hellen Bühne: Titel und Text dürfen
    // deren Tinte nicht erben, sonst steht dunkel auf dunkel.
    const colors = await dialog.evaluate((card) => ({
      card: getComputedStyle(card).backgroundColor,
      title: getComputedStyle(card.querySelector('h2')!).color,
      text: getComputedStyle(card.querySelector('p:not(:first-child)')!).color,
    }));

    expect(colors.title).not.toBe(colors.card);
    expect(colors.text).not.toBe(colors.card);

    await dialog.getByRole('button', { name: 'Hinweis schließen' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Auch Escape schließt es.
    await page.getByRole('button', { name: 'Hinweis: Herabschauender Hund' }).click();
    await expect(page.getByRole('dialog', { name: 'Hinweis · Herabschauender Hund' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('der Plan führt einen heute geplanten Termin auf den Start-Screen', async ({ page }) => {
    await importGuidedTemplate(page, {
      planEntries: [{ date: localDateKey(), workout: TEMPLATE_NAME }],
    });

    await page.goto('./');
    await page.waitForTimeout(1200);
    await page.locator('[data-now-unit]').click();
    await page.waitForURL(/#\/guided\//);

    await expect(page.locator('[data-guided-stage="start"]')).toBeVisible();
    await expect(page.getByRole('heading', { name: TEMPLATE_NAME })).toBeVisible();
    // Es wurde keine Session gestartet: die Leiste mit ihrer Uhr gäbe es sonst.
    await page.getByRole('button', { name: 'Start-Screen schließen' }).click();
    await page.waitForTimeout(600);
    await expect(page.getByRole('timer')).toHaveCount(0);
  });

  test('die Detailseite zeigt die Schritte nur lesend und führt auf den Start-Screen', async ({
    page,
  }) => {
    await importGuidedTemplate(page);

    await page.goto('./#/templates');
    await page.waitForTimeout(800);

    // Die Liste nennt Schritte und Minuten statt „0 Übungen“ und kein Leer-Feld.
    const card = page.locator('section').filter({
      has: page.getByRole('heading', { name: TEMPLATE_NAME }),
    });

    await expect(card).toContainText('3 Schritte · ≈ 5 min');
    await expect(card).not.toContainText('Noch keine Übungen');
    await expect(page.getByText('0 Übungen')).toHaveCount(0);

    // Der Link der Karte heißt „Bearbeiten“, nicht wie die Vorlage.
    await card.getByRole('link', { name: 'Bearbeiten' }).click();
    await page.waitForURL(/#\/templates\//);

    const steps = page.getByRole('list', { name: 'Schritte' });

    await expect(steps.getByRole('listitem')).toHaveCount(3);
    await expect(steps.getByRole('listitem').nth(2)).toContainText('L · R');
    await expect(steps.getByRole('listitem').nth(2)).toContainText('2 × 1:15');

    // Keine Übungen, keine Zuordnungs-Bearbeitung.
    await expect(page.getByRole('heading', { name: 'Übungen im Workout' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Hinzufügen' })).toHaveCount(0);

    await page.getByRole('button', { name: /Start-Screen öffnen/ }).click();
    await page.waitForURL(/#\/guided\//);
    await expect(page.locator('[data-guided-stage="start"]')).toBeVisible();
  });
});
