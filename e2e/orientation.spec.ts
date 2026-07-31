import { expect, test } from '@playwright/test';
import { resetDatabase } from './helpers';

/*
 * Die App bleibt im Hochformat, auch wenn das Gerät gedreht wird.
 *
 * Das Manifest allein reicht dafür nicht: iOS ignoriert `orientation` und
 * kennt keine Orientierungssperre für Web-Apps. Die Darstellung übernimmt das
 * deshalb per CSS - genau das prüft dieser Test, und zwar an den gerenderten
 * Maßen statt am Klassennamen.
 */
test.describe('Hochformat erzwingen', () => {
  test('im Querformat wird die App zurückgedreht', async ({ page }) => {
    await resetDatabase(page);

    const portrait = await page.evaluate(() => {
      const root = document.getElementById('root')!;
      return { transform: getComputedStyle(root).transform };
    });

    // Im Hochformat bleibt alles unangetastet.
    expect(portrait.transform).toBe('none');

    const viewport = page.viewportSize()!;
    await page.setViewportSize({ width: viewport.height, height: viewport.width });
    await page.waitForTimeout(800);

    const landscape = await page.evaluate(() => {
      const root = document.getElementById('root')!;
      const styles = getComputedStyle(root);

      return {
        transform: styles.transform,
        /*
         * `offsetWidth` statt `getBoundingClientRect`: letzteres liefert die
         * achsenparallele Hülle nach der Drehung und damit wieder die
         * Querformat-Breite. Gemessen wird die Layout-Box - sie ist so breit
         * wie das Gerät hoch ist, das Layout rechnet also im Hochformat.
         */
        boxWidth: root.offsetWidth,
        boxHeight: root.offsetHeight,
        documentScrollable: document.documentElement.scrollHeight > window.innerHeight + 1,
      };
    });

    // matrix(0, 1, -1, 0, ...) ist die 90-Grad-Drehung.
    expect(landscape.transform).toContain('matrix');
    expect(landscape.transform).not.toBe('none');
    expect(landscape.boxWidth).toBe(viewport.width);
    expect(landscape.boxHeight).toBe(viewport.height);
    // Gescrollt wird im gedrehten Rahmen, nicht im Dokument - sonst liefe die
    // Seite quer aus dem Bild.
    expect(landscape.documentScrollable).toBe(false);
  });
});
