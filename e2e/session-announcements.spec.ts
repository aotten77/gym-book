import { expect, test, type Page } from '@playwright/test';
import { openExerciseSheet, resetDatabase, seedSampleData, startSampleSession } from './helpers';

/*
 * Zwischenansagen bei Sätzen auf Zeit.
 *
 * Was hier nicht geprüft werden kann, muss am Gerät geprüft werden: ob
 * überhaupt etwas hörbar ist, was der Klingelschalter damit macht und ob eine
 * Äußerung dem Chime die Audiositzung wegnimmt. WebKit im Test kennt außerdem
 * `navigator.vibrate` gar nicht - genau wie Safari auf dem iPhone, weshalb die
 * Sprache dort der einzige Kanal ist. Aufgezeichnet wird deshalb beides.
 */
async function recordAnnouncements(page: Page) {
  await page.addInitScript(() => {
    const spoken: string[] = [];
    const vibrations: number[][] = [];

    Object.defineProperty(window, '__spokenCues', { configurable: true, value: spoken });
    Object.defineProperty(window, '__vibrations', { configurable: true, value: vibrations });

    /*
     * Nur der Sprachdienst wird ersetzt, nicht der Konstruktor der Äußerung:
     * so läuft der echte Pfad des Moduls durch und der Test sieht trotzdem,
     * was gesagt worden wäre.
     */
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        cancel() {},
        speak(utterance: SpeechSynthesisUtterance) {
          if (utterance.volume > 0) {
            spoken.push(utterance.text);
          }
        },
      },
    });

    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: (pattern: number | number[]) => {
        vibrations.push(Array.isArray(pattern) ? pattern : [pattern]);
        return true;
      },
    });
  });
}

function readSpokenCues(page: Page) {
  return page.evaluate(() => (window as unknown as { __spokenCues: string[] }).__spokenCues);
}

test.describe('Zwischenansagen', () => {
  test.beforeEach(async ({ page }) => {
    await recordAnnouncements(page);
    await resetDatabase(page);
    await seedSampleData(page);
  });

  test('die Probe in den Einstellungen spricht und vibriert', async ({ page }) => {
    await page.goto('./#/settings');
    await page.waitForTimeout(600);

    await page.getByRole('button', { name: 'Ansage testen' }).click();
    await page.waitForTimeout(400);

    expect(await readSpokenCues(page)).toContain('Halbzeit');
    expect(
      await page.evaluate(() => (window as unknown as { __vibrations: number[][] }).__vibrations),
    ).toContainEqual([120]);
  });

  test('der Schalter nimmt der Probe den Knopf', async ({ page }) => {
    await page.goto('./#/settings');
    await page.waitForTimeout(600);

    await page.getByRole('switch', { name: /Zwischenansagen bei Sätzen auf Zeit/ }).click();
    await page.waitForTimeout(600);

    await expect(page.getByRole('button', { name: 'Ansage testen' })).toBeDisabled();
  });

  test('ein Satz auf Zeit meldet die Halbzeit von selbst', async ({ page }) => {
    // Der Test wartet eine echte halbe Minute ab - anders ist nicht zu zeigen,
    // dass die Ansage ohne Zutun kommt.
    test.slow();

    await startSampleSession(page);
    await openExerciseSheet(page, 'Nordic Curl Iso');

    const seconds = page.locator('input[id$="-seconds"]').first();
    await seconds.fill('45');
    // Der Autosave der Satzzeile läuft mit 600ms Verzögerung.
    await page.waitForTimeout(1200);

    await page.getByRole('button', { name: /starten$/ }).first().click();
    await expect(page.getByRole('timer')).toBeVisible();

    // Vor der Halbzeit (22,5s) darf nichts gesagt worden sein.
    await page.waitForTimeout(15_000);
    expect(await readSpokenCues(page)).toEqual([]);

    await expect
      .poll(() => readSpokenCues(page), { timeout: 20_000, intervals: [1000] })
      .toEqual(['Halbzeit']);
  });
});
