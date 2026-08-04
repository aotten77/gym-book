import { expect, test } from '@playwright/test';
import { collectPageErrors, resetDatabase, seedSampleData } from './helpers';

test.describe('Erster Start', () => {
  test('legt keine erfundenen Trainingsdaten an', async ({ page }) => {
    await resetDatabase(page);

    // Früher schrieb der Bootstrap eine fertig ausgefüllte Session "von vor
    // sechs Tagen" und einen erfundenen Asymmetrie-Test in die Datenbank.
    await page.goto('./#/exercises');
    await page.waitForTimeout(900);
    await expect(page.getByText('Noch keine Übung')).toBeVisible();

    await page.goto('./#/history');
    await page.waitForTimeout(900);
    await expect(page.getByText('Einheit A')).toBeHidden();

    await page.goto('./#/tests');
    await page.waitForTimeout(900);
    await expect(page.getByText('Noch keine Tests')).toBeVisible();
  });

  test('Beispieldaten sind nur bei leerer Bibliothek möglich', async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);

    await page.goto('./#/settings');
    await page.waitForTimeout(900);

    await expect(page.getByRole('button', { name: 'Beispieldaten laden' })).toBeDisabled();
  });
});

test.describe('Übungsbibliothek', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
  });

  test('anlegen, umbenennen und Stammdaten ändern', async ({ page }) => {
    const errors = collectPageErrors(page);

    await page.goto('./#/exercises');
    await page.waitForTimeout(800);

    await page.getByRole('button', { name: 'Anlegen' }).first().click();
    await page.getByLabel('Name').fill('Front Squat');
    await page.getByLabel('Tempo').fill('3-1-1');
    await page.getByRole('button', { name: 'Anlegen' }).last().click();
    await page.waitForTimeout(900);

    await expect(page.getByText('Front Squat').first()).toBeVisible();

    // Genau das war zuvor unmöglich: Stammdaten einer bestehenden Übung
    // ließen sich nirgends in der App ändern.
    await page.getByRole('button', { name: 'Front Squat bearbeiten' }).click();
    await page.waitForTimeout(500);
    await page.getByLabel('Name').fill('Front Squat (Pause)');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await page.waitForTimeout(900);

    await expect(page.getByText('Front Squat (Pause)').first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('das Bild wird im Anlegen-Formular gewählt, nicht danach', async ({ page }) => {
    const errors = collectPageErrors(page);

    /*
     * Bewusst ohne Speichern: WebKit unter Playwright legt überhaupt keine
     * Blobs in IndexedDB ab ("Error preparing Blob/File data to be stored in
     * object store"), auch ohne diese App. Der Weg in die Datenbank hängt
     * darum an den Unit-Tests; hier zählt, dass die Wahl samt Vorschau vor
     * dem Anlegen steht - vorher gab es sie erst an der fertigen Karte.
     */
    await page.goto('./#/exercises');
    await page.waitForTimeout(800);

    await page.getByRole('button', { name: 'Anlegen' }).first().click();
    await page.getByLabel('Name').fill('Pallof Press');

    // Ein 1x1-PNG reicht für die Vorschau.
    await page.getByLabel('Bild wählen').setInputFiles({
      name: 'pallof.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    });

    await expect(page.getByAltText('Bild von Pallof Press')).toBeVisible();

    await page.getByRole('button', { name: 'Bild entfernen' }).click();
    await expect(page.getByAltText('Bild von Pallof Press')).toBeHidden();
    await expect(page.getByLabel('Bild wählen')).toBeAttached();

    expect(errors).toEqual([]);
  });

  test('eine in einem Workout verwendete Übung wird nicht gelöscht', async ({ page }) => {
    await seedSampleData(page);
    await page.goto('./#/exercises');
    await page.waitForTimeout(1000);

    // Sonst würde materializeSession werfen und das Workout wäre für immer
    // unbrauchbar - auffallen würde das erst Wochen später im Gym.
    await page.getByRole('button', { name: /Front Squat löschen/ }).first().click();
    await page.waitForTimeout(700);

    await expect(page.getByText('Löschen nicht möglich')).toBeVisible();
  });

  test('zeigt einen Verlauf mit echten Datenpunkten', async ({ page }) => {
    await seedSampleData(page);
    await page.goto('./#/exercises');
    await page.waitForTimeout(1000);

    await page.getByRole('button', { name: 'Verlauf anzeigen' }).first().click();
    await page.waitForTimeout(1000);

    const chart = page.locator('svg[role=img]').first();
    await expect(chart).toBeVisible();

    // Das Diagramm muss für Screenreader eine Aussage tragen, nicht nur Pixel.
    const label = await chart.getAttribute('aria-label');
    expect(label).toMatch(/Gewicht|Sekunden/);

    const marks = await page.evaluate(() => {
      const svg = document.querySelector('svg[role=img]');
      return {
        points: svg?.querySelectorAll('circle').length ?? 0,
        hasLine: Boolean(svg?.querySelector('path[stroke]')),
      };
    });

    expect(marks.points).toBeGreaterThan(0);
    expect(marks.hasLine).toBe(true);
  });
});

test.describe('Test-Erfassung', () => {
  test('erfassen, Asymmetrie berechnen und wieder löschen', async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);

    await page.goto('./#/tests');
    await page.waitForTimeout(900);

    await page.getByRole('button', { name: 'Erfassen' }).click();
    await page.getByLabel('Links').fill('30');
    await page.getByLabel('Rechts').fill('40');
    await page.waitForTimeout(400);

    // Die Kennzahl soll vor dem Speichern nachvollziehbar sein.
    await expect(page.getByText('Asymmetrie:')).toBeVisible();

    await page.getByRole('button', { name: 'Speichern' }).click();
    await page.waitForTimeout(1000);
    // Der Wert erscheint sowohl in der Vorschau als auch in der Ergebniskarte.
    await expect(page.getByText('25%').first()).toBeVisible();

    await page.getByRole('button', { name: /Test vom/ }).first().click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Löschen' }).click();
    await page.waitForTimeout(900);

    // Der Beispieldatensatz enthält selbst einen Test - geprüft wird also,
    // dass genau der eben erfasste verschwunden ist.
    await expect(page.getByText('25%')).toBeHidden();
  });

  test('erfasster Test erscheint auch in der Übungsansicht', async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);

    // loadTestsForExercise existierte schon vorher, wurde aber nirgends
    // aufgerufen - Tests waren nur über /tests auffindbar.
    await page.goto('./#/tests');
    await page.waitForTimeout(900);

    await page.getByRole('button', { name: 'Erfassen' }).click();
    await page.getByLabel('Links').fill('12');
    await page.getByLabel('Rechts').fill('15');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await page.waitForTimeout(900);

    await page.goto('./#/exercises');
    await page.waitForTimeout(900);
    // Test und Formular defaulten beide auf die alphabetisch erste Übung.
    await page.getByRole('button', { name: 'Verlauf anzeigen' }).first().click();
    await page.waitForTimeout(500);

    await expect(page.getByText('Links 12 · Rechts 15 · Asymmetrie 20%')).toBeVisible();
  });
});

