import { expect, test, type Page } from '@playwright/test';
import { collectPageErrors, resetDatabase, seedSampleData, startSampleSession } from './helpers';

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

    // Number("52,5") ergibt NaN. Früher wurde daraus `undefined`, und Dexies
    // Table.update löscht damit die Property - der Wert war weg.
    await page.locator('input[id$="-weight"]').first().fill('82,5');
    await page.locator('input[id$="-reps"]').first().fill('5');
    await page.waitForTimeout(1200); // Autosave abwarten

    await page.reload();
    await page.waitForTimeout(1200);

    await expect(page.locator('input[id$="-weight"]').first()).toHaveValue('82.5');
    await expect(page.locator('input[id$="-reps"]').first()).toHaveValue('5');
  });

  test('eine ungültige Eingabe lässt den gespeicherten Wert unangetastet', async ({ page }) => {
    await startSampleSession(page);

    const weight = page.locator('input[id$="-weight"]').first();
    await weight.fill('82,5');
    await page.waitForTimeout(1200);

    await weight.fill('abc');
    await page.waitForTimeout(1000);
    await expect(page.getByRole('alert').first()).toBeVisible();

    await page.reload();
    await page.waitForTimeout(1200);

    await expect(page.locator('input[id$="-weight"]').first()).toHaveValue('82.5');
  });

  test('das Speichern eines Feldes überschreibt nicht das Nachbarfeld', async ({ page }) => {
    await startSampleSession(page);

    // Genau hier lag ein Fehler, den alle Unit-Tests passierten: der Sync aus
    // der Live-Query warf den gerade getippten Wert im Nachbarfeld weg.
    await page.locator('input[id$="-weight"]').first().fill('60');
    await page.locator('input[id$="-reps"]').first().fill('8');
    await page.waitForTimeout(1400);
    await page.reload();
    await page.waitForTimeout(1200);

    await expect(page.locator('input[id$="-weight"]').first()).toHaveValue('60');
    await expect(page.locator('input[id$="-reps"]').first()).toHaveValue('8');
  });
});

test.describe('Pausentimer', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
  });

  test('läuft nach einem Reload weiter', async ({ page }) => {
    await startSampleSession(page);

    await page.getByRole('button', { name: /Pause starten/ }).click();
    await expect(page.getByRole('timer')).toBeVisible();

    // Der Vertrag verlangt "recoverable after backgrounding or reload" -
    // deshalb liegt die Deadline in IndexedDB, nicht im UI-Store.
    await page.reload();
    await page.waitForTimeout(1200);

    await expect(page.getByRole('timer')).toBeVisible();
  });

  test('lässt sich abbrechen', async ({ page }) => {
    await startSampleSession(page);

    await page.getByRole('button', { name: /Pause starten/ }).click();
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

    await page.getByRole('button', { name: 'Übung hinzufügen' }).click();
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
    await page.getByRole('button', { name: 'Session abbrechen' }).click();
    await page.waitForURL(/#\/$/);
    await page.waitForTimeout(800);

    await expect(page.getByText('Ein Training läuft bereits')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Einheit A' }).first()).toBeEnabled();
    expect(errors).toEqual([]);
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

    const weight = page.locator('input[id$="-weight"]').first();
    const placeholder = await weight.getAttribute('placeholder');

    expect(placeholder).toBeTruthy();
    await expect(weight).toHaveValue('');

    await page.getByRole('button', { name: 'Satz als erledigt markieren' }).first().click();
    await page.waitForTimeout(900);

    // Ohne Eingabe abgehakt: der Platzhalter wird zum gespeicherten Wert und
    // überlebt einen Reload.
    await page.reload();
    await page.waitForTimeout(1200);

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

    const warmupRemove = page.getByRole('button', { name: 'Warmup entfernen' }).first();
    const countBefore = await page.getByRole('button', { name: /entfernen$/ }).count();

    await warmupRemove.click();
    await page.waitForTimeout(900);

    expect(await page.getByRole('button', { name: /entfernen$/ }).count()).toBe(countBefore - 1);
  });

  test('die Reihenfolge ändert sich nur über die Pfeile', async ({ page }) => {
    await startSampleSession(page);

    // Der Griff zum Ziehen ist ersatzlos weg - er sortierte beim Scrollen
    // versehentlich um.
    await expect(page.getByRole('button', { name: /ziehen und umsortieren/ })).toHaveCount(0);

    // Nur die Übungskarten, nicht die Übersicht darüber: die trägt den
    // Namen der fokussierten Übung als eigene Überschrift.
    const cardOrder = async () =>
      (
        await page.locator('section:has(> div button[aria-label$="nach unten"]) h2').allTextContents()
      ).map((text) => text.trim());

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

  /** Name der Karte, die gerade das "Aktiv"-Abzeichen trägt. */
  async function activeExerciseName(page: Page) {
    return page.evaluate(() => {
      const chip = [...document.querySelectorAll('span')].find(
        (element) => element.textContent?.trim() === 'Aktiv',
      );

      return chip?.closest('section')?.querySelector('h2')?.textContent?.trim() ?? null;
    });
  }

  test('der Fokus wandert erst weiter, wenn alle Sätze erledigt sind', async ({ page }) => {
    await startSampleSession(page);

    expect(await activeExerciseName(page)).toBe('Front Squat');

    const openSets = await page
      .locator('section', { has: page.getByRole('button', { name: 'Front Squat nach unten' }) })
      .getByRole('button', { name: 'Satz als erledigt markieren' })
      .count();

    expect(openSets).toBeGreaterThan(1);

    /*
     * Nach dem ersten Satz darf sich nichts bewegen. Genau hier schlägt ein
     * falsch gebauter Fokuswechsel an - und der Nutzer verliert die Übung,
     * an der er gerade arbeitet.
     */
    await page.getByRole('button', { name: 'Satz als erledigt markieren' }).first().click();
    await page.waitForTimeout(800);

    expect(await activeExerciseName(page)).toBe('Front Squat');

    for (let index = 1; index < openSets; index += 1) {
      await page.getByRole('button', { name: 'Satz als erledigt markieren' }).first().click();
      await page.waitForTimeout(700);
    }

    /*
     * Beim letzten Satz muss der Sprung kommen. Die Live-Query hinkt dem
     * gerade geschriebenen Haken hinterher; wer darauf statt auf den
     * gepatchten Stand rechnet, bleibt hier stehen.
     */
    expect(await activeExerciseName(page)).toBe('Bulgarian Split Squat');
  });

  test('der Pausen-Start aus der Leiste bewegt den Fokus nicht', async ({ page }) => {
    await startSampleSession(page);

    await page.getByRole('button', { name: /Pause starten/ }).click();
    await page.waitForTimeout(800);

    await expect(page.getByRole('timer')).toBeVisible();
    expect(await activeExerciseName(page)).toBe('Front Squat');
  });
});

test.describe('Übungsbild', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
  });

  test('der Streifen bleibt beim Scrollen zum letzten Satz sichtbar', async ({ page }) => {
    await startSampleSession(page);

    const strip = page.getByText('Kein Bild hinterlegt').first();
    await expect(strip).toBeVisible();

    // mouse.wheel gibt es im mobilen WebKit nicht - hier zählt ohnehin, was
    // ein echtes Scrollen des Dokuments bewirkt.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(600);

    // Sticky: welche Übung dran ist, muss auch beim letzten Satz noch
    // sichtbar sein.
    await expect(strip).toBeInViewport();
  });
});
