import { expect, test, type Page } from "@playwright/test";
import { collectPageErrors, resetDatabase } from "./helpers";

/*
 * Stimme + Ton: die Wahl auf dem Start-Screen, die Pille im Ablauf und die
 * zuletzt gewählte Wahl. Hörbar ist Audio hier nicht - geprüft wird über die
 * Test-Anker der Bühne: `data-guided-audio` (die Wahl der Einheit) und
 * `data-guided-announced` (der Schlüssel der zuletzt angesagten Ansage, auch
 * wenn sich die Platzhalter-MP3 nicht dekodieren lässt). Google wird immer
 * abgefangen, der Schlüssel ist ein Platzhalter.
 *
 * Kurze Einheit: Wechsel 5 s, Kindhaltung 4 s (Ende bei 9 s), Wechsel 5 s,
 * Taube links 3 s (Ende bei 17 s), Seitenwechsel 3 s, Taube rechts 3 s - 23 s.
 */
const KEY = "PLATZHALTER-E2E-0042";
const TEMPLATE_NAME = "Yoga Kurzflow";
const GOOGLE = "https://texttospeech.googleapis.com/**";
const STEPS = [
  { name: "Kindhaltung", seconds: 4 },
  { name: "Taube", seconds: 3, bothSides: true },
];

async function interceptGoogle(page: Page) {
  await page.route(GOOGLE, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ audioContent: "AAAA" }),
    }),
  );
}

async function saveKey(page: Page) {
  await page.goto("./#/settings");

  const section = page.getByTestId("speech-settings");

  await section.getByLabel("Google-Schlüssel").fill(KEY);
  await section
    .getByRole("button", { name: "Speichern", exact: true })
    .click();
  await expect(section).toContainText("••••0042");
}

async function importTemplate(page: Page, { withKey = false } = {}) {
  await page.goto("./#/sync");
  await page.waitForTimeout(600);
  await page.getByLabel("Oder JSON einfügen").fill(
    JSON.stringify({
      schemaVersion: 1,
      templates: [{ name: TEMPLATE_NAME, category: "yoga", steps: STEPS }],
    }),
  );
  await page.getByRole("button", { name: "Vorschau erzeugen" }).click();
  await page.getByRole("button", { name: "Import bestätigen" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Eingespielt" }),
  ).toBeVisible();

  if (withKey) {
    // Die Ansagen entstehen nach dem Import; wer vorher weggeht, bricht das ab.
    // Kindhaltung, Taube links, Taube rechts, Geschafft.
    await expect(
      page.getByRole("status").filter({ hasText: "4 Ansagen erzeugt" }),
    ).toBeVisible();
  }
}

async function openStart(page: Page) {
  await page.goto("./");
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Jetzt trainieren" }).click();
  await page
    .locator("[data-sheet]")
    .getByRole("button", { name: new RegExp(TEMPLATE_NAME) })
    .click();
  await expect(page.locator('[data-guided-stage="start"]')).toBeVisible();
}

async function startRun(page: Page) {
  // Erst nach dem Laden die Uhr übernehmen: Import und Navigation laufen in Echtzeit.
  await page.clock.install();
  await page.getByRole("button", { name: "Einheit starten" }).click();
  await page.waitForURL(/#\/guided\/run\//);
  await expect(page.locator('[data-guided-stage="run"]')).toBeVisible();
}

const stage = (page: Page) => page.locator("[data-guided-stage]");
const pill = (page: Page) => page.locator("[data-guided-audio-pill]");

test.describe("Geführte Einheit: Stimme + Ton", () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
  });

  test("ohne Ansagen ist „Stimme + Ton“ ausgegraut, und die Einheit läuft mit „Nur Ton“", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);

    await interceptGoogle(page);
    await importTemplate(page);
    await openStart(page);

    await expect(page.getByRole("radio", { name: /Stimme \+ Ton/ })).toBeDisabled();
    await expect(
      page.getByRole("radio", { name: /Nur Ton/ }),
    ).toHaveAttribute("aria-checked", "true");

    await startRun(page);

    await expect(stage(page)).toHaveAttribute("data-guided-audio", "tone");
    await expect(pill(page)).toHaveText("Nur Ton");
    await expect(pill(page)).toBeDisabled();

    await page.clock.runFor(9500);
    await expect(stage(page)).not.toHaveAttribute("data-guided-announced", /.+/);
    expect(errors).toEqual([]);
  });

  test("die Pille schaltet um, ohne die Zeit zu berühren, und sagt nur in „Stimme + Ton“ an", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);

    await interceptGoogle(page);
    await saveKey(page);
    await importTemplate(page, { withKey: true });
    await openStart(page);

    // Vorausgewählt: Stimme, weil alle Ansagen da sind und noch nie anders gewählt wurde.
    await expect(
      page.getByRole("radio", { name: /Stimme \+ Ton/ }),
    ).toHaveAttribute("aria-checked", "true");

    await startRun(page);

    await expect(stage(page)).toHaveAttribute("data-guided-audio", "voice");
    await expect(pill(page)).toHaveText("Stimme + Ton");
    // Schon im ersten Wechsel vor Schritt 1.
    await expect(stage(page)).toHaveAttribute(
      "data-guided-announced",
      "announce:start",
    );

    const remaining = await page
      .locator("[data-guided-run]")
      .getAttribute("data-guided-remaining");

    await pill(page).click();
    await expect(stage(page)).toHaveAttribute("data-guided-audio", "tone");
    await expect(pill(page)).toHaveText("Nur Ton");
    await expect(pill(page)).toBeEnabled();
    // Die Zeit steht, wo sie stand: die Pille schreibt kein Ereignis.
    await expect(page.locator("[data-guided-run]")).toHaveAttribute(
      "data-guided-remaining",
      remaining ?? "",
    );

    // Ende der Kindhaltung bei 9 s: in „Nur Ton“ kommt keine Ansage dazu.
    await page.clock.runFor(9500);
    await expect(stage(page)).toHaveAttribute(
      "data-guided-announced",
      "announce:start",
    );

    // Zurück auf Stimme, nach der Frische der verpassten Ansage: sie wird nicht nachgeholt.
    await page.clock.runFor(2500);
    await pill(page).click();
    await expect(stage(page)).toHaveAttribute("data-guided-audio", "voice");
    await expect(stage(page)).toHaveAttribute(
      "data-guided-announced",
      "announce:start",
    );

    // Ende von Taube links bei 17 s: die nächste Ansage ist die rechte Seite.
    await page.clock.runFor(5500);
    await expect(stage(page)).toHaveAttribute(
      "data-guided-announced",
      "announce:exercise-end:3",
    );
    expect(errors).toEqual([]);
  });

  test("die letzte Wahl bleibt für die nächste Einheit vorgemerkt", async ({
    page,
  }) => {
    await interceptGoogle(page);
    await saveKey(page);
    await importTemplate(page, { withKey: true });
    await openStart(page);
    await startRun(page);

    await pill(page).click();
    await expect(stage(page)).toHaveAttribute("data-guided-audio", "tone");

    // Die Einheit läuft durch (23 s); am Ende steht „Fertig“.
    await page.clock.runFor(25000);
    await expect(page.locator('[data-guided-stage="finished"]')).toBeVisible();
    await page.getByRole("button", { name: "Fertig" }).click();

    await openStart(page);
    await expect(
      page.getByRole("radio", { name: /Nur Ton/ }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      page.getByRole("radio", { name: /Stimme \+ Ton/ }),
    ).toBeEnabled();
  });
});
