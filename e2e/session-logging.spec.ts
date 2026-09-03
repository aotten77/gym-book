import { expect, test, type Page } from '@playwright/test';
import {
  collectPageErrors,
  completeActiveSet,
  minimizeRestMode,
  openExerciseSheet,
  resetDatabase,
  seedSampleData,
  selectSetRow,
  startRestByCompletingSet,
  startSampleSession,
  closeExerciseSheet,
} from './helpers';

/*
 * Deckt die Befunde ab, an denen zuvor Trainingsdaten verloren gingen.
 * Keiner davon lässt sich im jsdom nachstellen: es braucht echte
 * Eingabefelder, einen echten Reload und einen laufenden Timer.
 */
test.describe('Satz-Protokollierung', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
  });

  test('deutsches Dezimalkomma wird gespeichert und überlebt einen Reload', async ({ page }) => {
    await startSampleSession(page);
    await openExerciseSheet(page);

    // Number("52,5") ergibt NaN. Früher wurde daraus `undefined`, und Dexies
    // Table.update löscht damit die Property - der Wert war weg.
    await page.locator('input[id$="-weight"]').first().fill('82,5');
    await page.locator('input[id$="-reps"]').first().fill('5');
    await page.waitForTimeout(1200); // Autosave abwarten

    await page.reload();
    await page.waitForTimeout(1200);
    // Ein offenes Sheet ist Oberflächenzustand und überlebt den Reload nicht.
    await openExerciseSheet(page);

    await expect(page.locator('input[id$="-weight"]').first()).toHaveValue('82,5');
    await expect(page.locator('input[id$="-reps"]').first()).toHaveValue('5');
  });

  test('eine ungültige Eingabe lässt den gespeicherten Wert unangetastet', async ({ page }) => {
    await startSampleSession(page);
    await openExerciseSheet(page);

    const weight = page.locator('input[id$="-weight"]').first();
    await weight.fill('82,5');
    await page.waitForTimeout(1200);

    await weight.fill('abc');
    await page.waitForTimeout(1000);
    await expect(page.getByRole('alert').first()).toBeVisible();

    await page.reload();
    await page.waitForTimeout(1200);
    await openExerciseSheet(page);

    await expect(page.locator('input[id$="-weight"]').first()).toHaveValue('82,5');
  });

  test('das Speichern eines Feldes überschreibt nicht das Nachbarfeld', async ({ page }) => {
    await startSampleSession(page);
    await openExerciseSheet(page);

    // Genau hier lag ein Fehler, den alle Unit-Tests passierten: der Sync aus
    // der Live-Query warf den gerade getippten Wert im Nachbarfeld weg.
    await page.locator('input[id$="-weight"]').first().fill('60');
    await page.locator('input[id$="-reps"]').first().fill('8');
    await page.waitForTimeout(1400);
    await page.reload();
    await page.waitForTimeout(1200);
    await openExerciseSheet(page);

    await expect(page.locator('input[id$="-weight"]').first()).toHaveValue('60');
    await expect(page.locator('input[id$="-reps"]').first()).toHaveValue('8');
  });
});

