import { expect, test, type Page } from '@playwright/test';
import { openExerciseSheet, resetDatabase, seedSampleData, startSampleSession } from './helpers';

/*
 * Die Übungsinfo über dem Sheet.
 *
 * Die Beispieldaten tragen für Front Squat - die erste Übung von Einheit A -
 * Anleitung (als Markdown-Liste), Tempo und eine Workout-Notiz. Die Zeile im
 * Sheet zeigt nur den Teaser und öffnet das Modal; dort steht alles.
 *
 * Den Bildfall deckt das nicht ab: Playwrights WebKit schreibt keine Blobs in
 * IndexedDB, also gibt es hier keine Übung mit Bild.
 */
function guideRow(page: Page) {
  return page.locator('[data-sheet] [data-exercise-guide]').getByRole('button', { name: /Ausführung/ });
}

async function expectNoHorizontalOverflow(page: Page, selector: string) {
  const overflow = await page.evaluate((target) => {
    const element = document.querySelector(target);
    return {
      page: document.documentElement.scrollWidth - window.innerWidth,
      element: element ? element.scrollWidth - element.clientWidth : 0,
    };
  }, selector);

  expect(overflow.page).toBeLessThanOrEqual(0);
  expect(overflow.element).toBeLessThanOrEqual(0);
}

test.describe('Übungsinfo in der Session', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
    await startSampleSession(page);
    await openExerciseSheet(page, 'Front Squat');
  });

  test('die Zeile zeigt den Teaser ohne Markdown-Zeichen und öffnet einen Dialog', async ({ page }) => {
    const row = guideRow(page);

    await expect(row).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(row).toContainText('Ellbogen hoch halten');
    await expect(row).not.toContainText('**');
    // 44px, wie jedes Tippziel.
    expect((await row.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  });

  test('zeigt Anleitung, Tempo und Notiz im Modal', async ({ page }) => {
    await guideRow(page).click();

    const info = page.locator('[data-exercise-info]');
    await expect(info).toBeVisible();
    // Das Sheet heißt ebenfalls "Front Squat" - also den Namen am Modal selbst prüfen.
    await expect(info).toHaveAttribute('role', 'dialog');
    await expect(info).toHaveAccessibleName('Front Squat');
    await expect(info.locator('li')).toHaveCount(2);
    await expect(info.locator('strong')).toHaveText('hoch');
    await expect(info).toContainText('Tempo 3-1-1');
    await expect(info).toContainText('In diesem Workout: RPE 7-8');
    await expect(info.getByRole('button', { name: 'Schließen' })).toBeFocused();
  });

  test('Escape schließt nur das Modal, das Sheet bleibt', async ({ page }) => {
    const row = guideRow(page);
    await row.click();
    await expect(page.locator('[data-exercise-info]')).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.locator('[data-exercise-info]')).toHaveCount(0);
    await expect(page.locator('[data-sheet]')).toBeVisible();
    await expect(row).toBeFocused();
  });

  test('der Schließen-Knopf schließt nur das Modal', async ({ page }) => {
    await guideRow(page).click();
    await page.locator('[data-exercise-info]').getByRole('button', { name: 'Schließen' }).click();

    await expect(page.locator('[data-exercise-info]')).toHaveCount(0);
    await expect(page.locator('[data-sheet]')).toBeVisible();
  });

  test('gibt die Scroll-Sperre frei, wenn man die Session mit offenem Modal verlässt', async ({
    page,
  }) => {
    // Im Safari-Tab reicht ein Wischen zurück: Sheet und Modal werden in
    // einem Zug abgebaut, und wer zuletzt aufräumt, darf nicht "hidden"
    // zurückschreiben - sonst scrollt keine Seite mehr bis zum Neuladen.
    await guideRow(page).click();
    await expect(page.locator('[data-exercise-info]')).toBeVisible();

    await page.goto('./#/exercises');
    await expect(page.locator('[data-exercise-info]')).toHaveCount(0);

    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  });

  /*
   * Das Modal ist zum Lesen da, im Stehen und mit dem Telefon in der Hand -
   * und Pinch-Zoom ist in der App gesperrt. 17px ist die Fließtextgröße von
   * iOS; darunter wird die Anleitung zur Fußnote.
   */
  test('setzt die Anleitung in Lesegröße', async ({ page }) => {
    await guideRow(page).click();

    const info = page.locator('[data-exercise-info]');
    await expect(info.locator('li').first()).toHaveCSS('font-size', '17px');
    await expect(info.getByText('Tempo 3-1-1')).toHaveCSS('font-size', '17px');
  });

  test('schiebt die Wertefelder nicht aus dem Bild', async ({ page }) => {
    await expect(page.locator('input[id$="-reps"]').first()).toBeInViewport();
  });
});

test.describe('Anleitung in der Bibliothek', () => {
  // Größer als die Metadaten der Karte und in Tinte statt Grau: die Anleitung
  // ist der Inhalt der Karte, nicht ihr Beiwerk.
  test('steht in 15px und in Tinte', async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
    await page.goto('./#/exercises');

    const card = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Front Squat', exact: true }) });
    await card.getByRole('button', { name: 'Verlauf anzeigen' }).click();
    const markdown = card.locator('[data-markdown]');
    await expect(markdown).toHaveCSS('font-size', '15px');
    await expect(markdown).toHaveCSS('color', 'rgb(12, 18, 16)');
  });
});

test.describe('Übungsinfo mit langem Wort', () => {
  test('läuft bei schmaler Breite weder im Modal noch in der Bibliothek über', async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
    await page.goto('./#/exercises');

    await page.getByRole('button', { name: 'Front Squat bearbeiten' }).click();
    // Je nach Breite inline oder im Sheet - beides trägt dieselben Felder.
    const instructions = page.getByLabel('Anleitung', { exact: true });
    await instructions.fill(
      `${await instructions.inputValue()}\n- ${'Hüftbeugerdehnungsvariante'.repeat(4)}`,
    );
    await page.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(page.getByText('Übung bearbeiten')).toHaveCount(0);

    const card = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Front Squat', exact: true }) });
    await card.getByRole('button', { name: 'Verlauf anzeigen' }).click();
    await expectNoHorizontalOverflow(page, 'section [data-markdown]');

    await startSampleSession(page);
    await openExerciseSheet(page, 'Front Squat');
    await guideRow(page).click();
    await expect(page.locator('[data-exercise-info]')).toBeVisible();
    await expectNoHorizontalOverflow(page, '[data-exercise-info] [data-markdown]');
  });
});
