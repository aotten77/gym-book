import { expect, test, type Page } from '@playwright/test';
import {
  collectPageErrors,
  completeActiveSet,
  closeExerciseSheet,
  openExerciseSheet,
  resetDatabase,
  seedSampleData,
} from './helpers';

/*
 * Termine im Programm-Tab. Das Startdatum liegt auf dem Montag dieser Woche,
 * damit "heute" in Programmwoche 1 liegt und die Terminliste genau diese
 * Woche zeigt.
 */
/** Ein lokaler Tag als `YYYY-MM-DD`, `offsetDays` von heute aus, im Browser gerechnet. */
async function localDay(page: Page, offsetDays = 0, mondayOfWeek = false) {
  return page.evaluate(
    ({ offset, monday }) => {
      const now = new Date();

      if (monday) {
        now.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      }

      now.setDate(now.getDate() + offset);

      const month = `${now.getMonth() + 1}`.padStart(2, '0');
      const day = `${now.getDate()}`.padStart(2, '0');

      return `${now.getFullYear()}-${month}-${day}`;
    },
    { offset: offsetDays, monday: mondayOfWeek },
  );
}

async function setProgramStart(page: Page, date: string) {
  await page.goto('./#/settings');
  await page.waitForTimeout(1200);
  await page.getByLabel('Programmstart').fill(date);
  await page.waitForTimeout(900);

  await page.goto('./#/programs');
  await page.waitForTimeout(1200);
}

async function setStartToThisMonday(page: Page) {
  await setProgramStart(page, await localDay(page, 0, true));
}

/*
 * Die Beispieldaten bringen Termine für Einheit A mit. Diese Tests gehen von
 * einem leeren Plan aus, also räumen sie ihn vorher leer.
 */
