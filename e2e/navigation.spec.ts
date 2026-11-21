import { expect, test } from '@playwright/test';
import { collectPageErrors, resetDatabase, seedSampleData, startSampleSession } from './helpers';

test.describe('Navigation', () => {
  test('fünf Einträge, Bestand bleibt auf einer Workout-Seite aktiv', async ({ page }) => {
    const errors = collectPageErrors(page);

    await resetDatabase(page);
    await seedSampleData(page);
    await page.goto('./#/templates');
    await page.waitForTimeout(900);

    await page.getByRole('link', { name: 'Bearbeiten' }).first().click();
    await page.waitForURL(/#\/templates\/.+/);

    const nav = page.getByRole('navigation', { name: 'Hauptnavigation' });
    await expect(nav.getByRole('listitem')).toHaveCount(5);
    await expect(nav.getByRole('link', { name: 'Bestand' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Plan' })).not.toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('button', { name: 'Jetzt trainieren' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('/programs leitet auf den Plan um', async ({ page }) => {
    const errors = collectPageErrors(page);

    await resetDatabase(page);
    await seedSampleData(page);
    await page.goto('./#/programs');
    await page.waitForTimeout(900);

    await expect(page).toHaveURL(/#\/$/);
    const nav = page.getByRole('navigation', { name: 'Hauptnavigation' });
    await expect(nav.getByRole('link', { name: 'Plan' })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('[data-timeline]')).toBeVisible();

    expect(errors).toEqual([]);
  });

  for (const width of [320, 390]) {
    test(`Leiste bei ${width}px: jeder Eintrag im Viewport, Jetzt ragt über die Leiste`, async ({ page }) => {
      await resetDatabase(page);
      await seedSampleData(page);
      await page.setViewportSize({ width, height: 700 });
      await page.goto('./#/library');
      await page.waitForTimeout(900);

      const nav = page.getByRole('navigation', { name: 'Hauptnavigation' });
      const items = nav.getByRole('listitem');
      await expect(items).toHaveCount(5);

      // Eine ul im Grid ist durch den Elterncontainer immer schmal genug; erst
      // die einzelnen Zellen zeigen, ob ein Eintrag aus dem Bild läuft.
      for (let index = 0; index < 5; index += 1) {
        const box = await items.nth(index).boundingBox();
        expect(box, `Eintrag ${index}`).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      }

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(overflow).toBeLessThanOrEqual(width);

      // Der Knopf ragt über die Oberkante der Leiste; ein beschneidender
      // Elterncontainer ließe ihn dort abschneiden.
      const navBox = await nav.boundingBox();
      const buttonBox = await nav.getByRole('button', { name: 'Jetzt trainieren' }).boundingBox();
      expect(buttonBox!.y).toBeLessThan(navBox!.y);

      const visible = await page.evaluate(() => {
        const button = document.querySelector('nav[aria-label="Hauptnavigation"] button');
        if (!button) return false;
        const rect = button.getBoundingClientRect();
        // Oberste Pixelzeile des Knopfs: trifft sie den Knopf, ist er nicht beschnitten.
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + 2);
        return hit !== null && button.contains(hit);
      });
      expect(visible).toBe(true);
    });
  }

  test('bei laufender Session überdeckt Jetzt den Streifen nicht', async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
    await page.setViewportSize({ width: 320, height: 700 });
    await startSampleSession(page);
    await page.goto('./#/library');
    await page.waitForTimeout(900);

    const bar = page.getByRole('button', { name: /Training läuft/ });
    await expect(bar).toBeVisible();
    const barBox = await bar.boundingBox();
    const buttonBox = await page
      .getByRole('navigation', { name: 'Hauptnavigation' })
      .getByRole('button', { name: 'Jetzt trainieren' })
      .boundingBox();
    expect(buttonBox!.y).toBeGreaterThanOrEqual(barBox!.y + barBox!.height);
  });
});
