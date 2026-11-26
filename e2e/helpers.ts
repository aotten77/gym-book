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
 * Gestartet wird über das Jetzt-Sheet, nicht über den Plan: je nach Wochentag
 * steht „Einheit A“ dort als künftiger Termin, und ein Tap darauf öffnet nur
 * die Anzeige.
 *
 * Ein frischer Start öffnet das Fokus-Sheet von selbst. Die meisten Specs
 * gehen aber von der Liste aus und öffnen das Sheet über `openExerciseSheet`,
 * deshalb wird es hier wieder geschlossen. Dass der Start es öffnet, prüft
 * allein `session-start-focus.spec.ts`.
 */
export async function startSampleSession(page: Page) {
  await page.goto('./');
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Jetzt trainieren' }).click();
  await tapNowSheetWorkout(page, 'Einheit A');
  await page.waitForURL(/#\/session\//);
  // Ein frischer Start öffnet das Sheet immer; darauf warten statt blind zu raten.
  await expect(page.locator('[data-sheet]')).toBeVisible();
  await closeExerciseSheet(page);

  return page.url();
}

/**
 * Tippt im offenen Jetzt-Sheet auf ein Workout - die Lime-Zeile, falls es
 * heute geplant ist. Liegt sein Termin an einem anderen Tag in der Nähe, fragt
 * ein Dialog „vorziehen oder zusätzlich?“; je nach Wochentag tut er das bei
 * den Beispieldaten. Dann wird zusätzlich trainiert, damit kein Termin wandert.
 */
export async function tapNowSheetWorkout(page: Page, name: string) {
  await page.locator('[data-sheet]').getByRole('button', { name }).first().click();
  // Entweder ist der Start schon unterwegs, oder die Rückfrage steht da.
  await page.waitForFunction(
    () =>
      /^#\/(session|guided)\//.test(location.hash) ||
      document.querySelector('[role="alertdialog"]') !== null,
  );

  const extra = page.getByRole('button', { name: 'Zusätzlich trainieren' });

  if (await extra.isVisible()) {
    await extra.click();
  }
}

/**
 * Öffnet das Lauf-Sheet über „Jetzt trainieren“ → „Lauf eintragen“. Die
 * Startseite trägt keinen eigenen Knopf dafür mehr; das Jetzt-Sheet schließt
 * sich, bevor das Lauf-Sheet aufgeht.
 */
export async function openRunLogFromNow(page: Page) {
  await page.getByRole('button', { name: 'Jetzt trainieren' }).click();
  await page.locator('[data-sheet]').getByRole('button', { name: 'Lauf eintragen' }).click();
  await expect(page.locator('[data-sheet]').getByRole('button', { name: 'Lauf speichern' })).toBeVisible();
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
 * Legt Termine über den Bibliothek-Import an - der einzige Weg, auf dem die App
 * Einzeltermine schreibt. Ohne `planRange`: nichts wird entfernt, und es gibt
 * keinen Sicherungs-Download. Die Beschriftung „Import bestätigen“ gibt es
 * auch in den Einstellungen; auf `#/sync` steht nur dieser Abschnitt.
 */
export async function importPlan(page: Page, planEntries: unknown[]) {
  await page.goto('./#/sync');
  await page.waitForTimeout(600);
  await page.getByLabel('Oder JSON einfügen').fill(JSON.stringify({ schemaVersion: 1, planEntries }));
  await page.getByRole('button', { name: 'Vorschau erzeugen' }).click();
  await page.getByRole('button', { name: 'Import bestätigen' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Eingespielt' })).toBeVisible();
}

/**
 * Räumt die Termine der Beispieldaten weg - Tests, die den Plan selbst per
 * `importPlan` aufbauen, gehen von einem leeren aus.
 */
export async function clearPlanEntries(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('gym-book-db');

        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          const tx = database.transaction('planEntries', 'readwrite');

          tx.objectStore('planEntries').clear();
          tx.oncomplete = () => {
            database.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
}

/**
 * Setzt in den Einstellungen das Programmstart-Datum und landet danach auf
 * dem Plan. Ohne Startdatum trägt keine Kalenderwoche eine Programmwoche -
 * und damit gibt es auch keine Vorgaben anzusehen.
 */
export async function setProgramStart(page: Page, date: string) {
  await page.goto('./#/settings');
  await page.waitForTimeout(1200);
  await page.getByLabel('Programmstart').fill(date);
  await page.waitForTimeout(900);

  await page.goto('./');
  await page.waitForTimeout(1200);
}

/**
 * Eine stille WAV (PCM, mono, 8 kHz, 8 bit) als Base64 - die Antwort der
 * abgefangenen Google-Synthese, wenn ein Test eine messbare Ansage braucht.
 * WebKit dekodiert WAV mit `decodeAudioData`, die Platzhalter-MP3 nicht; so
 * misst die App eine echte Dauer, ohne Test-Hook im Produktcode.
 */
export function silentWavBase64(seconds: number): string {
  const sampleRate = 8_000;
  const dataSize = sampleRate * seconds;
  const wav = Buffer.alloc(44 + dataSize, 0x80); // 0x80 ist Stille bei 8 bit.

  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16); // Länge des fmt-Blocks
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate, 28); // Bytes je Sekunde
  wav.writeUInt16LE(1, 32); // Bytes je Frame
  wav.writeUInt16LE(8, 34); // Bits je Sample
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(dataSize, 40);

  return wav.toString('base64');
}
