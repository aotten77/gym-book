import { expect, test } from '@playwright/test';
import {
  closeExerciseSheet,
  completeActiveSet,
  minimizeRestMode,
  openExerciseSheet,
  resetDatabase,
  seedSampleData,
  startSampleSession,
} from './helpers';

/**
 * Der Ruhemodus.
 *
 * Was hier geprüft wird, ist genau das, woran die Vorgänger gescheitert sind:
 * die Pause muss aus einem Meter Entfernung lesbar sein, *ohne* dass man
 * deswegen die Übung aus der Hand gibt. Der Vollbildzustand liefert das erste,
 * der Reiter an der Kante das zweite.
 */
test.describe('Ruhemodus', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
    await startSampleSession(page);
  });

  test('übernimmt beim Abhaken den Bildschirm und lässt sich weglegen', async ({ page }) => {
    await openExerciseSheet(page, 'Front Squat');
    await page.locator('[data-sheet]').getByRole('button', { name: /abhaken$/ }).click();
    await page.waitForTimeout(700);

    // Der Vollbildzustand steht mit allem, was in der Pause zählt.
    const restMode = page.getByRole('dialog', { name: /^Pause · / });
    await expect(restMode).toBeVisible();
    await expect(restMode.getByText(/^Danach: /)).toBeVisible();

    // Und er lässt sich weglegen, ohne die Pause zu beenden.
    await page.getByRole('button', { name: 'Pause minimieren' }).click();
    await page.waitForTimeout(400);
    await expect(restMode).toBeHidden();

    const widget = page.locator('[data-rest-widget]');
    await expect(widget).toBeVisible();

    // Darunter ist das Sheet wieder bedienbar - das ist der ganze Zweck.
    await expect(page.getByRole('button', { name: /abhaken$/ })).toBeVisible();

    // Antippen holt ihn zurück.
    await widget.click();
    await page.waitForTimeout(400);
    await expect(restMode).toBeVisible();
  });

  test('der Reiter hängt an der Kante und lässt sich auf die andere ziehen', async ({ page }) => {
    await openExerciseSheet(page, 'Front Squat');
    await completeActiveSet(page);

    const widget = page.locator('[data-rest-widget]');
    await expect(widget).toBeVisible();
    await expect(widget).toHaveAttribute('data-rest-widget', 'right');

    const viewport = page.viewportSize();
    const before = await widget.boundingBox();

    // Er steht bewusst über den Rand hinaus - was übersteht, verdeckt nichts.
    expect(before!.x + before!.width).toBeGreaterThan(viewport!.width);

    await page.mouse.move(before!.x + 20, before!.y + before!.height / 2);
    await page.mouse.down();
    await page.mouse.move(40, before!.y + before!.height / 2, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(500);

    await expect(widget).toHaveAttribute('data-rest-widget', 'left');

    const after = await widget.boundingBox();
    expect(after!.x).toBeLessThan(0);

    // Nach dem Ziehen ist es immer noch ein Knopf, kein verrutschter Rest.
    await widget.click();
    await page.waitForTimeout(400);
    await expect(page.getByRole('dialog', { name: /^Pause · / })).toBeVisible();
  });

  test('genau eine Uhr spricht, auch wenn der Ruhemodus offen ist', async ({ page }) => {
    await openExerciseSheet(page, 'Front Squat');
    await page.locator('[data-sheet]').getByRole('button', { name: /abhaken$/ }).click();
    await page.waitForTimeout(700);

    await expect(page.getByRole('dialog', { name: /^Pause · / })).toBeVisible();
    await expect(page.locator('[role="timer"]')).toHaveCount(1);

    await minimizeRestMode(page);
    await expect(page.locator('[role="timer"]')).toHaveCount(1);
  });

  test('überlebt keinen Reload, die Pause dagegen schon', async ({ page }) => {
    await openExerciseSheet(page, 'Front Squat');
    await completeActiveSet(page);
    await expect(page.locator('[data-rest-widget]')).toBeVisible();

    await page.reload();
    await page.waitForTimeout(900);

    /*
      Nach dem Reload landet man in der Liste - Sheet und Ruhemodus sind
      Oberflächenzustand. Die Pause hängt dagegen an der Session und läuft
      weiter, sichtbar in der Leiste am unteren Rand.
    */
    await expect(page.locator('[data-sheet]')).toHaveCount(0);
    await expect(page.locator('[data-rest-widget]')).toHaveCount(0);
    await expect(page.getByRole('timer')).toBeVisible();

    // Und beim Zurückgehen in die Übung steht die Pause wieder groß.
    await openExerciseSheet(page, 'Front Squat');
    await expect(page.getByRole('dialog', { name: /^Pause · / })).toBeVisible();
  });

  test('„Weiter" beendet die Pause, ohne den Satz anzufassen', async ({ page }) => {
    await openExerciseSheet(page, 'Front Squat');
    await completeActiveSet(page);
    await page.locator('[data-rest-widget]').click();
    await page.waitForTimeout(400);

    await page.getByRole('button', { name: 'Weiter' }).click();
    await page.waitForTimeout(500);

    await expect(page.getByRole('dialog', { name: /^Pause · / })).toBeHidden();
    await expect(page.locator('[data-rest-widget]')).toHaveCount(0);

    // Das Sheet steht wieder da, mit dem nächsten offenen Satz.
    await expect(page.getByRole('button', { name: /abhaken$/ })).toBeVisible();

    await closeExerciseSheet(page);
    await expect(page.getByRole('button', { name: /Front Squat öffnen/ })).toBeVisible();
  });
});
