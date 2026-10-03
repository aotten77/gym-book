import { expect, test } from '@playwright/test';
import { resetDatabase, seedSampleData } from './helpers';

/*
 * Anleitungen sind eine kleine Markdown-Teilmenge (src/lib/markdown-lite.ts).
 * Die Beispieldaten schreiben die Front-Squat-Anleitung als Liste mit einer
 * fetten Stelle - in der Bibliothek darf davon kein Sternchen übrig bleiben.
 */
test.describe('Markdown in der Bibliothek', () => {
  test('rendert Liste und Fett statt der Zeichen', async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
    await page.goto('./#/exercises');

    const card = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Front Squat', exact: true }) });

    await card.getByRole('button', { name: 'Verlauf anzeigen' }).click();

    // Die Karte trägt darunter auch den Verlauf als Liste - deshalb nur der
    // Anleitungstext selbst.
    const instructions = card.locator('[data-markdown]');

    await expect(instructions.locator('li')).toHaveCount(2);
    await expect(instructions.locator('strong')).toHaveText('hoch');
    await expect(instructions).toContainText('Ellbogen hoch halten');
    await expect(card).not.toContainText('**');
  });
});
