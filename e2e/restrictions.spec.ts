import { expect, test, type Page } from '@playwright/test';
import {
  closeExerciseSheet,
  collectPageErrors,
  completeActiveSet,
  openExerciseSheet,
  resetDatabase,
  seedSampleData,
  selectSetRow,
  tapNowSheetWorkout,
} from './helpers';

/*
 * Einschränkungen in der Kraft-Einheit, Daten über den echten Import auf
 * `/sync`. Die Regeln selbst prüfen `domain/restriction.test.ts` und
 * `domain/session.test.ts`; hier geht es darum, was man im Training sieht und
 * bedient. Alle Namen sind erfunden.
 */

function localDay(offsetDays: number) {
  const date = new Date();

  date.setDate(date.getDate() + offsetDays);

  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return { iso: `${date.getFullYear()}-${month}-${day}`, label: `${day}.${month}.` };
}

const UNTIL = localDay(13);

const PAYLOAD = JSON.stringify({
  schemaVersion: 1,
  exercises: [{ name: 'Step-up', trackingMode: 'reps_weight', unilateral: false }],
  restrictions: [
    {
      name: 'Beispiel A',
      reason: 'Erfundener Grund für den Test',
      from: localDay(0).iso,
      until: UNTIL.iso,
      pauses: [
        {
          exercise: 'Front Squat',
          replacement: { exercise: 'Step-up', workSetCount: 2, targetReps: 8 },
        },
      ],
      adjustments: [
        { exercise: 'Bulgarian Split Squat', targetWeight: 20, note: 'nur bis Parallel' },
      ],
    },
  ],
});