async function clearPlanEntries(page: Page) {
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

async function addRun(page: Page, title: string, extra?: { distance?: string; pace?: string }) {
  await page.getByRole('button', { name: 'Termin hinzufügen' }).click();

  const sheet = page.locator('[data-sheet]');
  await sheet.getByRole('button', { name: 'Lauf', exact: true }).click();
  await sheet.getByLabel('Titel').fill(title);

  if (extra?.distance) {
    await sheet.getByLabel('Strecke (km)').fill(extra.distance);
  }

  if (extra?.pace) {
    await sheet.getByLabel('Pace (m:ss pro km)').fill(extra.pace);
  }

  await sheet.getByRole('button', { name: 'Termin speichern' }).click();
}

test.describe('Termine im Programm-Tab', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
    await clearPlanEntries(page);
    await setStartToThisMonday(page);
  });

  test('legt einen Lauf-Termin an und zeigt die Vorgabe', async ({ page }) => {
    const errors = collectPageErrors(page);

    await expect(page.getByText('Keine Termine in dieser Woche')).toBeVisible();

    await addRun(page, 'Intervalle 6×400', { distance: '7', pace: '5:00' });

    const entry = page.locator('[data-plan-entry]').filter({ hasText: 'Intervalle 6×400' });
    await expect(entry).toBeVisible();
    await expect(entry).toContainText('7 km · 5:00 /km');
    await expect(entry).toHaveAttribute('data-plan-entry-state', 'offen');
    await expect(page.locator('[data-plan-week]')).toHaveCount(1);

    expect(errors).toEqual([]);
  });

  test('Serie legt Termine an und meldet Duplikate', async ({ page }) => {
    const errors = collectPageErrors(page);

    const today = await localDay(page);
    const monday = await localDay(page, 0, true);

    async function createSeries() {
      const sheet = page.locator('[data-sheet]');

      // Vorgabe ist heute, nicht der Montag - sonst lägen Termine in der Vergangenheit.
      await expect(sheet.getByLabel('Startdatum')).toHaveValue(today);

      await sheet.getByLabel('Workout', { exact: true }).selectOption({ label: 'Einheit A' });
      await sheet.getByRole('button', { name: 'Montag' }).click();
      await sheet.getByRole('button', { name: 'Donnerstag' }).click();
      // Ab Montag dieser Woche, damit es an jedem Wochentag genau vier sind.
      await sheet.getByLabel('Startdatum').fill(monday);
      await sheet.getByLabel('Wochen', { exact: true }).fill('2');
      await sheet.getByRole('button', { name: 'Serie anlegen' }).click();
      await page.waitForTimeout(600);
    }

    await page.getByRole('button', { name: 'Serie anlegen' }).click();
    await createSeries();
    await expect(page.locator('[data-sheet]').getByRole('status')).toHaveText(
      '4 angelegt, 0 gab es schon',
    );

    // Zweiter Durchlauf: Wochentage und Startdatum stehen noch, nur die Meldung ändert sich.
    await page.locator('[data-sheet]').getByLabel('Wochen', { exact: true }).fill('2');
    await page.locator('[data-sheet]').getByRole('button', { name: 'Serie anlegen' }).click();
    await expect(page.locator('[data-sheet]').getByRole('status')).toHaveText(
      '0 angelegt, 4 gab es schon',
    );

    expect(errors).toEqual([]);
  });

  test('Doppelter Termin zeigt die Meldung', async ({ page }) => {
    const errors = collectPageErrors(page);

    await addRun(page, 'Dauerlauf');
    await expect(page.locator('[data-plan-entry]').filter({ hasText: 'Dauerlauf' })).toBeVisible();

    await addRun(page, 'Dauerlauf');
    await expect(page.locator('[data-sheet]').getByRole('alert')).toContainText('schon im Plan');

    expect(errors).toEqual([]);
  });

  test('zeigt den Fehler einer Dauer von 0', async ({ page }) => {
    await page.getByRole('button', { name: 'Termin hinzufügen' }).click();

    const sheet = page.locator('[data-sheet]');
    await sheet.getByRole('button', { name: 'Lauf', exact: true }).click();
    await sheet.getByLabel('Titel').fill('Dauerlauf');
    await sheet.getByLabel('Min', { exact: true }).fill('0');
    await sheet.getByLabel('Sek', { exact: true }).fill('0');
    await sheet.getByLabel('Sek', { exact: true }).blur();

    await expect(sheet.getByRole('alert')).toHaveText('Dauer bitte über 0.');
    await expect(sheet.getByRole('button', { name: 'Termin speichern' })).toBeDisabled();
  });

  test('ein laufender Termin führt in die laufende Session', async ({ page }) => {
    const errors = collectPageErrors(page);

    await page.getByRole('button', { name: 'Termin hinzufügen' }).click();
    const entrySheet = page.locator('[data-sheet]');
    await entrySheet.getByLabel('Workout', { exact: true }).selectOption({ label: 'Einheit A' });
    await entrySheet.getByRole('button', { name: 'Termin speichern' }).click();
    await expect(entrySheet).toHaveCount(0);

    await page.goto('./');
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: /Heute · Einheit A/ }).click();
    await page.waitForURL(/#\/session\//);
    const sessionUrl = page.url();

    await page.goto('./#/programs');
    await page.waitForTimeout(1000);
    const entry = page.locator('[data-plan-entry]').filter({ hasText: 'Einheit A' });
    await expect(entry).toHaveAttribute('data-plan-entry-state', 'belegt');
    await entry.getByRole('button').first().click();

    const sheet = page.locator('[data-sheet]');
    await expect(sheet).toContainText('Läuft gerade');
    // Ein belegter Termin zeigt nie das Formular, auch nicht kurz.
    await expect(sheet.getByRole('button', { name: 'Termin speichern' })).toHaveCount(0);
    await sheet.getByRole('link', { name: 'Zur Session' }).click();
    await page.waitForURL(/#\/session\//);
    expect(page.url()).toBe(sessionUrl);

    expect(errors).toEqual([]);
  });

  test('passt bei 320px', async ({ page }) => {
    const errors = collectPageErrors(page);

    await page.setViewportSize({ width: 320, height: 700 });
    await addRun(page, 'Ein sehr langer Titel für einen Lauf am Wochenende im Wald', {
      distance: '12,5',
      pace: '5:30',
    });
    await expect(page.locator('[data-plan-entry]')).toHaveCount(1);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    expect(errors).toEqual([]);
  });

  test('Home startet den heutigen Termin und markiert ihn erledigt', async ({ page }) => {
    const errors = collectPageErrors(page);

    await page.getByRole('button', { name: 'Termin hinzufügen' }).click();
    const sheet = page.locator('[data-sheet]');
    await sheet.getByLabel('Workout', { exact: true }).selectOption({ label: 'Einheit A' });
    await sheet.getByRole('button', { name: 'Termin speichern' }).click();
    await expect(page.locator('[data-plan-entry]').filter({ hasText: 'Einheit A' })).toHaveAttribute(
      'data-plan-entry-state',
      'offen',
    );

    await page.goto('./');
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: /Heute · Einheit A/ }).click();
    await page.waitForURL(/#\/session\//);
    await page.waitForTimeout(600);

    await openExerciseSheet(page);
    await completeActiveSet(page);
    await closeExerciseSheet(page);
    await page.getByRole('button', { name: 'Session abschließen' }).first().click();
    await page.waitForTimeout(1500);

    await page.goto('./#/programs');
    await page.waitForTimeout(1000);
    await expect(
      page.locator('[data-plan-entry]').filter({ hasText: 'Einheit A' }),
    ).toHaveAttribute('data-plan-entry-state', 'erledigt');

    expect(errors).toEqual([]);
  });

  test('ohne Termine bleibt Am längsten her', async ({ page }) => {
    await page.goto('./');
    await page.waitForTimeout(800);

    await expect(page.getByText('Am längsten her')).toBeVisible();
    await expect(page.getByText('Nächster Termin')).toHaveCount(0);
  });

  test('an einem Tag ohne Termin bleibt jedes Workout startbar', async ({ page }) => {
    // Heute ist nichts geplant, der nächste Termin liegt morgen.
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const iso = (date: Date) =>
            `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          const open = indexedDB.open('gym-book-db');

          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const database = open.result;
            const tx = database.transaction(['planEntries', 'workoutTemplates'], 'readwrite');
            const templates = tx.objectStore('workoutTemplates').getAll();

            templates.onsuccess = () => {
              const stamp = new Date().toISOString();

              tx.objectStore('planEntries').add({
                id: 'morgen',
                date: iso(tomorrow),
                kind: 'workout',
                templateId: templates.result[0].id,
                orderInDay: 1,
                createdAt: stamp,
                updatedAt: stamp,
              });
            };
            tx.oncomplete = () => {
              database.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        }),
    );

    await page.goto('./');
    await page.waitForTimeout(800);

    await expect(page.getByText(/Nächster Termin/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Einheit A/ })).toBeVisible();
  });
});

test.describe('Terminliste außerhalb der Programmspanne', () => {
  test('ein abgelaufenes Programm blättert frei ab dieser Woche', async ({ page }) => {
    const errors = collectPageErrors(page);

    await resetDatabase(page);
    await seedSampleData(page);
    // Acht Programmwochen ab Januar 2020 sind lange vorbei.
    await setProgramStart(page, '2020-01-06');

    const week = page.locator('[data-plan-week]');
    await expect(week).toHaveAttribute('data-plan-week', await localDay(page, 0, true));
    await expect(page.getByRole('button', { name: 'Vorherige Woche' })).toBeVisible();

    await page.getByRole('button', { name: 'Nächste Woche' }).click();
    await expect(week).toHaveAttribute('data-plan-week', await localDay(page, 7, true));

    expect(errors).toEqual([]);
  });
});

/** Setzt `scheduledWeekdays` am Workout „Einheit A“ - so, wie es vor den Terminen gespeichert war. */
async function setLegacyWeekdays(page: Page, weekdays: number[]) {
  await page.evaluate(
    (days) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('gym-book-db');

        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          const tx = database.transaction('workoutTemplates', 'readwrite');
          const store = tx.objectStore('workoutTemplates');
          const all = store.getAll();

          all.onsuccess = () => {
            for (const template of all.result) {
              if (template.name === 'Einheit A') {
                store.put({ ...template, scheduledWeekdays: days });
              }
            }
          };
          tx.oncomplete = () => {
            database.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    weekdays,
  );
}

async function todayIsoWeekday(page: Page) {
  return page.evaluate(() => ((new Date().getDay() + 6) % 7) + 1);
}

test.describe('Wochentage in Termine umwandeln', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
    await clearPlanEntries(page);
    await setLegacyWeekdays(page, [await todayIsoWeekday(page)]);
  });

  test('wandelt bis zum Programmende um und ist danach erledigt', async ({ page }) => {
    const errors = collectPageErrors(page);
    const today = await localDay(page);

    await setStartToThisMonday(page);

    // Vor der Umwandlung weist der Programm-Tab darauf hin - neutral, mit Weg in die Einstellungen.
    const hint = page.locator('[data-plan-weekday-hint]');
    await expect(hint).toContainText('Feste Wochentage noch nicht umgewandelt');
    await hint.click();
    await expect(page).toHaveURL(/#\/settings/);
    await page.waitForTimeout(800);

    const convert = page.getByRole('button', { name: 'Wochentage umwandeln' });
    await expect(convert).toBeEnabled();
    await convert.click();

    const dialog = page.locator('[role="dialog"], [role="alertdialog"]');
    // Acht Programmwochen ab diesem Montag, je einmal der heutige Wochentag.
    await expect(dialog).toContainText('8 Termine');
    await expect(dialog.getByLabel('Für wie viele Wochen?')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Umwandeln' }).click();

    await expect(page.getByRole('status').filter({ hasText: 'angelegt' })).toHaveText(
      '8 Termine angelegt.',
    );
    const card = page
      .locator('div')
      .filter({ has: page.getByText('Wochentage in Termine umwandeln', { exact: true }) })
      .last();
    await expect(card).toContainText('Nichts zu tun.');
    await expect(convert).toBeDisabled();

    await page.goto('./#/programs');
    await page.waitForTimeout(1000);
    await expect(
      page.locator(`[data-plan-day="${today}"] [data-plan-entry]`).filter({ hasText: 'Einheit A' }),
    ).toHaveCount(1);
    await expect(page.locator('[data-plan-weekday-hint]')).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test('fragt ohne Startdatum nach der Zahl der Wochen', async ({ page }) => {
    const errors = collectPageErrors(page);
    const today = await localDay(page);

    await page.goto('./#/settings');
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: 'Wochentage umwandeln' }).click();

    const dialog = page.locator('[role="dialog"], [role="alertdialog"]');
    const weeks = dialog.getByLabel('Für wie viele Wochen?');
    await expect(weeks).toBeVisible();
    await weeks.fill('1');
    await expect(dialog).toContainText('1 Termin von');
    await dialog.getByRole('button', { name: 'Umwandeln' }).click();

    await expect(page.getByRole('status').filter({ hasText: 'angelegt' })).toHaveText(
      '1 Termin angelegt.',
    );
    await expect(page.getByRole('button', { name: 'Wochentage umwandeln' })).toBeDisabled();

    await page.goto('./#/programs');
    await page.waitForTimeout(1000);
    await expect(
      page.locator(`[data-plan-day="${today}"] [data-plan-entry]`).filter({ hasText: 'Einheit A' }),
    ).toHaveCount(1);

    expect(errors).toEqual([]);
  });
});
