import { expect, test, type Page } from '@playwright/test';
import {
  collectPageErrors,
  completeActiveSet,
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

    await expect(page.locator('input[id$="-weight"]').first()).toHaveValue('82.5');
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

    await expect(page.locator('input[id$="-weight"]').first()).toHaveValue('82.5');
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

  /** Die Start-Taste des ersten Satzes der Zeitübung im Beispielprogramm. */
  function startButton(page: Page) {
    return page.getByRole('button', { name: /starten$/ }).first();
  }

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
});