test.describe('Satz-Timer', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
  });

  /**
   * Die stille Start-Taste des ersten Satzes der Zeitübung im Beispielprogramm.
   *
   * Der Name ist bewusst eng gefasst: daneben steht der zweite Startknopf, der
   * mit Ansagen startet und ebenfalls auf "starten" endet.
   */
  function startButton(page: Page) {
    return page.getByRole('button', { name: /^\d\d:\d\d starten$/ }).first();
  }

  test('startet mit der Zeit, die im Feld vorbelegt ist', async ({ page }) => {
    await startSampleSession(page);
    await openExerciseSheet(page, 'Nordic Curl Iso');

    /*
     * Der Countdown lief über `targetSeconds` der Übung, während im Feld die
     * Zeit der letzten Woche als Platzhalter stand - dieselbe Zahl musste
     * also erneut getippt werden, damit der Timer sie stellt. Die Prüfung
     * liest den Platzhalter statt einer festen Zahl: welche Woche das
     * Beispielprogramm gerade zeigt, hängt am Datum.
     */
    const seconds = page.locator('input[id$="-seconds"]').first();
    const placeholder = await seconds.getAttribute('placeholder');
    expect(placeholder).toMatch(/^\d+$/);

    const prefilled = Number(placeholder);
    const expected = `${String(Math.floor(prefilled / 60)).padStart(2, '0')}:${String(
      prefilled % 60,
    ).padStart(2, '0')}`;

    await expect(startButton(page)).toHaveAccessibleName(`${expected} starten`);
  });

  test('läuft nach einem Reload weiter und übernimmt die gehaltene Zeit', async ({ page }) => {
    await startSampleSession(page);
    // Die Zeitübung steht im Beispielprogramm an dritter Stelle.
    await openExerciseSheet(page, 'Nordic Curl Iso');

    // Zeit anpassen, bevor es losgeht: 90s reichen sicher über den Reload
    // hinaus, ohne dass der Test auf das Ablaufen wartet.
    const target = page.locator('input[id$="-seconds"]').first();
    await target.fill('90');
    await page.waitForTimeout(1200);

    await startButton(page).click();
    await expect(page.getByRole('timer')).toBeVisible();

    // Derselbe Vertrag wie beim Pausentimer: ein Plank überdauert
    // Bildschirmsperre und Reload, also liegt der Timer in IndexedDB.
    await page.reload();
    await page.waitForTimeout(1200);
    // Der Timer hängt an der Session und läuft weiter, auch ohne offenes Sheet.
    await expect(page.getByRole('timer')).toBeVisible();
    await openExerciseSheet(page, 'Nordic Curl Iso');

    await page.getByRole('button', { name: /Zeit stoppen/ }).click();
    await page.waitForTimeout(800);

    await expect(page.getByRole('timer')).toBeHidden();
    // Genau dafür ist der Timer da: die gemessene Zeit steht im Satz, ohne
    // dass jemand sie eintippt - und zwar die gehaltene, nicht die geplante.
    await expect(target).toBeEnabled();
    await expect(target).not.toHaveValue('');
    await expect(target).not.toHaveValue('90');
  });

  test('zählt über die Vorgabe hinaus weiter und schreibt die längere Zeit', async ({ page }) => {
    /*
     * Der Grund für die ganze Überzeit: die Uhr endete bei 0 und trug die
     * Vorgabe ein. Damit stand in jedem Zeit-Satz exakt die geplante Zahl, und
     * wer länger hielt, sah davon nichts - die Sekundenkurve war eine
     * Waagerechte.
     */
    await startSampleSession(page);
    await openExerciseSheet(page, 'Nordic Curl Iso');

    // 5s ist die kürzeste Zeit, die [clampSetTimerSeconds] zulässt - der Test
    // wartet damit nur wenige Sekunden auf den Ablauf.
    const seconds = page.locator('input[id$="-seconds"]').first();
    await seconds.fill('5');
    await page.waitForTimeout(1200);

    await expect(startButton(page)).toHaveAccessibleName('00:05 starten');
    await startButton(page).click();

    // Nach dem Ablauf steht die Uhr nicht still und verschwindet auch nicht:
    // sie zählt mit Pluszeichen weiter, bis jemand stoppt.
    await expect(page.getByRole('timer')).toHaveText(/^\+00:0[2-9]$/, { timeout: 12_000 });

    await page.getByRole('button', { name: /Zeit stoppen/ }).click();
    await page.waitForTimeout(800);

    await expect(page.getByRole('timer')).toBeHidden();
    expect(Number(await seconds.inputValue())).toBeGreaterThan(5);
  });

  test('verwerfen lässt den bereits eingetragenen Wert stehen', async ({ page }) => {
    await startSampleSession(page);
    await openExerciseSheet(page, 'Nordic Curl Iso');

    const seconds = page.locator('input[id$="-seconds"]').first();
    await seconds.fill('30');
    await page.waitForTimeout(1200);

    await startButton(page).click();
    await expect(page.getByRole('timer')).toBeVisible();
    // Während der Messung gehört die Bühne dem Timer: das Feld tritt ab,
    // gemessen wird ohnehin und eine Eingabe würde beim Stoppen überschrieben.
    await expect(seconds).toBeHidden();

    await page.getByRole('button', { name: /Satz-Timer verwerfen/ }).click();
    await page.waitForTimeout(600);

    await expect(page.getByRole('timer')).toBeHidden();
    await expect(seconds).toHaveValue('30');
  });
});

