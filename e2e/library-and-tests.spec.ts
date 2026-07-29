import { expect, test } from '@playwright/test';
import { collectPageErrors, resetDatabase, seedSampleData } from './helpers';

test.describe('Erster Start', () => {
  test('legt keine erfundenen Trainingsdaten an', async ({ page }) => {
    await resetDatabase(page);

    // Frueher schrieb der Bootstrap eine fertig ausgefuellte Session "von vor
    // sechs Tagen" und einen erfundenen Asymmetrie-Test in die Datenbank.
    await page.goto('./#/exercises');
    await page.waitForTimeout(900);
    await expect(page.getByText('Noch keine Uebung')).toBeVisible();

    await page.goto('./#/history');
    await page.waitForTimeout(900);
    await expect(page.getByText('Einheit A')).toBeHidden();

    await page.goto('./#/tests');
    await page.waitForTimeout(900);
    await expect(page.getByText('Noch keine Tests')).toBeVisible();
  });

  test('Beispieldaten sind nur bei leerer Bibliothek moeglich', async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);

    await page.goto('./#/settings');
    await page.waitForTimeout(900);

    await expect(page.getByRole('button', { name: 'Beispieldaten laden' })).toBeDisabled();
  });
});

test.describe('Uebungsbibliothek', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
  });

  test('anlegen, umbenennen und Stammdaten aendern', async ({ page }) => {
    const errors = collectPageErrors(page);

    await page.goto('./#/exercises');
    await page.waitForTimeout(800);

    await page.getByRole('button', { name: 'Anlegen' }).first().click();
    await page.getByLabel('Name').fill('Front Squat');
    await page.getByLabel('Tempo').fill('3-1-1');
    await page.getByRole('button', { name: 'Anlegen' }).last().click();
    await page.waitForTimeout(900);

    await expect(page.getByText('Front Squat').first()).toBeVisible();

    // Genau das war zuvor unmoeglich: Stammdaten einer bestehenden Uebung
    // liessen sich nirgends in der App aendern.
    await page.getByRole('button', { name: 'Front Squat bearbeiten' }).click();
    await page.waitForTimeout(500);
    await page.getByLabel('Name').fill('Front Squat (Pause)');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await page.waitForTimeout(900);

    await expect(page.getByText('Front Squat (Pause)').first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('eine in einer Vorlage verwendete Uebung wird nicht geloescht', async ({ page }) => {
    await seedSampleData(page);
    await page.goto('./#/exercises');
    await page.waitForTimeout(1000);

    // Sonst wuerde materializeSession werfen und die Vorlage waere fuer immer
    // unbrauchbar - auffallen wuerde das erst Wochen spaeter im Gym.
    await page.getByRole('button', { name: /Front Squat loeschen/ }).first().click();
    await page.waitForTimeout(700);

    await expect(page.getByText('Loeschen nicht moeglich')).toBeVisible();
  });

  test('zeigt einen Verlauf mit echten Datenpunkten', async ({ page }) => {
    await seedSampleData(page);
    await page.goto('./#/exercises');
    await page.waitForTimeout(1000);

    await page.getByRole('button', { name: 'Verlauf anzeigen' }).first().click();
    await page.waitForTimeout(1000);

    const chart = page.locator('svg[role=img]').first();
    await expect(chart).toBeVisible();

    // Das Diagramm muss fuer Screenreader eine Aussage tragen, nicht nur Pixel.
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
  test('erfassen, Asymmetrie berechnen und wieder loeschen', async ({ page }) => {
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
    await dialog.getByRole('button', { name: 'Loeschen' }).click();
    await page.waitForTimeout(900);

    // Der Beispieldatensatz enthaelt selbst einen Test - geprueft wird also,
    // dass genau der eben erfasste verschwunden ist.
    await expect(page.getByText('25%')).toBeHidden();
  });
});

test.describe('Destruktive Aktionen', () => {
  test('fragen ueber einen Dialog nach statt ueber window.confirm', async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);

    await page.goto('./#/templates');
    await page.waitForTimeout(900);
    await page.getByRole('link', { name: 'Bearbeiten' }).first().click();
    await page.waitForTimeout(900);

    await page.getByRole('button', { name: 'Loeschen' }).first().click();
    await page.waitForTimeout(500);

    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Sessions bleiben');

    await page.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(dialog).toBeHidden();
  });
});
