import { expect, test } from '@playwright/test';

/*
 * Die Versionskachel in den Einstellungen.
 *
 * Geprüft wird, dass Vites `define` wirklich im laufenden Bundle ankommt: in
 * vitest gibt es kein `define`, dort kann `readBuildInfo` nur `null` liefern -
 * ob die Kachel einen echten Hash zeigt, entscheidet sich erst hier.
 */
test('die Einstellungen nennen den Commit, aus dem die App gebaut wurde', async ({ page }) => {
  await page.goto('./#/settings');

  const tile = page.locator('[data-build-version]');
  await expect(tile).toBeVisible();
  await expect(tile.locator('[data-build-commit]')).toHaveText(/^[0-9a-f]{7}\+?$/);
  await expect(tile).toContainText('Stand vom');
  await expect(tile).not.toContainText('unbekannt');
});