test.describe('Pausentimer', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
  });

  test('läuft nach einem Reload weiter', async ({ page }) => {
    await startSampleSession(page);

    await startRestByCompletingSet(page);
    await expect(page.getByRole('timer')).toBeVisible();

    // Der Vertrag verlangt "recoverable after backgrounding or reload" -
    // deshalb liegt die Deadline in IndexedDB, nicht im UI-Store.
    await page.reload();
    await page.waitForTimeout(1200);

    await expect(page.getByRole('timer')).toBeVisible();
  });

  test('lässt sich abbrechen', async ({ page }) => {
    await startSampleSession(page);

    await startRestByCompletingSet(page);
    await expect(page.getByRole('timer')).toBeVisible();

    await page.getByRole('button', { name: 'Pausentimer abbrechen' }).click();
    await page.waitForTimeout(600);

    await expect(page.getByRole('timer')).toBeHidden();
  });
});

test.describe('Übung zur Session hinzufügen', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
  });

  test('nur Auswahl aus der Bibliothek, kein Neuanlage-Formular', async ({ page }) => {
    await startSampleSession(page);

    // Die Session-Steuerung steht oben und unten - hier der obere Block.
    await page.getByRole('button', { name: 'Übung hinzufügen' }).first().click();
    await page.waitForTimeout(400);

    await expect(page.getByRole('button', { name: 'Neu', exact: true })).toHaveCount(0);

    await page.locator('select').selectOption({ label: 'Nordic Curl Iso' });
    await page.getByRole('button', { name: 'Zur Session hinzufügen' }).click();
    await page.waitForTimeout(900);

    await expect(page.getByText('Nordic Curl Iso').first()).toBeVisible();
  });
});

