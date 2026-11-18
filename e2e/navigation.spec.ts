import { expect, test } from '@playwright/test';
import { collectPageErrors, resetDatabase, seedSampleData } from './helpers';

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

  test('läuft bei 320px nicht über', async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto('./#/library');
    await page.waitForTimeout(900);

    const overflow = await page.evaluate(() => {
      const list = document.querySelector('nav[aria-label="Hauptnavigation"] ul');
      return {
        list: list ? list.getBoundingClientRect().width : 0,
        scroll: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
      };
    });

    expect(overflow.list).toBeLessThanOrEqual(overflow.viewport);
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.viewport);
  });
});
