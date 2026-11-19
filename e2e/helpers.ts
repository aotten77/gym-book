import { expect, type Page } from '@playwright/test';

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

/**
 * Startet eine Session aus der Beispielvorlage und liefert deren URL.
 *
 * Ein frischer Start öffnet das Fokus-Sheet von selbst. Die meisten Specs
 * gehen aber von der Liste aus und öffnen das Sheet über `openExerciseSheet`,
 * deshalb wird es hier wieder geschlossen. Dass der Start es öffnet, prüft
 * allein `session-start-focus.spec.ts`.
 */
export async function startSampleSession(page: Page) {
  await page.goto('./');
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Einheit A' }).first().click();
  await page.waitForURL(/#\/session\//);
  // Ein frischer Start öffnet das Sheet immer; darauf warten statt blind zu raten.
  await expect(page.locator('[data-sheet]')).toBeVisible();
  await closeExerciseSheet(page);

  return page.url();
}

/**
 * Öffnet das Fokus-Sheet einer Übung in der laufenden Einheit.
 *
 * Die Sätze stehen nicht mehr in der Liste, sondern im Sheet - jeder Test, der
 * an ein Eingabefeld will, muss es also erst öffnen. Ohne Namen wird die erste
 * Übung genommen; das ist die, die beim Start ohnehin dran ist.
 *
 * Ein frischer Start öffnet das Sheet von selbst (`startSampleSession` schließt
 * es wieder, damit die Tests von der Liste ausgehen). Reload und Rückkehr
 * öffnen es nie: ob es offen ist, ist reiner Oberflächenzustand und überlebt
 * kein `page.reload()`. Genau das müssen die Tests nachstellen können.
 */
export async function openExerciseSheet(page: Page, exerciseName?: string) {
  await minimizeRestMode(page);
  const opener = exerciseName
    ? page.getByRole('button', { name: `${exerciseName} öffnen` })
    : page.getByRole('button', { name: /öffnen$/ });

  await opener.first().click();
  await page.locator('[data-sheet]').waitFor();
  await page.waitForTimeout(400);
}

/** Schließt das Fokus-Sheet über den Knopf in seiner Kopfzeile. */
export async function closeExerciseSheet(page: Page) {
  await minimizeRestMode(page);
  await page.getByRole('button', { name: 'Übung schließen' }).click();
  await page.waitForTimeout(400);
}

/**
 * Klappt den Ruhemodus zum Reiter zusammen, falls er offen ist.
 *
 * Seit die Pause ein eigener Vollbildzustand ist, liegt sie nach jedem
 * Abhaken über dem Sheet - genau so ist sie gedacht. Wer im Test weiterklicken
 * will, muss sie vorher weglegen, wie im Training auch.
 */
export async function minimizeRestMode(page: Page) {
  const minimize = page.getByRole('button', { name: 'Pause minimieren' });

  if (await minimize.isVisible().catch(() => false)) {
    await minimize.click();
    await page.waitForTimeout(300);
  }
}

/**
 * Hakt den Satz ab, der gerade auf der Bühne liegt.
 *
 * Im Sheet ist immer genau ein Satz groß, und abgehakt wird er über den einen
 * Knopf im Fuß - der hängt am `visualViewport` und bleibt deshalb auch über
 * einer offenen Tastatur stehen. Seine Beschriftung trägt die Werte ("62,5 kg
 * × 5 abhaken"), weshalb hier nur das Ende des Namens geprüft wird.
 *
 * Danach übernimmt der Ruhemodus den Bildschirm; er wird gleich wieder
 * weggelegt, damit der aufrufende Test dort weitermachen kann, wo er war. Den
 * Vollbildzustand selbst prüft `session-rest-mode.spec.ts`.
 */
export async function completeActiveSet(page: Page) {
  await minimizeRestMode(page);
  await page.locator('[data-sheet]').getByRole('button', { name: /abhaken$/ }).click();
  await page.waitForTimeout(800);
  await minimizeRestMode(page);
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
  await minimizeRestMode(page);
  await page.getByRole('button', { name: `${label} auswählen` }).first().click();
  await minimizeRestMode(page);
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

/**
 * Öffnet das Sheet „Termin“ über „+ Termin“ am morgigen Tag des Programm-Tabs.
 * Für heute gibt es dort kein „+ Termin“ (heute trainiert man über „+ Einheit“);
 * wer einen heutigen Termin braucht, setzt im Sheet das Feld „Datum“ um.
 * An einem Sonntag liegt morgen in der nächsten Woche - die Zeile wird gewählt.
 */
export async function openAddEntryTomorrow(page: Page) {
  const { tomorrow, monday } = await page.evaluate(() => {
    const iso = (date: Date) =>
      `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
    const next = new Date();

    next.setDate(next.getDate() + 1);

    const start = new Date(next);

    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));

    return { tomorrow: iso(next), monday: iso(start) };
  });

  await page.locator(`[data-calendar-week="${monday}"]`).click();
  await page
    .locator(`[data-plan-day="${tomorrow}"]`)
    .getByRole('button', { name: /^\+ Termin am .* hinzufügen$/ })
    .click();
}