test.describe('Workouts', () => {
  test('Übung zum Workout nur über Auswahl aus der Bibliothek hinzufügen', async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);

    await page.goto('./#/templates');
    await page.waitForTimeout(900);
    await page.getByRole('link', { name: 'Bearbeiten' }).first().click();
    await page.waitForTimeout(900);

    // Die Form liegt seit dem Umbau im Sheet über der Liste, nicht mehr als
    // Abschnitt am Seitenende - erst öffnen, dann prüfen.
    await page.getByRole('button', { name: 'Hinzufügen' }).click();
    await page.waitForTimeout(500);

    // Der "Bestehend"/"Neu"-Toggle samt Neuanlage-Formular ist mit der
    // Bibliothek überflüssig geworden - nur noch Auswahl.
    const addExerciseSheet = page.getByRole('dialog', { name: 'Übung hinzufügen' });
    await expect(addExerciseSheet).toBeVisible();
    await expect(page.getByRole('button', { name: 'Neue Übung' })).toHaveCount(0);
    await expect(addExerciseSheet.locator('select')).toHaveCount(1);

    await addExerciseSheet.locator('select').selectOption({ label: 'Nordic Curl Iso' });
    await page.waitForTimeout(400);

    // Vorschau-Absatz statt der <option> - sonst matcht auch der Select selbst.
    await expect(addExerciseSheet.getByRole('paragraph').filter({ hasText: 'Nordic Curl Iso' })).toBeVisible();
  });

  test('Bearbeiten öffnet das Sheet über der Liste, statt ans Seitenende zu scrollen', async ({
    page,
  }) => {
    await resetDatabase(page);
    await seedSampleData(page);

    await page.goto('./#/templates');
    await page.waitForTimeout(900);
    await page.getByRole('link', { name: 'Bearbeiten' }).first().click();
    await page.waitForTimeout(900);

    // Erst in Sicht bringen, dann messen: sonst misst der Test das
    // Heranscrollen von Playwright und nicht das der Anwendung.
    const editButton = page.getByRole('button', { name: 'Front Squat bearbeiten' });
    await editButton.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const scrollBefore = await page.evaluate(() => window.scrollY);

    await editButton.click();
    await page.waitForTimeout(500);

    const sheet = page.getByRole('dialog', { name: 'Übung bearbeiten' });
    await expect(sheet).toBeVisible();
    // Die Übung steht im Kopf, damit man weiß, was man bearbeitet.
    await expect(sheet.getByText('Front Squat').first()).toBeVisible();

    // Die Liste darunter wurde nicht bewegt - genau das war der Grund für das
    // Sheet: schließen bringt einen an dieselbe Stelle zurück.
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

    await sheet.getByRole('button', { name: 'Bearbeiten schließen' }).click();
    await page.waitForTimeout(400);

    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  });
});

test.describe('Destruktive Aktionen', () => {
  test('fragen über einen Dialog nach statt über window.confirm', async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);

    await page.goto('./#/templates');
    await page.waitForTimeout(900);
    await page.getByRole('link', { name: 'Bearbeiten' }).first().click();
    await page.waitForTimeout(900);

    await page.getByRole('button', { name: 'Löschen' }).first().click();
    await page.waitForTimeout(500);

    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('bleiben im Verlauf erhalten');

    await page.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(dialog).toBeHidden();
  });
});

test.describe('Sicherung', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
  });

  test('erinnert an ungesicherte Trainings und merkt sich die Sicherung', async ({ page }) => {
    await seedSampleData(page);
    await page.goto('./');
    await page.waitForTimeout(800);

    // Die Beispieldaten bringen ein abgeschlossenes Training mit - und es gibt
    // noch keine Sicherung.
    await expect(page.getByText(/nicht gesichert/)).toBeVisible();

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Jetzt sichern' }).click();
    await download;
    await page.waitForTimeout(900);

    await expect(page.getByText(/nicht gesichert/)).toBeHidden();

    // Der Zeitpunkt liegt in IndexedDB, überlebt also einen Neustart.
    await page.reload();
    await page.waitForTimeout(1000);
    await expect(page.getByText(/nicht gesichert/)).toBeHidden();
  });
});
