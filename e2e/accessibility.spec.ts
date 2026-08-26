import { expect, test, type Page } from '@playwright/test';
import { openExerciseSheet, resetDatabase, seedSampleData, startSampleSession } from './helpers';

const ROUTES = [
  ['Heute', './'],
  ['Programm', './#/programs'],
  ['Programm verwalten', './#/programs/manage'],
  ['Workouts', './#/templates'],
  ['Übungen', './#/exercises'],
  ['Verlauf', './#/history'],
  ['Tests', './#/tests'],
  ['Einstellungen', './#/settings'],
] as const;

/**
 * Misst den tatsächlich gerenderten Kontrast statt der Klassennamen.
 *
 * Der Auslöser: `text-zinc-500` lag auf Karten bei 3,67:1 und wurde an 48
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

    // Transparente Elternflächen überspringen, bis eine deckende kommt.
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

      // Der Seitengrund, wenn keine deckende Fläche darüber liegt (Feldgrün).
      return [242, 242, 239];
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
 * Prüft Trefferflächen gegen zwei Schwellen.
 *
 * Apple HIG empfiehlt 44x44pt; das ist der Maßstab für normale Bedienelemente.
 * Für die dichte Tab-Leiste gilt der normative WCAG-2.2-Wert von 24x24 CSS px
 * (SC 2.5.8, Level AA): auf einem 320px breiten Gerät sind sechs Zellen à 44px
 * geometrisch unmöglich, die Zellen messen dort 43x51px.
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

test.describe('Zugänglichkeit', () => {
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

  test('der Streifen der laufenden Einheit hält sich an dieselben Regeln', async ({ page }) => {
    // Die Route-Schleife oben sieht ihn nie: er steht nur, solange eine
    // Einheit läuft. Limette auf hellem Grund trägt hier ausnahmsweise Text -
    // als Fläche mit Tinte darauf, und genau das wird hier nachgemessen.
    await startSampleSession(page);
    await page.getByRole('button', { name: 'Session minimieren' }).click();
    await page.waitForURL(/#\/$/);
    await page.waitForTimeout(900);

    await expect(page.getByRole('button', { name: /Training läuft/ })).toBeVisible();
    expect(await findContrastViolations(page)).toEqual([]);
    expect(await findSmallTargets(page)).toEqual([]);
    expect(await findUnlabelledControls(page)).toEqual([]);

    // Auch außerhalb der Session gilt: eine Uhr, eine Live-Region.
    await expect(page.locator('[role="timer"]')).toHaveCount(1);
  });

  test('der Ruhemodus hält sich auf Tinte an dieselben Regeln', async ({ page }) => {
    /*
      Die einzige Fläche der App in Tinte - und damit die einzige, auf der ein
      Papier-Kontrast überhaupt gemessen werden muss. Der Fokusring der App ist
      ebenfalls Tinte und wäre hier unsichtbar; auch das steht hier auf dem
      Prüfstand, weil jede Bedienfläche im Ruhemodus ihren eigenen hellen Ring
      setzen muss.
    */
    await startSampleSession(page);
    await openExerciseSheet(page, 'Front Squat');
    await page.locator('[data-sheet]').getByRole('button', { name: /abhaken$/ }).click();
    await page.waitForTimeout(800);

    await expect(page.getByRole('dialog', { name: /^Pause · / })).toBeVisible();

    /*
      Kontrast über die ganze Seite - der greift auch durch den Ruhemodus
      hindurch und rechnet dabei mit dessen deckender Fläche.
    */
    expect(await findContrastViolations(page)).toEqual([]);
    expect(await findUnlabelledControls(page)).toEqual([]);

    /*
      Trefferflächen dagegen nur innerhalb des Ruhemodus. Unter ihm liegt die
      Übungsliste mit ihren 36px-Pfeilen; die sind ein eigener, älterer Befund
      und würden hier nur verdecken, ob *diese* Ansicht ihre Maße hält.
    */
    const smallInRestMode = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"][aria-label^="Pause · "]');

      return [...(dialog?.querySelectorAll('button') ?? [])]
        .map((button) => ({
          label: (button.getAttribute('aria-label') || button.textContent || '').trim().slice(0, 30),
          width: Math.round(button.getBoundingClientRect().width),
          height: Math.round(button.getBoundingClientRect().height),
        }))
        .filter((entry) => entry.width < 44 || entry.height < 44);
    });

    expect(smallInRestMode).toEqual([]);

    const ringsAreLight = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"][aria-label^="Pause · "]');

      return [...(dialog?.querySelectorAll('button') ?? [])].every((button) =>
        // Der helle Ring ist als Tailwind-Variable gesetzt, nicht als Farbe im
        // berechneten Stil - die Klasse ist hier die belastbare Auskunft.
        button.className.includes('focus-visible:ring-accent-contrast'),
      );
    });

    expect(ringsAreLight).toBe(true);
  });

  test('Tastaturnavigation zeigt einen sichtbaren Fokus', async ({ page }) => {
    // Auf einem Formularfeld statt auf der Startseite: WebKit springt per Tab
    // systembedingt nur zwischen Eingabefeldern, nicht über Buttons und
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
