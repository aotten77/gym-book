import { expect, test, type Page } from "@playwright/test";
import { collectPageErrors, resetDatabase } from "./helpers";

/*
 * Das Schritt-Protokoll: Eine Einheit mit Verlängern und Überspringen läuft
 * durch, danach steht das Protokoll auf der Detailseite in Fortschritt und im
 * Text von „Analyse kopieren“. Wie es aus den Ereignissen entsteht, steht in
 * `domain/guided-run.test.ts`; hier zählt, dass es angezeigt und mitgegeben
 * wird.
 *
 * Kurze Einheit: Wechsel 5 s, Kindhaltung 4 s, Wechsel 5 s, Taube links 3 s,
 * Seitenwechsel 3 s, Taube rechts 3 s. Die Uhr steuert Playwright
 * (`page.clock`); die Ist-Zeiten sind deshalb Bereiche, nicht exakte Werte.
 */

const TEMPLATE_NAME = "Yoga Kurzflow";

const STEPS = [
  { name: "Kindhaltung", seconds: 4 },
  { name: "Taube", seconds: 3, bothSides: true },
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

function protocolRow(page: Page, step: number, side: string) {
  return page.locator(
    `[data-protocol-step="${step}"][data-protocol-side="${side}"]`,
  );
}

test.describe("Geführte Einheit: Schritt-Protokoll", () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page);
  });

  test("zeigt das Protokoll in Fortschritt und gibt es in Analyse kopieren mit", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);

    await importGuidedTemplate(page);
    await startRun(page);

    const sessionId = page.url().split("/guided/run/")[1];

    // Kindhaltung um 15 s verlängern und ganz ausspielen (4 + 15 s).
    await page.getByRole("button", { name: "Sofort starten" }).click();
    await page.getByRole("button", { name: "+15 s" }).click();
    await page.clock.runFor(19500);
    await expect(run(page)).toHaveAttribute(
      "data-guided-section",
      "transition",
    );

    // Taube links ganz, dann auf der rechten Seite überspringen: das beendet die Einheit.
    await page.getByRole("button", { name: "Sofort starten" }).click();
    await page.clock.runFor(3500);
    await page.clock.runFor(2600);
    await expect(
      page.locator("[data-guided-name] [data-guided-side]").last(),
    ).toHaveAttribute("data-guided-side", "right");
    await page.getByRole("button", { name: "Überspringen" }).click();
    await expect(page.locator('[data-guided-stage="finished"]')).toBeVisible();

    // Die Detailseite zeigt das Protokoll statt der Sätze.
    await page.goto(`./#/history/session/${sessionId}`);
    await expect(
      page.getByRole("heading", { name: "Schritt-Protokoll" }),
    ).toBeVisible();
    await expect(page.locator("[data-guided-protocol] > li")).toHaveCount(3);

    const kindhaltung = protocolRow(page, 1, "both");

    await expect(kindhaltung).toHaveAttribute(
      "data-protocol-status",
      "extended",
    );
    await expect(kindhaltung).toContainText("1. Kindhaltung");
    await expect(kindhaltung).toContainText("Verlängert");
    await expect(kindhaltung).toContainText("Soll 4 s");
    await expect(kindhaltung).toContainText(/Ist (18|19|20|21) s/);

    const links = protocolRow(page, 2, "left");

    await expect(links).toHaveAttribute("data-protocol-status", "done");
    await expect(links).toContainText("2. Taube · links");
    await expect(links).toContainText("Soll 3 s · Ist 3 s");

    const rechts = protocolRow(page, 2, "right");

    await expect(rechts).toHaveAttribute("data-protocol-status", "skipped");
    await expect(rechts).toContainText("2. Taube · rechts");
    await expect(rechts).toContainText("Übersprungen");
    await expect(rechts).toContainText(/Soll 3 s · Ist [0-2] s/);

    // „Analyse kopieren“ trägt das Protokoll mit. Die Zwischenablage ist hier ein Fänger.
    await page.goto("./#/sync");
    await page.evaluate(() => {
      const target = window as unknown as { __copied?: string };

      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          write: async (items: ClipboardItem[]) => {
            const blob = await items[0].getType("text/plain");

            target.__copied = await blob.text();
          },
          writeText: async (text: string) => {
            target.__copied = text;
          },
        },
      });
    });
    await page.getByRole("button", { name: "Analyse kopieren" }).click();
    await expect(page.getByText(/Analyse kopiert/)).toBeVisible();

    const copied = await page.evaluate(
      () => (window as unknown as { __copied?: string }).__copied ?? "",
    );

    expect(copied).toContain("## protokoll.csv");
    expect(copied).toContain("datum,wochentag,einheit,art,schritt_nr,schritt,seite,status");
    expect(copied).toMatch(/Yoga Kurzflow,yoga,1,Kindhaltung,beide,verlaengert,4,/);
    expect(copied).toMatch(/Yoga Kurzflow,yoga,2,Taube,links,gemacht,3,3,nein/);
    expect(copied).toMatch(/Yoga Kurzflow,yoga,2,Taube,rechts,uebersprungen,3,/);

    expect(errors).toEqual([]);
  });

  test("hält beim Abbruch fest, wie weit die Einheit kam", async ({ page }) => {
    const errors = collectPageErrors(page);

    await importGuidedTemplate(page);
    await startRun(page);

    const sessionId = page.url().split("/guided/run/")[1];

    // Kindhaltung ganz (4 s), dann im Wechsel in die Taube pausieren und beenden.
    await page.getByRole("button", { name: "Sofort starten" }).click();
    await page.clock.runFor(4500);
    await expect(run(page)).toHaveAttribute(
      "data-guided-section",
      "transition",
    );
    await page.getByRole("button", { name: "Pause" }).click();
    await page.getByRole("button", { name: "Einheit beenden …" }).click();
    await page
      .getByRole("dialog", { name: "Einheit beenden?" })
      .getByRole("button", { name: "Einheit beenden" })
      .click();
    await page.waitForURL(/#\/$/);

    await page.goto(`./#/history/session/${sessionId}`);
    await expect(
      page.getByRole("heading", { name: "Schritt-Protokoll" }),
    ).toBeVisible();
    await expect(page.locator("[data-guided-protocol] > li")).toHaveCount(1);
    await expect(protocolRow(page, 1, "both")).toHaveAttribute(
      "data-protocol-status",
      "done",
    );
    await expect(protocolRow(page, 1, "both")).toContainText("Soll 4 s · Ist 4 s");
    await expect(page.getByText("Abgebrochen", { exact: true }).first()).toBeVisible();

    expect(errors).toEqual([]);
  });
});
