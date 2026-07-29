import type { Page } from '@playwright/test';

/**
 * Setzt die lokale Datenbank zurück.
 *
 * Die App hält ihren gesamten Zustand in IndexedDB - ohne Reset trägt jeder
 * Test die Daten des vorherigen mit sich herum.
 */
export async function resetDatabase(page: Page) {
  await page.goto('./');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase('gym-book-db');
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      }),
  );
  await page.reload();
  await page.waitForTimeout(800);
}

/**
 * Lädt das Beispielprogramm über die Einstellungen.
 *
 * Seit Phase B legt der erste Start bewusst keine Demo-Daten mehr an, damit
 * ein echter Nutzer keine erfundene Historie vorfindet. Tests, die eine
 * Vorlage brauchen, fordern sie deshalb explizit an.
 */
export async function seedSampleData(page: Page) {
  await page.goto('./#/settings');
  await page.waitForTimeout(600);

  const seedButton = page.getByRole('button', { name: 'Beispieldaten laden' });

  if (await seedButton.isEnabled()) {
    await seedButton.click();
    await page.waitForTimeout(1200);
  }
}

/** Startet eine Session aus der Beispielvorlage und liefert deren URL. */
export async function startSampleSession(page: Page) {
  await page.goto('./');
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Einheit A' }).first().click();
  await page.waitForURL(/#\/session\//);
  await page.waitForTimeout(600);
  return page.url();
}

/** Sammelt Konsolenfehler und unbehandelte Exceptions einer Seite. */
export function collectPageErrors(page: Page) {
  const errors: string[] = [];

  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });

  return errors;
}
