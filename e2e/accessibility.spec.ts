import { expect, test, type Page } from '@playwright/test';
import { resetDatabase, seedSampleData } from './helpers';

const ROUTES = [
  ['Heute', './'],
  ['Plan', './#/programs'],
  ['Vorlagen', './#/templates'],
  ['Uebungen', './#/exercises'],
  ['Verlauf', './#/history'],
  ['Tests', './#/tests'],
  ['Einstellungen', './#/settings'],
] as const;

/**
 * Misst den tatsaechlich gerenderten Kontrast statt der Klassennamen.
 *
 * Der Ausloeser: `text-zinc-500` lag auf Karten bei 3,67:1 und wurde an 48
 * Stellen verwendet - sichtbar wird das nur an den berechneten Farben.
 */
async function findContrastViolations(page: Page) {
  return page.evaluate(() => {
    const luminance = (rgb: number[]) => {
      const channels = rgb
        .map((value) => value / 255)
        .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };

    const parseColor = (value: string) =>
      (value.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);

    // Transparente Elternflaechen ueberspringen, bis eine deckende kommt.
    const effectiveBackground = (element: Element): number[] => {
      let node: Element | null = element;

      while (node) {
        const match = getComputedStyle(node).backgroundColor.match(/rgba?\(([^)]+)\)/);

        if (match) {
          const parts = match[1].split(',').map(Number);
          const alpha = parts.length > 3 ? parts[3] : 1;

          if (alpha > 0.85) {
            return parts.slice(0, 3);
          }
        }

        node = node.parentElement;
      }

      return [9, 9, 11];
    };

    const violations: Array<{ text: string; ratio: number; required: number }> = [];

    document.querySelectorAll('p, span, h1, h2, h3, label, li, div, figcaption').forEach((element) => {
      const text = element.textContent?.trim();

      if (!text) return;
      // Nur Elemente bewerten, die den Text selbst tragen.
      if (element.children.length > 0 && text !== element.childNodes[0]?.textContent?.trim()) return;

      const styles = getComputedStyle(element);
      if (styles.visibility === 'hidden' || styles.display === 'none') return;

      const size = parseFloat(styles.fontSize);
      const weight = parseInt(styles.fontWeight, 10) || 400;
      const isLarge = size >= 24 || (size >= 18.66 && weight >= 700);
      const required = isLarge ? 3 : 4.5;

      const foreground = parseColor(styles.color);
      if (foreground.length < 3) return;

      const first = luminance(foreground);
      const second = luminance(effectiveBackground(element));
      const ratio = (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);

      if (ratio < required) {
        violations.push({ text: text.slice(0, 40), ratio: Number(ratio.toFixed(2)), required });
      }
    });

    return violations;
  });
}

/**
 * Prueft Trefferflaechen gegen zwei Schwellen.
 *
 * Apple HIG empfiehlt 44x44pt; das ist der Massstab fuer normale Bedienelemente.
 * Fuer die dichte Tab-Leiste gilt der normative WCAG-2.2-Wert von 24x24 CSS px
 * (SC 2.5.8, Level AA): auf einem 320px breiten Geraet sind sechs Zellen à 44px
 * geometrisch unmoeglich, die Zellen messen dort 43x51px.
 */
async function findSmallTargets(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('button, a[href], select, input:not([type=hidden])')]
      .filter((element) => {
        const styles = getComputedStyle(element);
        if (styles.visibility === 'hidden' || styles.display === 'none') return false;
        // Der Skip-Link ist absichtlich bis zum Fokus unsichtbar.
        if (element.classList.contains('sr-only')) return false;

        const box = element.getBoundingClientRect();
        if (box.width <= 1 || box.height === 0) return false;

        const minimum = element.closest('nav') ? 24 : 44;
        return box.height < minimum || box.width < minimum;
      })
      .map((element) => ({
        label: (element.getAttribute('aria-label') || element.textContent || '').trim().slice(0, 30),
        width: Math.round(element.getBoundingClientRect().width),
        height: Math.round(element.getBoundingClientRect().height),
      })),
  );
}

async function findUnlabelledControls(page: Page) {
  return page.evaluate(() => {
    const problems: string[] = [];

    document.querySelectorAll('button').forEach((element) => {
      const name = (element.getAttribute('aria-label') || element.textContent || '').trim();
      if (!name) problems.push(element.outerHTML.slice(0, 80));
    });

    document.querySelectorAll('input:not([type=hidden]), select, textarea').forEach((element) => {
      const hasLabel = element.id && document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
      if (!hasLabel && !element.getAttribute('aria-label')) {
        problems.push(element.outerHTML.slice(0, 80));
      }
    });

    return problems;
  });
}

test.describe('Zugaenglichkeit', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
  });

  for (const [name, path] of ROUTES) {
    test(`${name}: Kontrast, Touch-Ziele und Beschriftungen`, async ({ page }) => {
      await page.goto(path);
      await page.waitForTimeout(900);

      expect(await findContrastViolations(page)).toEqual([]);
      expect(await findSmallTargets(page)).toEqual([]);
      expect(await findUnlabelledControls(page)).toEqual([]);
    });
  }

  test('Tastaturnavigation zeigt einen sichtbaren Fokus', async ({ page }) => {
    // Auf einem Formularfeld statt auf der Startseite: WebKit springt per Tab
    // systembedingt nur zwischen Eingabefeldern, nicht ueber Buttons und
    // Links - das ist Browserverhalten, kein Mangel der App.
    await page.goto('./#/tests');
    await page.waitForTimeout(700);
    await page.getByRole('button', { name: 'Erfassen' }).click();
    await page.waitForTimeout(400);

    await page.keyboard.press('Tab');

    // Der Browser-Default-Ring ist auf dunklem Grund praktisch unsichtbar.
    const focusVisible = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element || element === document.body) return false;

      const styles = getComputedStyle(element);
      const hasOutline = styles.outlineStyle !== 'none' && parseFloat(styles.outlineWidth) >= 2;
      return hasOutline || (styles.boxShadow !== 'none' && styles.boxShadow !== '');
    });

    expect(focusVisible).toBe(true);
  });

  test('die Navigation bricht nicht mitten im Wort um', async ({ page }) => {
    await page.goto('./');
    await page.waitForTimeout(900);

    const labels = await page.evaluate(() =>
      [...document.querySelectorAll('nav a span')].map((span) => ({
        text: span.textContent ?? '',
        clipped: span.scrollWidth > span.clientWidth + 1,
      })),
    );

    expect(labels.length).toBeGreaterThan(0);
    expect(labels.filter((label) => label.clipped)).toEqual([]);
  });
});
