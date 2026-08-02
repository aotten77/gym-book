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

/**
 * Öffnet das Fokus-Sheet einer Übung in der laufenden Einheit.
 *
 * Die Sätze stehen nicht mehr in der Liste, sondern im Sheet - jeder Test, der
 * an ein Eingabefeld will, muss es also erst öffnen. Ohne Namen wird die erste
 * Übung genommen; das ist die, die beim Start ohnehin dran ist.
 *
 * Bewusst kein automatisches Öffnen beim Sessionstart: ob das Sheet offen ist,
 * ist reiner Oberflächenzustand und überlebt kein `page.reload()`. Genau das
 * müssen die Tests nachstellen können.
 */
export async function openExerciseSheet(page: Page, exerciseName?: string) {
  const opener = exerciseName
    ? page.getByRole('button', { name: `${exerciseName} öffnen` })
    : page.getByRole('button', { name: /öffnen$/ });

  await opener.first().click();
  await page.getByRole('dialog').waitFor();
  await page.waitForTimeout(400);
}

/** Schließt das Fokus-Sheet über den Knopf in seiner Kopfzeile. */
export async function closeExerciseSheet(page: Page) {
  await page.getByRole('button', { name: 'Übung schließen' }).click();
  await page.waitForTimeout(400);
}

/**
 * Hakt den Satz ab, der gerade auf der Bühne liegt.
 *
 * Im Sheet ist immer genau ein Satz groß, und abgehakt wird er über den einen
 * Knopf im Fuß - der hängt am `visualViewport` und bleibt deshalb auch über
 * einer offenen Tastatur stehen. Seine Beschriftung trägt die Werte ("62,5 kg
 * × 5 abhaken"), weshalb hier nur das Ende des Namens geprüft wird.
 */
export async function completeActiveSet(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: /abhaken$/ }).click();
  await page.waitForTimeout(800);
}

/**
 * Bringt eine Pause zum Laufen.
 *
 * Es gibt genau einen Weg dorthin: einen Satz abhaken. Der Knopf, der eine
 * Pause von Hand startete, ist weg - eine Pause ohne Satz davor gab es im
 * Training nie.
 */
export async function startRestByCompletingSet(page: Page, exerciseName?: string) {
  await openExerciseSheet(page, exerciseName);
  await completeActiveSet(page);
  await closeExerciseSheet(page);
}

/**
 * Holt eine bestimmte Satzzeile auf die Bühne.
 *
 * Nötig für alles, was nicht der nächste offene Satz ist - einen Aufwärmsatz
 * korrigieren, eine Seite gezielt abhaken.
 */
export async function selectSetRow(page: Page, label: string) {
  await page.getByRole('button', { name: `${label} auswählen` }).first().click();
  await page.waitForTimeout(400);
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