test.describe('Session-Lebenszyklus', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
  });

  test('eine abgebrochene Session gibt den Start wieder frei', async ({ page }) => {
    const errors = collectPageErrors(page);
    await startSampleSession(page);

    // Ohne abortSession blockierte eine versehentlich gestartete Session
    // jeden weiteren Trainingsstart - der Status existierte nur im Modell.
    await page.getByRole('button', { name: 'Session abbrechen' }).first().click();
    await page.waitForURL(/#\/$/);
    await page.waitForTimeout(800);

    await expect(page.getByText('Ein Training läuft bereits')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Einheit A' }).first()).toBeEnabled();
    expect(errors).toEqual([]);
  });

  test('die Session lässt sich verlassen, ohne sie zu beenden', async ({ page }) => {
    const sessionUrl = await startSampleSession(page);

    // Zuvor führte aus der Übungsliste nur der Weg über die Einstellungen
    // hinaus - abbrechen und abschließen sind keine Antwort auf "ich will
    // kurz woanders nachsehen".
    await page.getByRole('button', { name: 'Session minimieren' }).click();
    await page.waitForURL(/#\/$/);
    await page.waitForTimeout(600);

    const sessionBar = page.getByRole('button', { name: /Training läuft/ });
    await expect(sessionBar).toBeVisible();

    // Der Streifen steht auf jeder Seite, nicht nur auf der Startseite:
    // sonst wäre das Minimieren nur ein Umweg zurück zur Karte.
    await page.goto('./#/history');
    await page.waitForTimeout(600);
    await expect(page.getByRole('button', { name: /Training läuft/ })).toBeVisible();

    await page.getByRole('button', { name: /Training läuft/ }).click();
    await page.waitForURL(/#\/session\//);
    expect(page.url()).toBe(sessionUrl);
  });

  test('bei laufendem Training wird das sichtbar gemacht', async ({ page }) => {
    await startSampleSession(page);
    await page.goto('./');
    await page.waitForTimeout(800);

    // Früher führte ein Tap auf eine andere Vorlage stillschweigend in die
    // laufende Session - für den Nutzer sah das aus wie ein Defekt.
    await expect(page.getByText('Ein Training läuft bereits')).toBeVisible();
  });
});

test.describe('Eingabefelder', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
  });

  test('kein Feld liegt unter 16px', async ({ page }) => {
    await startSampleSession(page);
    await openExerciseSheet(page);

    /*
     * iOS Safari zoomt beim Fokus in jedes Feld hinein, dessen Schrift kleiner
     * als 16px ist - genau der Zoom, den die App nicht haben soll. Berechnete
     * Schriftgrössen kennt nur ein echter Browser, jsdom nicht.
     */
    const tooSmall = await page.evaluate(() =>
      [...document.querySelectorAll('input, select, textarea')]
        .filter((element) => (element as HTMLElement).offsetParent !== null)
        .map((element) => ({
          id: element.id || element.getAttribute('aria-label') || element.tagName,
          fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
        }))
        .filter((entry) => entry.fontSize < 16),
    );

    expect(tooSmall).toEqual([]);
  });
});

test.describe('Werte der letzten Session', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
  });

  test('stehen als Platzhalter im Feld und werden per Fertig übernommen', async ({ page }) => {
    /*
     * Die Beispieldaten bringen eine abgeschlossene Session von vor sechs Tagen
     * mit - deren Werte sind die "letzte Woche" für die neue Session.
     */
    await startSampleSession(page);
    await openExerciseSheet(page);

    const weight = page.locator('input[id$="-weight"]').first();
    const placeholder = await weight.getAttribute('placeholder');

    expect(placeholder).toBeTruthy();
    await expect(weight).toHaveValue('');

    await completeActiveSet(page);

    // Ohne Eingabe abgehakt: der Platzhalter wird zum gespeicherten Wert und
    // überlebt einen Reload.
    await page.reload();
    await page.waitForTimeout(1200);
    await openExerciseSheet(page);

    /*
     * Nach dem Reload liegt der nächste offene Satz auf der Bühne - der
     * abgehakte Aufwärmsatz muss dafür erst wieder ausgewählt werden.
     */
    await selectSetRow(page, 'Aufwärmen');
    await expect(page.locator('input[id$="-weight"]').first()).toHaveValue(placeholder!);
  });
});

