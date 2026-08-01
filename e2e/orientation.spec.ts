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
    // matrix(0, 1, -1, 0) ist die Drehung im Uhrzeigersinn - der Standardfall
    // ohne gemeldeten Winkel.
    expect(landscape.transform.startsWith('matrix(0, 1, -1, 0')).toBe(true);
  });

  test('in der Gegenrichtung wird andersherum gedreht', async ({ page }) => {
    /*
     * Ohne diese Fallunterscheidung stand die App in einer der beiden
     * Querformat-Lagen auf dem Kopf: eine feste 90-Grad-Drehung passt immer nur
     * zu einer Kipprichtung. Der Winkel kommt aus `screen.orientation` und wird
     * hier gefälscht, weil Playwright beim Tauschen der Viewport-Maße keine
     * echte Geräteorientierung meldet (`angle` bleibt 0). Gepatcht wird der
     * Prototyp, nicht die Instanz: WebKit hängt am neuen Viewport ein frisches
     * ScreenOrientation-Objekt ein, ein Instanz-Getter wäre danach weg.
     */
    await page.addInitScript(() => {
      Object.defineProperty(ScreenOrientation.prototype, 'angle', {
        configurable: true,
        get: () => 270,
      });
    });

    await resetDatabase(page);

    const viewport = page.viewportSize()!;
    await page.setViewportSize({ width: viewport.height, height: viewport.width });
    await page.waitForTimeout(800);

    const rotated = await page.evaluate(() => ({
      angleAttribute: document.documentElement.dataset.screenAngle,
      transform: getComputedStyle(document.getElementById('root')!).transform,
    }));

    expect(rotated.angleAttribute).toBe('270');
    // matrix(0, -1, 1, 0) ist die Drehung gegen den Uhrzeigersinn.
    expect(rotated.transform.startsWith('matrix(0, -1, 1, 0')).toBe(true);
  });
});
