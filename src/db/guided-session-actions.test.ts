import { describe, expect, it } from "vitest";
import { db } from "@/db/appDb";
import { loadTakenPlanEntryIds } from "@/db/plan-actions";
import {
  abortGuidedSession,
  completeGuidedSession,
  recordGuidedControl,
  setGuidedSessionAudioMode,
  startGuidedSession,
} from "@/db/guided-session-actions";
import { generateAnnouncements } from "@/db/announcement-actions";
import { saveApiKey } from "@/db/tts-actions";
import { abortSession, startSessionFromTemplate } from "@/db/session-actions";
import type { GuidedStep, PlanEntry } from "@/domain/models";

const STAMP = "2026-10-01T00:00:00.000Z";
// 2026-10-08 ist ein Donnerstag.
const DO = new Date(2026, 9, 8, 18, 0, 0);

const STEPS: GuidedStep[] = [
  { name: "Hund", seconds: 10 },
  { name: "Taube", seconds: 20, bothSides: true, hint: "Hüfte sinken lassen" },
];
// 5 + 10 + 5 + 20 + 3 + 20 = 63 s.
const TOTAL_MS = 63_000;

async function seedGuided(
  overrides: { category?: "yoga" | "faszien"; steps?: GuidedStep[] } = {},
) {
  await db.workoutTemplates.add({
    id: "g",
    name: "Abendflow",
    category: overrides.category ?? "yoga",
    steps: overrides.steps ?? STEPS,
    createdAt: STAMP,
    updatedAt: STAMP,
  });
}