async function importRestrictions(page: Page) {
  await page.goto('./#/sync');
  await page.waitForTimeout(600);
  await page.getByLabel('Oder JSON einfügen').fill(PAYLOAD);
  await page.getByRole('button', { name: 'Vorschau erzeugen' }).click();
  await page.getByRole('button', { name: 'Import bestätigen' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Eingespielt' })).toBeVisible();
}

async function startSession(page: Page) {
  await page.goto('./');
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Jetzt trainieren' }).click();
  await tapNowSheetWorkout(page, 'Einheit A');
  await page.waitForURL(/#\/session\//);
  await expect(page.locator('[data-sheet]')).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );

  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('Einschränkungen in der Kraft-Einheit', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
    await importRestrictions(page);
  });

  test('zeigt Pause, Ersatz und Anpassung an ihrem Platz und springt über die Pause', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await startSession(page);

    // Der Start öffnet das Sheet auf der ersten offenen Übung - dem Ersatz,
    // nicht der pausierten Übung davor.
    await expect(page.getByRole('dialog', { name: 'Step-up' })).toBeVisible();
    await closeExerciseSheet(page);

    const sections = page.locator('section[aria-label]');

    await expect(sections.nth(0)).toHaveAttribute('aria-label', 'Front Squat');
    await expect(sections.nth(1)).toHaveAttribute('aria-label', 'Step-up');

    const paused = sections.nth(0).locator('[data-restriction-kind="pausiert"]');

    await expect(paused).toContainText(`Pausiert bis ${UNTIL.label} · Beispiel A`);
    await expect(sections.nth(1).locator('[data-restriction-kind="ersatz"]')).toContainText(
      'Ersatz für Front Squat · Beispiel A',
    );

    const adjusted = page
      .locator('section[aria-label="Bulgarian Split Squat"]')
      .locator('[data-restriction-kind="angepasst"]');

    await expect(adjusted).toContainText(/20 kg statt [\d,]+ · Beispiel A/);
    await expect(adjusted).toContainText('nur bis Parallel');
    await expectNoHorizontalOverflow(page);

    // „Trotzdem machen“ und zurück.
    await paused.getByRole('button', { name: /Pausiert bis/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Front Squat' });

    await expect(dialog).toContainText('Erfundener Grund für den Test');
    await expectNoHorizontalOverflow(page);
    await dialog.getByRole('button', { name: 'Trotzdem machen' }).click();

    const overridden = sections.nth(0).locator('[data-restriction-kind="trotzdem"]');

    await expect(overridden).toContainText('Trotzdem · Beispiel A');
    await expect(page.getByRole('button', { name: 'Front Squat öffnen' })).toBeVisible();

    await overridden.getByRole('button', { name: /Trotzdem/ }).click();
    await dialog.getByRole('button', { name: 'Wieder pausieren' }).click();
    await expect(sections.nth(0).locator('[data-restriction-kind="pausiert"]')).toBeVisible();
  });

  test('verspricht und schreibt beim Abhaken den angepassten Wert, nicht das letzte Mal', async ({
    page,
  }) => {
    await startSession(page);
    await closeExerciseSheet(page);
    await openExerciseSheet(page, 'Bulgarian Split Squat');
    // Der Aufwärmsatz davor behält sein letztes Mal; die Anpassung gilt Satz 1.
    await selectSetRow(page, 'Satz 1 · links');

    // Zuletzt 22,5 kg, angepasst auf 20: Feld und Knopf zeigen die 20.
    await expect(
      page.locator('[data-sheet]').getByRole('button', { name: /abhaken$/ }),
    ).toContainText('20 kg × 8');
  });

  test('lässt eine pausierte Übung weder Fokus noch Partner im Supersatz werden', async ({
    page,
  }) => {
    await startSession(page);
    // Step-up (der Ersatz) mit der pausierten Front Squat davor verbinden.
    await page.getByRole('button', { name: 'Step-up mit voriger Übung verbinden' }).click();
    await page.waitForTimeout(600);

    const sheet = page.locator('[data-sheet]');

    // Im Sheet steht die Pause mit Etikett, aber kein Weg hinein.
    await expect(sheet.locator('[data-restriction-kind="pausiert"]')).toContainText(
      `Pausiert bis ${UNTIL.label} · Beispiel A`,
    );
    await expect(page.getByRole('button', { name: 'Zu Front Squat wechseln' })).toHaveCount(0);
    await sheet.getByRole('button', { name: /Pausiert bis/ }).click();
    const pauseDialog = page.getByRole('dialog', { name: 'Front Squat' });

    await expect(pauseDialog).toContainText('Erfundener Grund für den Test');
    await pauseDialog.getByRole('button', { name: 'Schließen' }).click();

    // Nach einem Reload fällt der Fokus nicht auf die pausierte erste Übung.
    await page.reload();
    await page.waitForTimeout(1200);
    await expect(page.getByRole('button', { name: 'Los mit Step-up' })).toBeVisible();
  });

  test('nimmt eine Übung in der Historie aus dem Leistungsstand und wieder hinein', async ({
    page,
  }) => {
    await startSession(page);
    await closeExerciseSheet(page);
    await openExerciseSheet(page, 'Step-up');
    await completeActiveSet(page);
    await closeExerciseSheet(page);
    await page.getByRole('button', { name: 'Session abschließen' }).first().click();
    await page.waitForTimeout(1500);

    await page.goto('./#/history');
    await page.waitForTimeout(1000);
    await page.getByRole('link', { name: /Einheit A/ }).first().click();
    await page.waitForTimeout(1200);
    await page.setViewportSize({ width: 320, height: 640 });

    await expect(page.locator('[data-restriction-kind="pausiert"]').first()).toBeVisible();
    await expect(page.locator('[data-restriction-kind="ersatz"]').first()).toBeVisible();

    const toggle = page.locator('[data-exclude-from-progress]').first();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Nicht als Leistungsstand').first()).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });
});

test.describe('Einschränkungen außerhalb der Einheit', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
    await seedSampleData(page);
  });

  test('zeigt Karte, Workout-Etikett und Jetzt-Zeile und hebt eine Einschränkung auf', async ({
    page,
  }) => {
    const errors = collectPageErrors(page);

    await importRestrictions(page);

    // Workout-Seite: das Etikett an der pausierten Übung, für heute.
    await page.goto('./#/templates');
    await page.waitForTimeout(800);
    await page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Einheit A' }) })
      .getByRole('link', { name: 'Bearbeiten' })
      .click();
    await page.waitForURL(/#\/templates\//);
    await expect(page.locator('[data-template-restriction="pausiert"]')).toContainText(
      `Pausiert bis ${UNTIL.label} · Ersatz: Step-up · Beispiel A`,
    );
    await expect(page.locator('[data-template-restriction="angepasst"]')).toContainText(
      'nur bis Parallel',
    );
    await expectNoHorizontalOverflow(page);

    // Jetzt-Sheet: die Zeile an der Workout-Karte.
    await page.goto('./');
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'Jetzt trainieren' }).click();
    await expect(page.locator('[data-now-restrictions]').first()).toContainText('1 Übung pausiert');
    await page.getByRole('button', { name: 'Auswahl schließen' }).click();

    // Plan-Seite: Karte, Sheet, Aufheben.
    const card = page.locator('[data-restrictions-card]');

    await expect(card).toContainText('Beispiel A');
    await expect(card).toContainText(`bis ${UNTIL.label}`);
    await expectNoHorizontalOverflow(page);
    await card.getByRole('button', { name: /Beispiel A/ }).click();

    const sheet = page.locator('[data-restriction-sheet]');

    await expect(sheet).toContainText('Erfundener Grund für den Test');
    await expect(sheet).toContainText('Pause: Front Squat → Ersatz Step-up, 2 Sätze, 8 Wdh.');
    await expectNoHorizontalOverflow(page);
    await sheet.getByRole('button', { name: 'Aufheben' }).click();
    await page
      .getByRole('alertdialog', { name: 'Beispiel A aufheben?' })
      .getByRole('button', { name: 'Aufheben' })
      .click();

    await expect(card).toHaveCount(0);
    await expect(sheet).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

const GUIDED_NAME = 'Abendflow Test';

/*
 * Kurze Einheit: Wechsel 5 s, Tiefe Hocke 4 s, Wechsel 5 s, Taubenpose 4 s
 * statt 6. Die Kosakenhocke ist pausiert und wird nicht abgespielt.
 */
const GUIDED_PAYLOAD = JSON.stringify({
  schemaVersion: 1,
  templates: [
    {
      name: GUIDED_NAME,
      category: 'yoga',
      steps: [
        { name: 'Tiefe Hocke', seconds: 4 },
        { name: 'Taubenpose', seconds: 6 },
        { name: 'Kosakenhocke', seconds: 4 },
      ],
    },
  ],
  planEntries: [{ date: localDay(0).iso, workout: GUIDED_NAME }],
  restrictions: [
    {
      name: 'Beispiel A',
      from: localDay(0).iso,
      until: UNTIL.iso,
      pauses: [{ template: GUIDED_NAME, step: 'Kosakenhocke' }],
      adjustments: [{ step: 'Taubenpose', seconds: 4, note: 'Nur bis zum Ziehen' }],
    },
  ],
});

test.describe('Einschränkungen in einer geführten Einheit', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
  });

  test('spielt den pausierten Schritt nicht ab und zeigt die Notiz auf der Bühne', async ({
    page,
  }) => {
    const errors = collectPageErrors(page);

    await page.goto('./#/sync');
    await page.waitForTimeout(600);
    await page.getByLabel('Oder JSON einfügen').fill(GUIDED_PAYLOAD);
    await page.getByRole('button', { name: 'Vorschau erzeugen' }).click();
    await page.getByRole('button', { name: 'Import bestätigen' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Eingespielt' })).toBeVisible();

    await page.goto('./');
    await page.waitForTimeout(1200);
    await page.locator('[data-now-unit]').click();
    await page.waitForURL(/#\/guided\//);
    await expect(page.locator('[data-guided-stage="start"]')).toBeVisible();

    // Start-Screen: der pausierte Schritt an seinem Platz, der angepasste mit „statt“.
    const paused = page.locator('[data-guided-step="2"]');

    await expect(paused).toHaveAttribute('data-guided-step-restriction', 'pausiert');
    await expect(paused).toContainText(`Pausiert bis ${UNTIL.label} · Beispiel A`);
    const adjusted = page.locator('[data-guided-step="1"]');

    await expect(adjusted).toHaveAttribute('data-guided-step-restriction', 'angepasst');
    await expect(adjusted).toContainText('4 s statt 6 · Beispiel A');
    await expect(adjusted).toContainText('Nur bis zum Ziehen');
    await expect(adjusted).toContainText('0:04');
    await expect(page.locator('[data-guided-facts]')).toContainText('2 Schritte');

    await page.clock.install();
    await page.getByRole('button', { name: 'Einheit starten' }).click();
    await page.waitForURL(/#\/guided\/run\//);
    const sessionId = page.url().split('/guided/run/')[1];
    const run = page.locator('[data-guided-run]');

    // Tiefe Hocke ohne Notiz, dann die Taubenpose mit Notiz und 4 s.
    await page.getByRole('button', { name: 'Sofort starten' }).click();
    await expect(page.locator('[data-guided-name]')).toContainText('Tiefe Hocke');
    await expect(page.locator('[data-guided-note]')).toHaveCount(0);
    await page.clock.runFor(4500);
    await expect(run).toHaveAttribute('data-guided-section', 'transition');
    await page.getByRole('button', { name: 'Sofort starten' }).click();
    await expect(page.locator('[data-guided-name]')).toContainText('Taubenpose');
    await expect(page.locator('[data-guided-note]')).toHaveText('Nur bis zum Ziehen');
    await expect(run).toHaveAttribute('data-guided-remaining', '4');
    await page.clock.runFor(4500);
    await expect(page.locator('[data-guided-stage="finished"]')).toBeVisible();

    // Das Protokoll zählt in der Vorlage: der pausierte Schritt steht als dritter darin.
    await page.goto(`./#/history/session/${sessionId}`);
    await expect(page.locator('[data-guided-protocol] > li')).toHaveCount(3);
    const pausedRow = page.locator('[data-protocol-step="3"]');

    await expect(pausedRow).toHaveAttribute('data-protocol-status', 'paused');
    await expect(pausedRow).toContainText('3. Kosakenhocke');
    await expect(pausedRow).toContainText('Pausiert');
    await expect(page.locator('[data-protocol-step="2"]')).toContainText('Soll 4 s');

    expect(errors).toEqual([]);
  });
});
