import { expect, test, type Page } from '@playwright/test';
import { collectPageErrors, resetDatabase } from './helpers';

/*
 * Der Ablauf einer geführten Einheit, nur mit Ton.
 *
 * Die Vorlage kommt wie in der Praxis über den Bibliotheks-Import, gestartet
 * wird auf dem Start-Screen. Geprüft wird, was nur ein echter WebKit-Viewport
 * zeigt: der dunkle Grund mit Leistenfarbe, die Lage im Querformat, höchstens
 * eine Lime-Fläche und das Ende. Die Uhr steuert Playwright (`page.clock`),
 * damit der Test nicht real wartet; wie sich der Stand aus der Zeit ergibt,
 * steht in `domain/guided-run.test.ts`. Ton ist hier nicht prüfbar.
 *
 * Kurze Einheit: Wechsel 5 s, Kindhaltung 4 s, Wechsel 5 s, Taube links 3 s,
 * Seitenwechsel 3 s, Taube rechts 3 s - zusammen 23 s. Jeder Sprung der Uhr
 * landet eine halbe Sekunde hinter einer Grenze.
 */

const TEMPLATE_NAME = 'Yoga Kurzflow';

const STEPS = [
  { name: 'Kindhaltung', seconds: 4, hint: 'Stirn auf den Boden legen.' },
  { name: 'Taube', seconds: 6, bothSides: true },
];

const INK = 'rgb(12, 18, 16)';
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

test.describe('Geführte Einheit: Ablauf', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
  });

  test('läuft von Wechsel zu Übung bis zum Ende und der Termin steht als erledigt im Plan', async ({
    page,
  }) => {
    const errors = collectPageErrors(page);

    await importGuidedTemplate(page);
    await startRun(page);

    // Der erste Wechsel: Name der ersten Übung in Weiß, der Ring ist die Lime-Fläche.
    await expect(run(page)).toHaveAttribute('data-guided-phase', 'transition');
    await expect(run(page)).toHaveAttribute('data-guided-section', 'transition');
    await expect(page.locator('[data-guided-name]')).toContainText('Kindhaltung');
    await expect(page.locator('[data-guided-ring]')).toBeVisible();

    // Dunkel auf Tinte, die Leistenfarbe zieht mit, und die Bühne steht quer.
    const stage = await page.evaluate(() => {
      const element = document.querySelector<HTMLElement>('[data-guided-stage]')!;

      return {
        tone: element.getAttribute('data-guided-tone'),
        background: getComputedStyle(element).backgroundColor,
        boxWidth: element.offsetWidth,
        boxHeight: element.offsetHeight,
        themeColor: document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content,
      };
    });

    expect(stage.tone).toBe('dark');
    expect(stage.background).toBe(INK);
    expect(stage.themeColor).toBe('#0c1210');
    expect(stage.boxWidth).toBeGreaterThan(stage.boxHeight);

    // 5,5 s: der Wechsel ist vorbei, die erste Übung läuft - ihr Name ist Lime, das Ring-Lime weg.
    await page.clock.runFor(5500);
    await expect(run(page)).toHaveAttribute('data-guided-phase', 'exercise');
    await expect(page.locator('[data-guided-name]')).toContainText('Kindhaltung');
    await expect(page.locator('[data-guided-next]')).toContainText('Taube');
    await expect(page.locator('[data-guided-ring]')).toHaveCount(0);
    expect(
      await page.locator('[data-guided-name]').evaluate((element) => getComputedStyle(element).color),
    ).toBe(LIME);

    // Das „i“ öffnet den Hinweis, die Zeit läuft weiter, und der nächste Wechsel schließt ihn.
    await page.getByRole('button', { name: 'Hinweis: Kindhaltung' }).click();
    await expect(page.getByRole('dialog', { name: 'Hinweis · Kindhaltung' })).toBeVisible();
    await expect(page.getByText('Die Zeit läuft weiter')).toBeVisible();

    // 9,5 s: Wechsel in die Taube, links.
    await page.clock.runFor(4000);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(run(page)).toHaveAttribute('data-guided-section', 'transition');
    await expect(page.locator('[data-guided-name]')).toContainText('Taube');
    await expect(page.locator('[data-guided-name] [data-guided-side]')).toHaveAttribute(
      'data-guided-side',
      'left',
    );

    // 14,5 s: Taube links, rechts steht als Nächstes an.
    await page.clock.runFor(5000);
    await expect(run(page)).toHaveAttribute('data-guided-section', 'exercise');
    await expect(page.locator('[data-guided-name] [data-guided-side]')).toHaveAttribute(
      'data-guided-side',
      'left',
    );
    await expect(page.locator('[data-guided-next] [data-guided-side]')).toHaveAttribute(
      'data-guided-side',
      'right',
    );

    // 17,5 s: Seitenwechsel.
    await page.clock.runFor(3000);
    await expect(run(page)).toHaveAttribute('data-guided-section', 'sideSwitch');

    // 20,5 s: Taube rechts.
    await page.clock.runFor(3000);
    await expect(run(page)).toHaveAttribute('data-guided-section', 'exercise');
    await expect(page.locator('[data-guided-name] [data-guided-side]')).toHaveAttribute(
      'data-guided-side',
      'right',
    );

    // 23,5 s: das Ende - der Abschluss-Screen mit den Kennzahlen.
    await page.clock.runFor(3000);
    await expect(page.locator('[data-guided-stage="finished"]')).toBeVisible();
    await expect(page.locator('[data-guided-done]')).toContainText('Erledigt');
    await expect(page.locator('[data-guided-done]')).toContainText(TEMPLATE_NAME);
    await expect(page.locator('[data-guided-done]')).toContainText('2/2');

    // Gespeichert ist schon vor „Fertig“; der Termin steht im Plan als erledigt.
    await page.getByRole('button', { name: 'Fertig' }).click();
    await page.waitForURL(/#\/$/);
    await page.waitForTimeout(800);
    await expect(
      page
        .locator(`[data-timeline-day="${localDateKey()}"] [data-plan-entry]`)
        .filter({ hasText: TEMPLATE_NAME }),
    ).toHaveAttribute('data-plan-entry-state', 'erledigt');

    expect(errors).toEqual([]);
  });

  test('das X verkleinert, die Einheit läuft weiter, und die Leiste führt zurück', async ({ page }) => {
    await importGuidedTemplate(page);
    await startRun(page);

    await page.getByRole('button', { name: 'Verkleinern' }).click();
    await page.waitForTimeout(600);

    // Die Leiste der App zeigt die laufende Einheit und führt auf den Ablauf zurück.
    await expect(page.getByText('Training läuft')).toBeVisible();
    await page.getByText('Training läuft').click();
    await page.waitForURL(/#\/guided\/run\//);
    await expect(page.locator('[data-guided-stage="run"]')).toBeVisible();
  });
});