test.describe('Sätze und Reihenfolge', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
  });

  test('ein leerer Warmup-Satz lässt sich ohne Rückfrage entfernen', async ({ page }) => {
    await startSampleSession(page);
    await openExerciseSheet(page);

    /*
     * Der Aufwärmsatz liegt beim Öffnen ohnehin auf der Bühne - er ist die
     * erste offene Zeile. Entfernt wird er über den Knopf an der Bühne, und
     * gezählt werden die Satzzeilen darunter.
     */
    const rowsBefore = await page.locator('[data-set-row]').count();

    await page.getByRole('button', { name: 'Aufwärmen entfernen' }).click();
    await page.waitForTimeout(900);

    expect(await page.locator('[data-set-row]').count()).toBe(rowsBefore - 1);
  });

  test('ein Satz lässt sich anhängen - bei einer einseitigen Übung beide Seiten', async ({
    page,
  }) => {
    await startSampleSession(page);

    // Bulgarian Split Squat ist einseitig: eine Runde sind zwei Zeilen, und
    // genau so muss sie auch nachträglich entstehen.
    await openExerciseSheet(page, 'Bulgarian Split Squat');

    const rowsBefore = await page.locator('[data-set-row]').count();

    await page.getByRole('button', { name: 'Satz hinzufügen' }).click();
    await page.waitForTimeout(900);

    expect(await page.locator('[data-set-row]').count()).toBe(rowsBefore + 2);
    await expect(page.getByRole('button', { name: 'Satz 3 · links auswählen' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Satz 3 · rechts auswählen' })).toBeVisible();
  });

  test('auch eine fertige Übung nimmt noch einen Satz an', async ({ page }) => {
    await startSampleSession(page);
    await openExerciseSheet(page, 'Front Squat');

    // Aufwärmsatz plus drei Arbeitssätze - danach schließt sich das Sheet von
    // selbst, weil der Block keine offene Zeile mehr hat.
    for (let index = 0; index < 4; index += 1) {
      await completeActiveSet(page);
    }

    await expect(page.locator('[data-sheet]')).toHaveCount(0);

    /*
     * Die waldgrüne Zeile in der Liste öffnet ihr Sheet weiterhin - das ist der
     * Weg zurück, und dort muss der Knopf stehen. Sonst wäre "noch ein Satz"
     * genau in dem Moment nicht mehr zu haben, in dem man ihn braucht.
     */
    await openExerciseSheet(page, 'Front Squat');
    /*
     * Die Pause des letzten Satzes läuft noch, und der Ruhemodus legt sich
     * beim Wiederöffnen über das Sheet - so ist er gedacht. Weglegen wie im
     * Training, dann steht der Knopf da.
     */
    await minimizeRestMode(page);

    await page.getByRole('button', { name: 'Satz hinzufügen' }).click();
    await page.waitForTimeout(900);

    await expect(page.getByRole('button', { name: 'Satz 4 auswählen' })).toBeVisible();
    // Der neue Satz ist die einzige offene Zeile und liegt deshalb groß auf der
    // Bühne, ohne dass ihn jemand auswählen musste.
    await expect(page.locator('[data-sheet]').getByRole('button', { name: /abhaken$/ })).toBeVisible();
  });

  test('die Reihenfolge ändert sich nur über die Pfeile', async ({ page }) => {
    await startSampleSession(page);

    // Der Griff zum Ziehen ist ersatzlos weg - er sortierte beim Scrollen
    // versehentlich um.
    await expect(page.getByRole('button', { name: /ziehen und umsortieren/ })).toHaveCount(0);

    // Die Reihenfolge der Blöcke, wie sie in der Liste steht.
    const cardOrder = async () =>
      (await page.locator('section[data-block-status]').all()).length
        ? Promise.all(
            (await page.locator('section[data-block-status]').all()).map(async (block) =>
              ((await block.getAttribute('aria-label')) ?? '').trim(),
            ),
          )
        : [];

    expect(await cardOrder()).toEqual([
      'Front Squat',
      'Bulgarian Split Squat',
      'Nordic Curl Iso',
    ]);

    await page.getByRole('button', { name: 'Front Squat nach unten' }).click();
    await page.waitForTimeout(900);

    expect(await cardOrder()).toEqual([
      'Bulgarian Split Squat',
      'Front Squat',
      'Nordic Curl Iso',
    ]);
  });
});

test.describe('Aktive Übung', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
  });

  /**
   * Name des Blocks, der gerade dran ist.
   *
   * Früher hing das am Abzeichen "Aktiv" auf der Karte. Die Liste zeigt den
   * Zustand jetzt an der Blockkarte selbst - als Attribut, nicht nur als Farbe.
   */
  async function activeExerciseName(page: Page) {
    const current = page.locator('section[data-block-status="current"]');

    return (await current.count()) ? current.first().getAttribute('aria-label') : null;
  }

  test('der Fokus wandert erst weiter, wenn alle Sätze erledigt sind', async ({ page }) => {
    await startSampleSession(page);

    expect(await activeExerciseName(page)).toBe('Front Squat');

    await openExerciseSheet(page, 'Front Squat');

    // Im Sheet liegt immer genau ein Satz groß; die Satzzeilen darunter sagen,
    // wie viele es insgesamt sind.
    const openSets = await page.getByRole('dialog').locator('[data-set-row]').count();

    expect(openSets).toBeGreaterThan(1);

    /*
     * Nach dem ersten Satz darf sich nichts bewegen. Genau hier schlägt ein
     * falsch gebauter Fokuswechsel an - und der Nutzer verliert die Übung,
     * an der er gerade arbeitet.
     */
    await completeActiveSet(page);

    expect(await activeExerciseName(page)).toBe('Front Squat');

    for (let index = 1; index < openSets; index += 1) {
      await completeActiveSet(page);
    }

    // Beim letzten Satz schließt sich das Sheet von selbst - der Block ist
    // fertig, und der nächste wird nicht ungefragt aufgerissen.
    await expect(page.getByRole('dialog')).toBeHidden();

    /*
     * Beim letzten Satz muss der Sprung kommen. Die Live-Query hinkt dem
     * gerade geschriebenen Haken hinterher; wer darauf statt auf den
     * gepatchten Stand rechnet, bleibt hier stehen.
     */
    expect(await activeExerciseName(page)).toBe('Bulgarian Split Squat');
  });
});

