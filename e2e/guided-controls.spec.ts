import { expect, test, type Page } from "@playwright/test";
import { collectPageErrors, resetDatabase } from "./helpers";

/*
 * Überspringen, +15 s, Zurück, Sofort starten und das Info-Modal.
 *
 * Die Uhr steuert Playwright (`page.clock`). Wie sich der Stand aus den
 * Ereignissen ergibt, steht in `domain/guided-run.test.ts`; hier zählt, was
 * der Screen daraus macht. Ton ist nicht prüfbar - dass eine übersprungene
 * Übung kein Wechselsignal auslöst, deckt der Domain-Test ab.
 *
 * Kurze Einheit: Wechsel 5 s, Kindhaltung 4 s, Wechsel 5 s, Taube links 3 s,
 * Seitenwechsel 3 s, Taube rechts 3 s - zusammen 23 s.
 */

const TEMPLATE_NAME = "Yoga Kurzflow";

const STEPS = [
  { name: "Kindhaltung", seconds: 4, hint: "Stirn auf die Matte legen" },
  { name: "Taube", seconds: 6, bothSides: true, hint: "Hüfte sinken lassen" },
];

function localDateKey(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${date.getFullYear()}-${month}-${day}`;
}

async function importGuidedTemplate(page: Page) {
  await page.goto("./#/sync");
  await page.waitForTimeout(600);
  await page.getByLabel("Oder JSON einfügen").fill(
    JSON.stringify({
      schemaVersion: 1,
      templates: [{ name: TEMPLATE_NAME, category: "yoga", steps: STEPS }],
      planEntries: [{ date: localDateKey(), workout: TEMPLATE_NAME }],
    }),
  );
  await page.getByRole("button", { name: "Vorschau erzeugen" }).click();
  await page.getByRole("button", { name: "Import bestätigen" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Eingespielt" }),
  ).toBeVisible();
}

/** Vom heutigen Termin im Jetzt-Sheet auf den Start-Screen und von dort in den Ablauf. */
async function startRun(page: Page) {
  await page.goto("./");
  await page.waitForTimeout(1200);
  await page.locator("[data-now-unit]").click();
  await page.waitForURL(/#\/guided\//);
  await expect(page.locator('[data-guided-stage="start"]')).toBeVisible();

  // Erst nach dem Laden die Uhr übernehmen: Import und Navigation laufen in Echtzeit.
  await page.clock.install();
  await page.getByRole("button", { name: "Einheit starten" }).click();
  await page.waitForURL(/#\/guided\/run\//);
  await expect(page.locator('[data-guided-stage="run"]')).toBeVisible();
}

const run = (page: Page) => page.locator("[data-guided-run]");

/** Mindestens 44 px hoch und breit - die Fläche, die der Daumen trifft. */
async function expectTouchSize(page: Page, name: string) {
  const box = await page
    .getByRole("button", { name, exact: true })
    .boundingBox();

  expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5);
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(43.5);
}

test.describe("Geführte Einheit: Springen, Verlängern, Hinweis", () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
  });

  test("Sofort starten, +15 s, Überspringen, Zurück und das Info-Modal", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);

    await importGuidedTemplate(page);
    await startRun(page);

    // Im ersten Wechsel: Sofort starten ja, +15 s nein, Überspringen nein.
    await expect(run(page)).toHaveAttribute(
      "data-guided-section",
      "transition",
    );
    await expect(
      page.getByRole("button", { name: "Sofort starten" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "+15 s" })).toHaveCount(0);
    await expectTouchSize(page, "Sofort starten");
    await expectTouchSize(page, "Zurück");
    await expectTouchSize(page, "Pause");

    await page.getByRole("button", { name: "Sofort starten" }).click();
    await expect(run(page)).toHaveAttribute("data-guided-section", "exercise");
    await expect(page.locator("[data-guided-name]")).toContainText(
      "Kindhaltung",
    );
    await expect(
      page.getByRole("button", { name: "Sofort starten" }),
    ).toHaveCount(0);

    // +15 s: aus 4 Sekunden werden rund 19.
    await expect(run(page)).toHaveAttribute("data-guided-remaining", /^[34]$/);
    await expectTouchSize(page, "+15 s");
    await expectTouchSize(page, "Überspringen");
    await page.getByRole("button", { name: "+15 s" }).click();
    await expect(run(page)).toHaveAttribute(
      "data-guided-remaining",
      /^(18|19)$/,
    );
    await expect(run(page)).toHaveAttribute("data-guided-section", "exercise");

    // Überspringen: der Wechsel in die Taube, die Kindhaltung ist übergangen.
    await page.getByRole("button", { name: "Überspringen" }).click();
    await expect(run(page)).toHaveAttribute(
      "data-guided-section",
      "transition",
    );
    await expect(run(page)).toHaveAttribute("data-guided-now", "1");
    await expect(page.locator("[data-guided-name]")).toContainText("Taube");

    // Das Info-Modal im Wechsel: die Zeit läuft weiter, der nächste Abschnitt schließt es.
    await page.getByRole("button", { name: "Hinweis: Taube" }).click();

    const dialog = page.getByRole("dialog", { name: "Hinweis · Taube" });

    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Hüfte sinken lassen");
    await expect(dialog).toContainText("Die Zeit läuft weiter");

    const before = Number(
      await run(page).getAttribute("data-guided-remaining"),
    );

    await page.clock.runFor(2000);
    await expect(dialog).toBeVisible();
    expect(
      Number(await run(page).getAttribute("data-guided-remaining")),
    ).toBeLessThan(before);

    await page.clock.runFor(3500);
    await expect(run(page)).toHaveAttribute("data-guided-section", "exercise");
    await expect(dialog).toHaveCount(0);

    // Höchstens eine Lime-Fläche auf dem laufenden Screen.
    const limeCount = await page.evaluate(() => {
      const lime = "rgb(220, 242, 90)";

      return Array.from(
        document.querySelectorAll<HTMLElement>("[data-guided-stage] *"),
      ).filter((element) => {
        const style = getComputedStyle(element);
        const parent = element.parentElement;
        // Eine geerbte Textfarbe (das L/R in der Lime-Überschrift) ist keine eigene Fläche.
        const inherited =
          parent !== null && getComputedStyle(parent).color === lime;

        return (
          style.backgroundColor === lime ||
          (style.color === lime && !inherited)
        );
      }).length;
    });

    expect(limeCount).toBeLessThanOrEqual(1);

    // Zurück aus der Taube: an den Anfang der Kindhaltung (ihr Wechsel).
    await page.getByRole("button", { name: "Zurück" }).click();
    await expect(run(page)).toHaveAttribute(
      "data-guided-section",
      "transition",
    );
    await expect(run(page)).toHaveAttribute("data-guided-now", "0");
    await expect(page.locator("[data-guided-name]")).toContainText(
      "Kindhaltung",
    );

    // Das Info-Modal in der Übung schließt sich beim Wechsel in den nächsten Abschnitt.
    await page.getByRole("button", { name: "Sofort starten" }).click();
    await page.getByRole("button", { name: "Hinweis: Kindhaltung" }).click();
    await expect(
      page.getByRole("dialog", { name: "Hinweis · Kindhaltung" }),
    ).toBeVisible();
    await page.clock.runFor(4500);
    await expect(run(page)).toHaveAttribute(
      "data-guided-section",
      "transition",
    );
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Den letzten Schritt überspringen beendet die Einheit; die Zahl der Schritte ist echt.
    await page.getByRole("button", { name: "Sofort starten" }).click();
    await expect(run(page)).toHaveAttribute("data-guided-section", "exercise");
    await page.getByRole("button", { name: "Überspringen" }).click();

    const done = page.locator('[data-guided-stage="finished"]');

    await expect(done).toBeVisible();
    await expect(page.locator("[data-guided-done]")).toContainText("1/2");

    expect(errors).toEqual([]);
  });
});