function entry(
  id: string,
  date: string,
  templateId = "g",
  orderInDay = 1,
): PlanEntry {
  return {
    id,
    date,
    orderInDay,
    kind: "workout",
    templateId,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

describe("startGuidedSession", () => {
  it("legt eine aktive Session ohne Übungen mit Schritt-Snapshot und Start-Ereignis an", async () => {
    await seedGuided();

    const id = await startGuidedSession("g", { now: DO });
    const session = await db.workoutSessions.get(id);

    expect(session).toMatchObject({
      templateId: "g",
      templateNameSnapshot: "Abendflow",
      templateCategorySnapshot: "yoga",
      status: "active",
      startedAt: DO.toISOString(),
    });
    expect(session?.guided).toEqual({
      // Ohne Ansagen läuft „Nur Ton“.
      audioMode: "tone",
      steps: STEPS,
      events: [{ type: "start", at: DO.getTime() }],
    });
    expect(
      await db.workoutSessionExercises.where("sessionId").equals(id).count(),
    ).toBe(0);
    expect(await db.workoutSetLogs.count()).toBe(0);
  });

  it("friert die Schritte ein: eine spätere Änderung der Vorlage schreibt die Session nicht um", async () => {
    await seedGuided();

    const id = await startGuidedSession("g", { now: DO });

    await db.workoutTemplates.update("g", {
      steps: [{ name: "Neu", seconds: 5 }],
    });

    expect((await db.workoutSessions.get(id))?.guided?.steps).toEqual(STEPS);
  });

  it("verknüpft den heutigen Termin", async () => {
    await seedGuided();
    await db.planEntries.bulkAdd([
      entry("mo", "2026-10-05"),
      entry("do", "2026-10-08"),
    ]);

    const id = await startGuidedSession("g", { now: DO });
    const session = await db.workoutSessions.get(id);

    expect(session?.planEntryId).toBe("do");
    expect(session?.planDateSnapshot).toBe("2026-10-08");
  });

  it("nimmt den gewünschten offenen Termin", async () => {
    await seedGuided();
    await db.planEntries.bulkAdd([
      entry("mo", "2026-10-05"),
      entry("do", "2026-10-08"),
    ]);

    const id = await startGuidedSession("g", { now: DO, planEntryId: "mo" });

    expect((await db.workoutSessions.get(id))?.planEntryId).toBe("mo");
  });

  it("schreibt ohne Termin keinen Plan-Schlüssel", async () => {
    await seedGuided();

    const id = await startGuidedSession("g", { now: DO });
    const session = await db.workoutSessions.get(id);

    expect(session).not.toHaveProperty("planEntryId");
    expect(session).not.toHaveProperty("planDateSnapshot");
  });

  it("startet keine zweite Session, wenn schon eine läuft", async () => {
    await seedGuided();

    const first = await startGuidedSession("g", { now: DO });
    const second = await startGuidedSession("g", { now: DO });

    expect(second).toBe(first);
    expect(await db.workoutSessions.count()).toBe(1);
  });

  it("startet auch dann keine, wenn eine Kraft-Session läuft", async () => {
    await seedGuided();
    await db.exercises.add({
      id: "ex",
      name: "Deadlift",
      trackingMode: "reps_weight",
      unilateral: false,
      createdAt: STAMP,
      updatedAt: STAMP,
    });
    await db.workoutTemplates.add({
      id: "s",
      name: "Kraft",
      createdAt: STAMP,
      updatedAt: STAMP,
    });
    await db.workoutTemplateExercises.add({
      id: "te",
      templateId: "s",
      exerciseId: "ex",
      orderIndex: 1,
      workSetCount: 1,
    });

    const strength = await startSessionFromTemplate("s");
    const result = await startGuidedSession("g", { now: DO });

    expect(result).toBe(strength);
    expect(await db.workoutSessions.count()).toBe(1);
  });

  it("lehnt zwei gleichzeitige Starts ab: es entsteht genau eine Session", async () => {
    await seedGuided();

    const [a, b] = await Promise.all([
      startGuidedSession("g", { now: DO }),
      startGuidedSession("g", { now: DO }),
    ]);

    expect(a).toBe(b);
    expect(await db.workoutSessions.count()).toBe(1);
  });

  it("weigert sich bei einer Vorlage ohne Schritte", async () => {
    await db.workoutTemplates.add({
      id: "k",
      name: "Kraft",
      createdAt: STAMP,
      updatedAt: STAMP,
    });

    await expect(startGuidedSession("k")).rejects.toThrow(
      /keine geführte Vorlage/,
    );
    await expect(startGuidedSession("fehlt")).rejects.toThrow(/nicht gefunden/);
  });
});

describe("completeGuidedSession", () => {
  it("schließt am rechnerischen Ende ab, auch wenn die Seite später zurückkehrt", async () => {
    await seedGuided();
    await db.planEntries.add(entry("do", "2026-10-08"));

    const id = await startGuidedSession("g", { now: DO });
    const done = await completeGuidedSession(
      id,
      new Date(DO.getTime() + TOTAL_MS + 5 * 60_000),
    );
    const session = await db.workoutSessions.get(id);

    expect(done).toBe(true);
    expect(session?.status).toBe("completed");
    expect(session?.completedAt).toBe(
      new Date(DO.getTime() + TOTAL_MS).toISOString(),
    );
    expect(session?.guided?.steps).toEqual(STEPS);
  });

  it("macht vor dem Ende nichts", async () => {
    await seedGuided();

    const id = await startGuidedSession("g", { now: DO });
    const done = await completeGuidedSession(
      id,
      new Date(DO.getTime() + TOTAL_MS - 1000),
    );

    expect(done).toBe(false);
    expect((await db.workoutSessions.get(id))?.status).toBe("active");
  });

  it("überschreibt den Abschluss bei einem zweiten Aufruf nicht", async () => {
    await seedGuided();

    const id = await startGuidedSession("g", { now: DO });

    await completeGuidedSession(id, new Date(DO.getTime() + TOTAL_MS));
    const completedAt = (await db.workoutSessions.get(id))?.completedAt;

    expect(
      await completeGuidedSession(
        id,
        new Date(DO.getTime() + TOTAL_MS + 60_000),
      ),
    ).toBe(false);
    expect((await db.workoutSessions.get(id))?.completedAt).toBe(completedAt);
  });

  it("lässt eine abgebrochene Session abgebrochen", async () => {
    await seedGuided();

    const id = await startGuidedSession("g", { now: DO });

    await abortSession(id);

    expect(
      await completeGuidedSession(id, new Date(DO.getTime() + TOTAL_MS)),
    ).toBe(false);
    expect((await db.workoutSessions.get(id))?.status).toBe("aborted");
  });

  it("belegt den Termin im Lauf und nach dem Abschluss", async () => {
    await seedGuided();
    await db.planEntries.add(entry("do", "2026-10-08"));

    const id = await startGuidedSession("g", { now: DO });

    expect((await loadTakenPlanEntryIds(["do"])).has("do")).toBe(true);

    await completeGuidedSession(id, new Date(DO.getTime() + TOTAL_MS));

    expect((await loadTakenPlanEntryIds(["do"])).has("do")).toBe(true);
    expect((await db.workoutSessions.get(id))?.planEntryId).toBe("do");
  });

  it("wirft bei einer fremden Id", async () => {
    await expect(completeGuidedSession("fehlt")).rejects.toThrow(
      /nicht gefunden/,
    );
  });

  it("ignoriert eine Kraft-Session", async () => {
    await db.workoutSessions.add({
      id: "x",
      templateId: "t",
      templateNameSnapshot: "Kraft",
      resolvedProgramWeek: 1,
      startedAt: STAMP,
      status: "active",
    });

    expect(await completeGuidedSession("x")).toBe(false);
    expect((await db.workoutSessions.get("x"))?.status).toBe("active");
  });
});

const after = (seconds: number) => new Date(DO.getTime() + seconds * 1000);

describe("recordGuidedControl", () => {
  it("hängt Pause, Weiter und Neustart der Reihe nach an", async () => {
    await seedGuided();

    const id = await startGuidedSession("g", { now: DO });

    await recordGuidedControl(id, "pause", after(8));
    await recordGuidedControl(id, "restart", after(9));
    await recordGuidedControl(id, "resume", after(20));

    expect((await db.workoutSessions.get(id))?.guided?.events).toEqual([
      { type: "start", at: DO.getTime() },
      { type: "pause", at: after(8).getTime() },
      { type: "restart", at: after(9).getTime() },
      { type: "resume", at: after(20).getTime() },
    ]);
  });

  it("lehnt Weiter ohne Pause ab und lässt die Ereignisse stehen", async () => {
    await seedGuided();

    const id = await startGuidedSession("g", { now: DO });

    await expect(recordGuidedControl(id, "resume", after(3))).rejects.toThrow(
      /nicht pausiert/,
    );
    expect((await db.workoutSessions.get(id))?.guided?.events).toHaveLength(1);
  });

  it("lehnt eine zweite Pause ab", async () => {
    await seedGuided();

    const id = await startGuidedSession("g", { now: DO });

    await recordGuidedControl(id, "pause", after(3));

    await expect(recordGuidedControl(id, "pause", after(4))).rejects.toThrow(
      /schon pausiert/,
    );
  });

  it("lehnt ein Ereignis nach dem rechnerischen Ende ab", async () => {
    await seedGuided();

    const id = await startGuidedSession("g", { now: DO });

    await expect(recordGuidedControl(id, "pause", after(64))).rejects.toThrow(
      /zu Ende/,
    );
  });

  it("lehnt ein Ereignis an einer beendeten Einheit ab", async () => {
    await seedGuided();

    const id = await startGuidedSession("g", { now: DO });

    await abortGuidedSession(id);

    await expect(recordGuidedControl(id, "pause", after(3))).rejects.toThrow(
      /läuft nicht mehr/,
    );
  });

  it("verschiebt das automatische Ende um die Pause", async () => {
    await seedGuided();

    const id = await startGuidedSession("g", { now: DO });

    await recordGuidedControl(id, "pause", after(10));
    await recordGuidedControl(id, "resume", after(40));

    expect(await completeGuidedSession(id, after(63))).toBe(false);
    expect(await completeGuidedSession(id, after(93))).toBe(true);
    expect((await db.workoutSessions.get(id))?.completedAt).toBe(
      after(93).toISOString(),
    );
  });

  it("schließt in der Pause nicht automatisch ab", async () => {
    await seedGuided();

    const id = await startGuidedSession("g", { now: DO });

    await recordGuidedControl(id, "pause", after(10));

    expect(await completeGuidedSession(id, after(1000))).toBe(false);
    expect((await db.workoutSessions.get(id))?.status).toBe("active");
  });

  it("wirft bei einer fremden Id", async () => {
    await expect(recordGuidedControl("fehlt", "pause")).rejects.toThrow(
      /nicht gefunden/,
    );
  });
});

describe("recordGuidedControl: Überspringen, +15 s, Zurück, Sofort starten", () => {
  it("hängt die vier Ereignisse in gültiger Folge an", async () => {
    await seedGuided();

    const id = await startGuidedSession("g", { now: DO });

    await recordGuidedControl(id, "startNow", after(2));
    await recordGuidedControl(id, "extend", after(6));
    await recordGuidedControl(id, "skip", after(8));
    await recordGuidedControl(id, "back", after(9));

    expect(
      (await db.workoutSessions.get(id))?.guided?.events.map(
        (event) => event.type,
      ),
    ).toEqual(["start", "startNow", "extend", "skip", "back"]);
  });

  it("lehnt Sofort starten in einer Übung und +15 s im Wechsel ab und lässt die Ereignisse stehen", async () => {
    await seedGuided();

    const id = await startGuidedSession("g", { now: DO });

    await expect(recordGuidedControl(id, "extend", after(2))).rejects.toThrow(
      /nur in einer Übung/,
    );
    await expect(recordGuidedControl(id, "startNow", after(8))).rejects.toThrow(
      /nur im Wechsel/,
    );
    expect((await db.workoutSessions.get(id))?.guided?.events).toHaveLength(1);
  });

  it("lehnt sie in der Pause und nach dem Ende ab", async () => {
    await seedGuided();

    const id = await startGuidedSession("g", { now: DO });

    await recordGuidedControl(id, "pause", after(8));
    await expect(recordGuidedControl(id, "skip", after(9))).rejects.toThrow(
      /pausiert/,
    );
    await recordGuidedControl(id, "resume", after(10));
    await expect(recordGuidedControl(id, "skip", after(200))).rejects.toThrow(
      /zu Ende/,
    );
  });

  it("verschiebt das automatische Ende: Überspringen verkürzt, +15 s verlängert", async () => {
    await seedGuided();

    const id = await startGuidedSession("g", { now: DO });

    await recordGuidedControl(id, "extend", after(8));
    await recordGuidedControl(id, "skip", after(10));

    // Gespielt bis zum Sprung: Spielzeit 30 (verlängerter Hund endet bei 30), Rest 78-30 = 48, Ende bei 10+48.
    expect(await completeGuidedSession(id, after(57))).toBe(false);
    expect(await completeGuidedSession(id, after(58))).toBe(true);
    expect((await db.workoutSessions.get(id))?.completedAt).toBe(
      after(58).toISOString(),
    );
  });
});

describe("Schritt-Protokoll an der Session", () => {
  it("speichert beim Abschluss das Protokoll mit Verlängerung und Überspringen", async () => {
    await seedGuided();

    const id = await startGuidedSession("g", { now: DO });

    // Hund 5-15 s: +15 s bei 8 s, endet bei 30 s; Taube dahinter.
    await recordGuidedControl(id, "extend", after(8));
    expect(await completeGuidedSession(id, after(200))).toBe(true);

    const protocol = (await db.workoutSessions.get(id))?.guided?.protocol;

    expect(protocol).toEqual([
      { stepIndex: 0, name: "Hund", status: "extended", plannedSeconds: 10, actualSeconds: 25 },
      { stepIndex: 1, name: "Taube", side: "left", status: "done", plannedSeconds: 20, actualSeconds: 20 },
      { stepIndex: 1, name: "Taube", side: "right", status: "done", plannedSeconds: 20, actualSeconds: 20 },
    ]);
    // Schritte und Ereignisse bleiben dabei unverändert.
    expect((await db.workoutSessions.get(id))?.guided?.steps).toEqual(STEPS);
  });

  it("schreibt vor dem Ende kein Protokoll", async () => {
    await seedGuided();

    const id = await startGuidedSession("g", { now: DO });

    await completeGuidedSession(id, after(30));

    expect((await db.workoutSessions.get(id))?.guided?.protocol).toBeUndefined();
  });

  it("speichert beim Abbruch das Protokoll bis zum Abbruch", async () => {
    await seedGuided();

    const id = await startGuidedSession("g", { now: DO });

    await abortGuidedSession(id, after(28));

    const session = await db.workoutSessions.get(id);

    expect(session?.status).toBe("aborted");
    expect(session?.completedAt).toBe(after(28).toISOString());
    expect(session?.guided?.protocol).toEqual([
      { stepIndex: 0, name: "Hund", status: "done", plannedSeconds: 10, actualSeconds: 10 },
      { stepIndex: 1, name: "Taube", side: "left", status: "aborted", plannedSeconds: 20, actualSeconds: 8 },
    ]);
  });

  it("verändert das Protokoll einer abgeschlossenen Einheit beim Abbruch nicht", async () => {
    await seedGuided();

    const id = await startGuidedSession("g", { now: DO });

    await completeGuidedSession(id, after(63));

    const before = (await db.workoutSessions.get(id))?.guided?.protocol;

    await abortGuidedSession(id, after(10));

    expect((await db.workoutSessions.get(id))?.guided?.protocol).toEqual(before);
    expect((await db.workoutSessions.get(id))?.completedAt).toBe(after(63).toISOString());
  });
});

describe("abortGuidedSession", () => {
  it("bricht ab und lässt den Plan-Termin offen", async () => {
    await seedGuided();
    await db.planEntries.add(entry("do", "2026-10-08"));

    const id = await startGuidedSession("g", { now: DO });

    expect((await loadTakenPlanEntryIds(["do"])).has("do")).toBe(true);

    await recordGuidedControl(id, "pause", after(10));
    await abortGuidedSession(id);

    expect((await db.workoutSessions.get(id))?.status).toBe("aborted");
    expect((await loadTakenPlanEntryIds(["do"])).has("do")).toBe(false);
    // Eine neue Einheit ist wieder möglich und nimmt den offenen Termin.
    const again = await startGuidedSession("g", { now: DO });

    expect(again).not.toBe(id);
    expect((await db.workoutSessions.get(again))?.planEntryId).toBe("do");
  });

  it("lässt eine abgeschlossene Einheit abgeschlossen", async () => {
    await seedGuided();

    const id = await startGuidedSession("g", { now: DO });

    await completeGuidedSession(id, after(63));
    await abortGuidedSession(id);

    expect((await db.workoutSessions.get(id))?.status).toBe("completed");
  });

  it("weist eine Kraft-Session ab", async () => {
    await db.workoutTemplates.add({
      id: "k",
      name: "Kraft",
      createdAt: STAMP,
      updatedAt: STAMP,
    });

    const id = await startSessionFromTemplate("k");

    await expect(abortGuidedSession(id)).rejects.toThrow(/keine geführte/);
  });

  it("wirft bei einer fremden Id", async () => {
    await expect(abortGuidedSession("fehlt")).rejects.toThrow(/nicht gefunden/);
  });
});

async function seedAnnouncements() {
  await saveApiKey("PLATZHALTER-SCHLUESSEL-4321");
  await generateAnnouncements(["g"], {
    synth: async () => new Blob(["mp3"], { type: "audio/mpeg" }),
    isOnline: () => true,
  });
}

describe("Audio-Wahl", () => {
  it("legt die Wahl an die Session und merkt sie als zuletzt gewählt", async () => {
    await seedGuided();
    await seedAnnouncements();

    const id = await startGuidedSession("g", { now: DO, audioMode: "voice" });

    expect((await db.workoutSessions.get(id))?.guided?.audioMode).toBe("voice");
    expect((await db.appSettings.get("app-settings"))?.guidedAudioMode).toBe(
      "voice",
    );
  });

  it("wählt ohne Angabe die zuletzt gewählte, sonst Stimme, wo sie möglich ist", async () => {
    await seedGuided();
    await seedAnnouncements();

    const first = await startGuidedSession("g", { now: DO });

    expect((await db.workoutSessions.get(first))?.guided?.audioMode).toBe("voice");
    await abortSession(first);

    await startGuidedSession("g", { now: DO, audioMode: "tone" });
    expect((await db.appSettings.get("app-settings"))?.guidedAudioMode).toBe("tone");
  });

  it("läuft ohne vollständige Ansagen als „Nur Ton“ und überschreibt die letzte Wahl nicht", async () => {
    await seedGuided();
    await db.appSettings.put({
      id: "app-settings",
      guidedAudioMode: "voice",
      exportSchemaVersion: 1,
      updatedAt: STAMP,
    });

    const id = await startGuidedSession("g", { now: DO, audioMode: "voice" });

    expect((await db.workoutSessions.get(id))?.guided?.audioMode).toBe("tone");
    expect((await db.appSettings.get("app-settings"))?.guidedAudioMode).toBe(
      "voice",
    );
  });

  it("schaltet während der Einheit um, ohne die Zeit zu berühren", async () => {
    await seedGuided();
    await seedAnnouncements();

    const id = await startGuidedSession("g", { now: DO, audioMode: "voice" });

    await recordGuidedControl(id, "pause", after(8));

    const before = (await db.workoutSessions.get(id))?.guided;

    await setGuidedSessionAudioMode(id, "tone");

    const changed = await db.workoutSessions.get(id);

    expect(changed?.guided?.audioMode).toBe("tone");
    expect(changed?.guided?.events).toEqual(before?.events);
    expect(changed?.guided?.steps).toEqual(before?.steps);
    expect((await db.appSettings.get("app-settings"))?.guidedAudioMode).toBe("tone");
  });

  it("lehnt „Stimme + Ton“ ab, wenn eine Ansage fehlt, und lässt die Wahl stehen", async () => {
    await seedGuided();

    const id = await startGuidedSession("g", { now: DO });

    await expect(setGuidedSessionAudioMode(id, "voice")).rejects.toThrow(
      "Keine Ansagen",
    );
    expect((await db.workoutSessions.get(id))?.guided?.audioMode).toBe("tone");
  });

  it("verliert beim Steuern weder Wahl noch Protokoll", async () => {
    await seedGuided();
    await seedAnnouncements();

    const id = await startGuidedSession("g", { now: DO, audioMode: "voice" });

    await recordGuidedControl(id, "pause", after(8));
    await recordGuidedControl(id, "resume", after(9));

    expect((await db.workoutSessions.get(id))?.guided?.audioMode).toBe("voice");
  });

  it("wirft bei einer fremden Id und bei einer beendeten Einheit", async () => {
    await seedGuided();
    await seedAnnouncements();
    await expect(setGuidedSessionAudioMode("nix", "tone")).rejects.toThrow();

    const id = await startGuidedSession("g", { now: DO, audioMode: "voice" });

    await abortGuidedSession(id, after(5));
    await expect(setGuidedSessionAudioMode(id, "tone")).rejects.toThrow(
      "läuft nicht mehr",
    );
  });
});