test.describe('Fokus-Sheet', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
  });

  test('öffnet sich nicht von selbst - erst die Liste, dann die Übung', async ({ page }) => {
    await startSampleSession(page);

    /*
     * Wer eine Einheit startet, geht zur Hantel und will den Plan sehen. Ein
     * Sheet, das man erst wegwischen muss, um die Liste zu lesen, kostet genau
     * dort einen Handgriff.
     */
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.locator('section[data-block-status]')).toHaveCount(3);
  });

  test('trägt die Sätze und lässt sich wieder schließen', async ({ page }) => {
    await startSampleSession(page);

    // In der Liste stehen keine Eingabefelder - dafür ist das Sheet da.
    await expect(page.locator('input[id$="-weight"]')).toHaveCount(0);

    await openExerciseSheet(page, 'Front Squat');
    await expect(page.locator('input[id$="-weight"]').first()).toBeVisible();

    await closeExerciseSheet(page);
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.locator('input[id$="-weight"]')).toHaveCount(0);
  });

  test('überlebt keinen Reload, die Uhren dagegen schon', async ({ page }) => {
    await startSampleSession(page);

    await startRestByCompletingSet(page, 'Front Squat');
    await expect(page.getByRole('timer')).toBeVisible();

    await openExerciseSheet(page, 'Front Squat');

    await page.reload();
    await page.waitForTimeout(1200);

    /*
     * Das offene Sheet ist reiner Oberflächenzustand und liegt deshalb im
     * ui-store, nicht in IndexedDB. Die Pause hängt dagegen an der Session -
     * sie läuft weiter und ist in der Liste weiter zu sehen.
     */
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByRole('timer')).toBeVisible();
  });

  test('genau eine Uhr spricht - im Sheet wie in der Liste', async ({ page }) => {
    await startSampleSession(page);

    await startRestByCompletingSet(page, 'Front Squat');
    await expect(page.getByRole('timer')).toHaveCount(1);

    // Die Leiste steht im Sheet im Fuß, nicht zusätzlich darunter.
    await openExerciseSheet(page, 'Front Squat');
    await expect(page.getByRole('timer')).toHaveCount(1);
  });
});

test.describe('Kopf der Einheit', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
  });

  test('der Kopf schätzt die Restzeit und läuft auch ohne Timer weiter', async ({ page }) => {
    await startSampleSession(page);

    const estimate = page.locator('[data-session-estimate]');
    const duration = page.locator('[data-session-stats] p').first();

    // Vor dem ersten Satz steht die reine Planschätzung da.
    await expect(estimate).toHaveAttribute('data-session-estimate', 'plan');
    await expect(estimate).toContainText(/~\d/);

    /*
     * Die Dauer muss ticken, obwohl weder eine Pause noch ein Satz-Timer läuft
     * - genau das tat sie vorher nicht. Die Prüfung steht deshalb *vor* dem
     * ersten Abhaken: die Pause danach würde den Takt der Seite starten und
     * den Fehler verdecken.
     */
    const before = await duration.textContent();
    await page.waitForTimeout(2500);
    expect(await duration.textContent()).not.toBe(before);

    // Drei Spalten müssen auch auf dem schmalsten iPhone nebeneinander passen.
    const clipped = await page
      .locator('[data-session-stats]')
      .evaluate((element) => element.scrollWidth > element.clientWidth + 1);
    expect(clipped).toBe(false);

    await openExerciseSheet(page, 'Front Squat');
    await completeActiveSet(page);
    await closeExerciseSheet(page);

    await expect(estimate).toContainText(/~\d/);
  });

  test('nennt neben der Restzeit die Uhrzeit, zu der die Einheit vorbei ist', async ({ page }) => {
    await startSampleSession(page);

    /*
     * "Noch 42 Minuten" ist nicht die Zahl, nach der man im Training handelt -
     * die Frage ist, ob man um 19:42 aus der Halle ist. Die Uhrzeit steht ohne
     * Tilde da: sie ist die ruhigere der beiden Angaben.
     */
    const end = page.locator('[data-session-end]');

    await expect(end).toBeVisible();
    await expect(end).toContainText('Ende');
    await expect(end).toContainText(/\d{2}:\d{2}/);
    await expect(end).toHaveAttribute('data-session-end', 'plan');

    // Der Satzzähler ist der Uhrzeit gewichen; er steht im Kopf des Sheets.
    await expect(page.locator('[data-session-stats]')).not.toContainText('Sätze');
  });

  test('trägt Restzeit und Ende auch im Sheet, ohne auf 320px überzulaufen', async ({ page }) => {
    await startSampleSession(page);
    await openExerciseSheet(page, 'Front Squat');

    const outlook = page.locator('[data-sheet] [data-session-outlook]');

    await expect(outlook).toBeVisible();
    await expect(outlook).toContainText(/noch\s*[~<]\d/);
    await expect(outlook).toContainText(/bis \d{2}:\d{2}/);

    // Der Kopf teilt sich die Breite mit dem 44px-Schließer - links wird gekürzt.
    const clipped = await page
      .locator('[data-sheet]')
      .evaluate((element) => element.scrollWidth > element.clientWidth + 1);
    expect(clipped).toBe(false);
  });
});

/*
 * Im Feld steht als Platzhalter die letzte Ausführung - genau darauf schaut
 * man im Training, und genau deshalb übersieht man das Geplante. Das Soll
 * steht deshalb in derselben Box daneben.
 */
test.describe('Das Soll in der Wertebox', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
  });

  test('steht neben dem Platzhalter und weicht sichtbar von ihm ab', async ({ page }) => {
    await startSampleSession(page);
    await openExerciseSheet(page, 'Front Squat');
    await selectSetRow(page, 'Satz 1');

    const sheet = page.locator('[data-sheet]');

    /*
     * Die Beispieldaten planen 3 × 5 Wdh à 82,5 kg und haben vor sechs Tagen
     * eine Wiederholung weniger gebracht. Der Unterschied zwischen 4 und 5 ist
     * genau das, was ohne die Soll-Angabe unsichtbar wäre.
     */
    await expect(sheet.locator('input[id$="-reps"]').first()).toHaveAttribute('placeholder', '4');
    await expect(sheet.locator('[data-set-target="reps"]')).toHaveText('(5)');
    await expect(sheet.locator('[data-set-target="weight"]')).toHaveText('(82,5)');
  });

  test('bleibt am Aufwärmsatz weg - dort schreibt der Plan nichts vor', async ({ page }) => {
    await startSampleSession(page);
    await openExerciseSheet(page, 'Front Squat');

    // Der Aufwärmsatz ist die erste offene Zeile und liegt beim Öffnen bereits
    // auf der Bühne. "3 × 5 Wdh" beschreibt die Arbeitssätze, nicht ihn.
    await expect(page.getByText('Aufwärmen', { exact: true }).first()).toBeVisible();
    await expect(page.locator('[data-set-target]')).toHaveCount(0);
  });

  test('lässt die große Zahl auf 320px mittig stehen und überlappt sie nicht', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await startSampleSession(page);
    await openExerciseSheet(page, 'Front Squat');
    await selectSetRow(page, 'Satz 1');

    /*
     * Das Soll ist absolut gesetzt, damit die große Zahl genau dort steht, wo
     * sie ohne Soll stünde - sie ist der Wert, der aus einem Meter Entfernung
     * getroffen werden muss. Geriete die Klammer zurück in den Fluss, schöbe
     * sie die Zahl aus der Mitte, und das misst dieser Test.
     */
    const geometry = await page.locator('[data-set-target]').evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.parentElement!;
        const input = box.querySelector('input')!;
        const unit = box.querySelector('label')!;
        const boxRect = box.getBoundingClientRect();
        const targetRect = element.getBoundingClientRect();

        return {
          // Wie weit die Gruppe aus Zahl und Einheit aus der Boxmitte steht.
          offset: Math.abs(
            (input.getBoundingClientRect().left + unit.getBoundingClientRect().right) / 2 -
              (boxRect.left + boxRect.width / 2),
          ),
          // Und ob die Klammer selbst noch in der Box liegt.
          inside: targetRect.left >= boxRect.left - 1 && targetRect.right <= boxRect.right + 1,
        };
      }),
    );

    expect(geometry.length).toBeGreaterThan(0);
    for (const { offset, inside } of geometry) {
      expect(offset).toBeLessThan(2);
      expect(inside).toBe(true);
    }
  });

  test('nennt das Geplante auch im Pausenmodus', async ({ page }) => {
    await startSampleSession(page);
    await openExerciseSheet(page, 'Front Squat');

    /*
     * Aufwärmen abhaken - danach wartet die Pause auf Satz 1, und der ist ein
     * Arbeitssatz mit einer Vorgabe. Der Ruhemodus bleibt dabei stehen: er ist
     * genau der Zustand, den dieser Test ansieht.
     */
    await page.locator('[data-sheet]').getByRole('button', { name: /abhaken$/ }).click();
    await page.waitForTimeout(900);

    const restMode = page.getByRole('dialog', { name: /^Pause · / });

    await expect(restMode).toBeVisible();
    /*
     * Die große Zeile ist die Vorgabe der letzten Woche - 4 Wiederholungen, wo
     * der Plan 5 sagt. Genau diese Abweichung holt das Soll auf den Schirm.
     */
    await expect(restMode.locator('[data-rest-values]')).toHaveText(/82,5\s*kg\s*×\s*4/);
    await expect(restMode.locator('[data-rest-target]')).toHaveText(/^Soll\s*5\s*Wdh$/);
  });

  /*
   * Dass die Zeile bei getroffenem Soll wieder verschwindet, entscheidet
   * `describeRepTargetDeviation` - vier Fälle in `session-summary.test.ts`,
   * Spanne eingeschlossen. Hier steht nur, dass die Entscheidung ankommt.
   */
});
