import { describe, expect, it } from "vitest";
import {
  GUIDED_SIGNAL_MAX_DELAY_MS,
  addGuidedEvent,
  deriveGuidedProtocol,
  deriveGuidedRunState,
  guidedRunEndsAt,
  isGuidedSession,
} from "@/domain/guided-run";
import type { GuidedEvent, GuidedStep } from "@/domain/models";

const T0 = 1_000_000;
const START: GuidedEvent[] = [{ type: "start", at: T0 }];

// Abschnitte: Wechsel 5, Hund 10, Wechsel 5, Taube L 20, Seitenwechsel 3, Taube R 20.
// Summe 63 s.
const STEPS: GuidedStep[] = [
  { name: "Hund", seconds: 10 },
  { name: "Taube", seconds: 40, bothSides: true },
];

const at = (seconds: number) => T0 + seconds * 1000;

describe("deriveGuidedRunState", () => {
  it("steht ohne Start-Ereignis im ersten Wechsel, ohne Zeit zu rechnen", () => {
    const state = deriveGuidedRunState(STEPS, [], at(100));

    expect(state.phase).toBe("transition");
    expect(state.sectionIndex).toBe(0);
    expect(state.elapsedSeconds).toBe(0);
    expect(state.dueSignal).toBeNull();
  });

  it("beginnt mit dem 5-s-Wechsel in den ersten Schritt", () => {
    const state = deriveGuidedRunState(STEPS, START, at(1.2));

    expect(state.phase).toBe("transition");
    expect(state.current).toMatchObject({ kind: "transition", stepIndex: 0 });
    expect(state.remainingSeconds).toBe(4);
    expect(state.stepIndex).toBe(0);
    expect(state.nextExercise).toMatchObject({
      kind: "exercise",
      stepIndex: 0,
    });
    expect(state.totalSeconds).toBe(63);
  });

  it("läuft nach dem Wechsel in die Übung und nennt die nächste", () => {
    const state = deriveGuidedRunState(STEPS, START, at(5));

    expect(state.phase).toBe("exercise");
    expect(state.sectionIndex).toBe(1);
    expect(state.remainingSeconds).toBe(10);
    expect(state.nextExercise).toMatchObject({ stepIndex: 1, side: "left" });
  });

  it("rundet die Restzeit auf, damit die Uhr nie vor dem Ende 0 zeigt", () => {
    expect(deriveGuidedRunState(STEPS, START, at(14.2)).remainingSeconds).toBe(
      1,
    );
    expect(deriveGuidedRunState(STEPS, START, at(14.9)).remainingSeconds).toBe(
      1,
    );
  });

  it("führt durch Seitenwechsel und beide Seiten", () => {
    const left = deriveGuidedRunState(STEPS, START, at(21));
    const switching = deriveGuidedRunState(STEPS, START, at(41));
    const right = deriveGuidedRunState(STEPS, START, at(44));

    expect(left.current).toMatchObject({ kind: "exercise", side: "left" });
    expect(left.nextExercise).toMatchObject({ stepIndex: 1, side: "right" });
    expect(switching.phase).toBe("transition");
    expect(switching.current).toMatchObject({
      kind: "sideSwitch",
      side: "right",
    });
    expect(right.current).toMatchObject({ kind: "exercise", side: "right" });
    expect(right.nextExercise).toBeNull();
  });

  it("ist am Ende fertig und trägt den Gesamtfortschritt", () => {
    const state = deriveGuidedRunState(STEPS, START, at(63));

    expect(state.phase).toBe("finished");
    expect(state.current).toBeNull();
    expect(state.progress).toBe(1);
    expect(state.remainingTotalSeconds).toBe(0);
    expect(state.stepProgress).toEqual([1, 1]);
  });

  it("bleibt fertig, auch Minuten später", () => {
    const state = deriveGuidedRunState(STEPS, START, at(63 + 300));

    expect(state.phase).toBe("finished");
    expect(state.elapsedSeconds).toBe(63);
  });

  it("rechnet Fortschritt und Rest über die ganze Einheit", () => {
    const state = deriveGuidedRunState(STEPS, START, at(15.5));

    expect(state.elapsedSeconds).toBeCloseTo(15.5);
    expect(state.progress).toBeCloseTo(15.5 / 63);
    expect(state.remainingTotalSeconds).toBe(48);
  });

  it("teilt den Fortschritt je Schritt, Wechsel und Seitenwechsel eingerechnet", () => {
    // Schritt 0 umfasst 0 bis 15 s, Schritt 1 umfasst 15 bis 63 s.
    const state = deriveGuidedRunState(STEPS, START, at(15 + 24));

    expect(state.stepProgress[0]).toBe(1);
    expect(state.stepProgress[1]).toBeCloseTo(24 / 48);
    expect(state.stepIndex).toBe(1);
  });

  it("rechnet nach Minuten im Hintergrund die Zeit richtig weiter", () => {
    const state = deriveGuidedRunState(STEPS, START, at(50));

    expect(state.current).toMatchObject({ kind: "exercise", side: "right" });
    expect(state.remainingSeconds).toBe(13);
  });

  it("läuft für das Wechselsignal erst nach dem Ende der Übung", () => {
    expect(deriveGuidedRunState(STEPS, START, at(14.9)).dueSignal).toBeNull();
  });
});

describe("fälliges Signal", () => {
  it("kommt genau am Ende einer Übung", () => {
    const state = deriveGuidedRunState(STEPS, START, at(15.2));

    expect(state.dueSignal).toEqual({ key: "exercise-end:1", dueAt: at(15) });
  });

  it("kommt auch am Ende der ersten Seite, vor dem Seitenwechsel", () => {
    expect(deriveGuidedRunState(STEPS, START, at(40.5)).dueSignal?.key).toBe(
      "exercise-end:3",
    );
  });

  it("kommt am Ende der letzten Übung, wenn die Einheit fertig ist", () => {
    const state = deriveGuidedRunState(STEPS, START, at(63.5));

    expect(state.phase).toBe("finished");
    expect(state.dueSignal?.key).toBe("exercise-end:5");
  });

  it("gibt es weder im Wechsel noch mitten in der Übung", () => {
    expect(deriveGuidedRunState(STEPS, START, at(2)).dueSignal).toBeNull();
    expect(deriveGuidedRunState(STEPS, START, at(8)).dueSignal).toBeNull();
    expect(deriveGuidedRunState(STEPS, START, at(30)).dueSignal).toBeNull();
  });

  it("gilt nur etwa 2 Sekunden lang (Frische-Regel)", () => {
    const fresh = at(15) + GUIDED_SIGNAL_MAX_DELAY_MS;

    expect(deriveGuidedRunState(STEPS, START, fresh).dueSignal).not.toBeNull();
    expect(deriveGuidedRunState(STEPS, START, fresh + 1).dueSignal).toBeNull();
  });

  it("holt nach der Rückkehr aus dem Hintergrund nichts nach", () => {
    // Drei Minuten später: die Einheit ist durch, aber kein Signal ist fällig.
    expect(
      deriveGuidedRunState(STEPS, START, at(63 + 180)).dueSignal,
    ).toBeNull();
    // Mitten im Ablauf nach einer Lücke: die Zeit stimmt, das verpasste Signal nicht.
    const state = deriveGuidedRunState(STEPS, START, at(42.5));

    expect(state.current).toMatchObject({ kind: "sideSwitch" });
    expect(state.dueSignal).toBeNull();
  });
});

describe("addGuidedEvent", () => {
  it("hängt den Start an eine leere Liste", () => {
    expect(addGuidedEvent([], { type: "start", at: 5 }, STEPS)).toEqual([
      { type: "start", at: 5 },
    ]);
  });

  it("lässt die ursprüngliche Liste unberührt", () => {
    const events: GuidedEvent[] = [];

    addGuidedEvent(events, { type: "start", at: 5 }, STEPS);

    expect(events).toEqual([]);
  });

  it("lehnt einen zweiten Start ab", () => {
    expect(() =>
      addGuidedEvent(START, { type: "start", at: at(1) }, STEPS),
    ).toThrow(/läuft bereits/);
  });
});

describe("Pause, Weiter und Schritt neu starten", () => {
  const PAUSED: GuidedEvent[] = [...START, { type: "pause", at: at(12) }];
  const RESUMED: GuidedEvent[] = [...PAUSED, { type: "resume", at: at(32) }];

  it("hält die Zeit an: während der Pause ändert sich nichts", () => {
    const early = deriveGuidedRunState(STEPS, PAUSED, at(13));
    const late = deriveGuidedRunState(STEPS, PAUSED, at(500));

    expect(early.phase).toBe("paused");
    expect(late.phase).toBe("paused");
    expect(late.elapsedSeconds).toBe(12);
    expect(late.current).toMatchObject({ kind: "exercise", stepIndex: 0 });
    expect(late.remainingSeconds).toBe(3);
  });

  it("verschiebt nach Weiter alles Spätere um die Dauer der Pause", () => {
    const state = deriveGuidedRunState(STEPS, RESUMED, at(34));

    expect(state.phase).toBe("exercise");
    expect(state.elapsedSeconds).toBe(14);
    expect(guidedRunEndsAt(STEPS, RESUMED)).toBe(at(63 + 20));
  });

  it("gibt es ohne Weiter kein Ende", () => {
    expect(guidedRunEndsAt(STEPS, PAUSED)).toBeNull();
  });

  it("lässt während der Pause kein Signal fällig werden und holt es danach zur neuen Zeit", () => {
    const paused = [
      ...START,
      { type: "pause", at: at(14.9) } satisfies GuidedEvent,
    ];

    expect(deriveGuidedRunState(STEPS, paused, at(15.2)).dueSignal).toBeNull();

    const resumed: GuidedEvent[] = [...paused, { type: "resume", at: at(30) }];

    expect(deriveGuidedRunState(STEPS, resumed, at(30.3)).dueSignal?.key).toBe(
      "exercise-end:1",
    );
  });

  it("rechnet mehrere Pausen zusammen", () => {
    const events: GuidedEvent[] = [
      ...RESUMED,
      { type: "pause", at: at(40) }, // gespielt: 12 + 8 = 20
      { type: "resume", at: at(100) },
    ];

    expect(deriveGuidedRunState(STEPS, events, at(105)).elapsedSeconds).toBe(
      25,
    );
    expect(guidedRunEndsAt(STEPS, events)).toBe(at(100 + 43));
  });

  it("startet die Übung neu: Sie beginnt wieder bei ihrem vollen Wert", () => {
    const events: GuidedEvent[] = [...START, { type: "restart", at: at(12) }];
    const state = deriveGuidedRunState(STEPS, events, at(12.5));

    expect(state.current).toMatchObject({ kind: "exercise", stepIndex: 0 });
    expect(state.remainingSeconds).toBe(10);
    expect(guidedRunEndsAt(STEPS, events)).toBe(at(12 + 58));
  });

  it("startet bei beidseitigen Schritten nur die aktuelle Seite neu", () => {
    // 50 s: Taube rechts (Beginn bei 43 s) - links bleibt erledigt.
    const events: GuidedEvent[] = [...START, { type: "restart", at: at(50) }];
    const state = deriveGuidedRunState(STEPS, events, at(50.5));

    expect(state.current).toMatchObject({ kind: "exercise", side: "right" });
    expect(state.remainingSeconds).toBe(20);
    expect(state.stepProgress[0]).toBe(1);
  });

  it("startet im Wechsel den Wechsel neu", () => {
    const events: GuidedEvent[] = [...START, { type: "restart", at: at(3) }];

    expect(deriveGuidedRunState(STEPS, events, at(3)).remainingSeconds).toBe(5);
  });

  it("bleibt beim Neustart in der Pause stehen und läuft mit Weiter von vorn", () => {
    const events: GuidedEvent[] = [
      ...START,
      { type: "pause", at: at(50) },
      { type: "restart", at: at(51) },
    ];

    expect(deriveGuidedRunState(STEPS, events, at(90))).toMatchObject({
      phase: "paused",
      remainingSeconds: 20,
    });

    const resumed: GuidedEvent[] = [...events, { type: "resume", at: at(100) }];

    expect(deriveGuidedRunState(STEPS, resumed, at(105)).remainingSeconds).toBe(
      15,
    );
  });

  it("lässt das Signal der neu gespielten Übung noch einmal klingen", () => {
    const events: GuidedEvent[] = [...START, { type: "restart", at: at(12) }];
    const first = deriveGuidedRunState(STEPS, START, at(15.2)).dueSignal?.key;
    const again = deriveGuidedRunState(STEPS, events, at(12 + 10 + 0.2))
      .dueSignal?.key;

    expect(first).toBe("exercise-end:1");
    expect(again).toBeTruthy();
    expect(again).not.toBe(first);
  });

  it("wirft eine springende Uhr nicht in die negative Zeit", () => {
    const events: GuidedEvent[] = [...START, { type: "pause", at: at(-5) }];

    expect(deriveGuidedRunState(STEPS, events, at(10)).elapsedSeconds).toBe(0);
  });
});

describe("addGuidedEvent: Pause, Weiter, Neustart", () => {
  it("lehnt Weiter ohne Pause ab", () => {
    expect(() =>
      addGuidedEvent(START, { type: "resume", at: at(1) }, STEPS),
    ).toThrow(/nicht pausiert/);
  });

  it("lehnt eine zweite Pause ab", () => {
    const paused = addGuidedEvent(START, { type: "pause", at: at(1) }, STEPS);

    expect(() =>
      addGuidedEvent(paused, { type: "pause", at: at(2) }, STEPS),
    ).toThrow(/schon pausiert/);
  });

  it("lehnt jedes Steuer-Ereignis vor dem Start ab", () => {
    for (const type of ["pause", "resume", "restart"] as const) {
      expect(() => addGuidedEvent([], { type, at: 1 }, STEPS)).toThrow(
        /noch nicht begonnen/,
      );
    }
  });

  it("nimmt Pause, Weiter und Neustart in gültiger Folge an", () => {
    let events = addGuidedEvent(START, { type: "pause", at: at(1) }, STEPS);

    events = addGuidedEvent(events, { type: "restart", at: at(2) }, STEPS);
    events = addGuidedEvent(events, { type: "resume", at: at(3) }, STEPS);

    expect(events.map((event) => event.type)).toEqual([
      "start",
      "pause",
      "restart",
      "resume",
    ]);
  });
});

describe("guidedRunEndsAt", () => {
  it("ist der Start plus die Gesamtdauer", () => {
    expect(guidedRunEndsAt(STEPS, START)).toBe(at(63));
  });

  it("gibt es ohne Start nicht", () => {
    expect(guidedRunEndsAt(STEPS, [])).toBeNull();
  });
});

describe("isGuidedSession", () => {
  it("erkennt eine Session mit Ablauf", () => {
    expect(isGuidedSession({ guided: { steps: STEPS, events: START } })).toBe(
      true,
    );
    expect(isGuidedSession({})).toBe(false);
    expect(isGuidedSession(undefined)).toBe(false);
  });
});

describe("Überspringen, +15 s, Zurück und Sofort starten", () => {
  // Abschnitte: Wechsel 5, Hund 10, Wechsel 5, Taube L 20, Seitenwechsel 3, Taube R 20,
  // Wechsel 5, Baum 10 - zusammen 78 s.
  const THREE: GuidedStep[] = [...STEPS, { name: "Baum", seconds: 10 }];
  const run = (...events: GuidedEvent[]) => [...START, ...events];

  describe("+15 s", () => {
    it("verlängert die laufende Übung und schiebt alles danach", () => {
      const events = run({ type: "extend", at: at(8) });
      const during = deriveGuidedRunState(STEPS, events, at(8));

      expect(during.phase).toBe("exercise");
      expect(during.remainingSeconds).toBe(22);
      expect(during.totalSeconds).toBe(78);
      expect(deriveGuidedRunState(STEPS, events, at(29)).phase).toBe(
        "exercise",
      );
      expect(deriveGuidedRunState(STEPS, events, at(31))).toMatchObject({
        phase: "transition",
        remainingSeconds: 4,
        stepIndex: 1,
      });
      expect(guidedRunEndsAt(STEPS, events)).toBe(at(78));
    });

    it("lässt sich wiederholen", () => {
      const events = run(
        { type: "extend", at: at(6) },
        { type: "extend", at: at(7) },
      );

      expect(deriveGuidedRunState(STEPS, events, at(7)).remainingSeconds).toBe(
        38,
      );
    });

    it("verlängert eine Seite und nicht den ganzen Schritt", () => {
      const events = run({ type: "extend", at: at(25) });

      expect(deriveGuidedRunState(STEPS, events, at(25)).remainingSeconds).toBe(
        30,
      );
      // Der Seitenwechsel beginnt erst nach den verlängerten 35 s der linken Seite.
      expect(deriveGuidedRunState(STEPS, events, at(56))).toMatchObject({
        current: { kind: "sideSwitch" },
      });
    });

    it("verschiebt das Signal ans neue Ende der Übung", () => {
      const events = run({ type: "extend", at: at(8) });

      expect(
        deriveGuidedRunState(STEPS, events, at(15.5)).dueSignal,
      ).toBeNull();
      expect(deriveGuidedRunState(STEPS, events, at(30.5)).dueSignal).toEqual({
        key: "exercise-end:1",
        dueAt: at(30),
      });
    });

    it("gilt nur in einer Übung", () => {
      expect(() =>
        addGuidedEvent(START, { type: "extend", at: at(2) }, STEPS),
      ).toThrow(/nur in einer Übung/);
      expect(() =>
        addGuidedEvent(run(), { type: "extend", at: at(41) }, STEPS),
      ).toThrow(/nur in einer Übung/);
      expect(
        addGuidedEvent(run(), { type: "extend", at: at(8) }, STEPS),
      ).toHaveLength(2);
    });
  });

  describe("Überspringen", () => {
    it("springt aus der Übung an den Anfang des nächsten Schritts", () => {
      const events = run({ type: "skip", at: at(8) });
      const state = deriveGuidedRunState(STEPS, events, at(8));

      expect(state).toMatchObject({
        phase: "transition",
        sectionIndex: 2,
        stepIndex: 1,
        elapsedSeconds: 15,
        remainingSeconds: 5,
      });
      expect(state.nextExercise).toMatchObject({ stepIndex: 1, side: "left" });
      expect(state.skippedStepIndexes).toEqual([0]);
    });

    it("löst für die übersprungene Übung kein Wechselsignal aus", () => {
      const skipped = run({ type: "skip", at: at(8) });

      expect(deriveGuidedRunState(STEPS, skipped, at(8)).dueSignal).toBeNull();
      expect(deriveGuidedRunState(STEPS, skipped, at(9)).dueSignal).toBeNull();
      // Ohne Überspringen klingt dasselbe Ende.
      expect(deriveGuidedRunState(STEPS, START, at(15.2)).dueSignal?.key).toBe(
        "exercise-end:1",
      );
    });

    it("lässt die nächsten Übungen mit ihrem Signal enden", () => {
      const events = run({ type: "skip", at: at(8) });

      // Taube links beginnt bei 20 und endet nach 20 s Spielzeit: Spielzeit 40 = Uhr 33.
      expect(deriveGuidedRunState(STEPS, events, at(33.3)).dueSignal?.key).toBe(
        "exercise-end:3",
      );
    });

    it("überspringt aus dem Wechsel den Schritt, in den er führt", () => {
      const events = run({ type: "skip", at: at(2) });
      const state = deriveGuidedRunState(STEPS, events, at(2));

      expect(state).toMatchObject({
        phase: "transition",
        stepIndex: 1,
        elapsedSeconds: 15,
      });
      expect(state.skippedStepIndexes).toEqual([0]);
    });

    it("überspringt bei einem beidseitigen Schritt beide Seiten", () => {
      const events = run({ type: "skip", at: at(25) });
      const state = deriveGuidedRunState(THREE, events, at(25));

      expect(state).toMatchObject({
        stepIndex: 2,
        current: { kind: "transition" },
      });
      expect(state.elapsedSeconds).toBe(63);
      expect(state.skippedStepIndexes).toEqual([1]);
    });

    it("beendet die Einheit, wenn der letzte Schritt übersprungen wird - ohne Signal", () => {
      const events = run({ type: "skip", at: at(25) });
      const state = deriveGuidedRunState(STEPS, events, at(25));

      expect(state.phase).toBe("finished");
      expect(state.dueSignal).toBeNull();
      expect(guidedRunEndsAt(STEPS, events)).toBe(at(25));
    });

    it("verkürzt die Einheit: das rechnerische Ende rückt vor", () => {
      expect(guidedRunEndsAt(STEPS, run({ type: "skip", at: at(8) }))).toBe(
        at(56),
      );
    });

    it("hält den Sprung über Zeit und Seitenwechsel hinweg - die Uhr läuft ab dort weiter", () => {
      const events = run({ type: "skip", at: at(8) });

      // 6 s nach dem Sprung: Spielzeit 21, eine Sekunde in Taube links.
      expect(deriveGuidedRunState(STEPS, events, at(14))).toMatchObject({
        phase: "exercise",
        stepIndex: 1,
        remainingSeconds: 19,
      });
    });

    it("lässt eine Pause nach dem Sprung die Zeit anhalten", () => {
      const events = run(
        { type: "skip", at: at(8) },
        { type: "pause", at: at(10) },
      );

      expect(deriveGuidedRunState(STEPS, events, at(300))).toMatchObject({
        phase: "paused",
        elapsedSeconds: 17,
      });
    });
  });

  describe("Zurück", () => {
    it("geht aus der Übung an den Anfang des vorigen Schritts", () => {
      const events = run({ type: "back", at: at(70) });
      const state = deriveGuidedRunState(THREE, events, at(70));

      // Uhr 70 liegt im Baum (Spielzeit 70); davor Taube - der Schritt davor ist Taube.
      expect(state).toMatchObject({
        phase: "transition",
        sectionIndex: 2,
        stepIndex: 1,
        elapsedSeconds: 15,
      });
    });

    it("geht über Seitenwechsel und beide Seiten hinweg an den Anfang des Schritts", () => {
      const events = run({ type: "back", at: at(76) });
      const state = deriveGuidedRunState(THREE, events, at(76));

      expect(state.current).toMatchObject({ kind: "transition", stepIndex: 1 });
      expect(state.nextExercise).toMatchObject({ stepIndex: 1, side: "left" });
    });

    it("geht aus der zweiten Seite an den Anfang des vorigen Schritts", () => {
      const events = run({ type: "back", at: at(50) });

      expect(deriveGuidedRunState(STEPS, events, at(50))).toMatchObject({
        stepIndex: 0,
        sectionIndex: 0,
        elapsedSeconds: 0,
      });
    });

    it("startet im ersten Schritt von vorn", () => {
      const events = run({ type: "back", at: at(8) });

      expect(deriveGuidedRunState(STEPS, events, at(8))).toMatchObject({
        sectionIndex: 0,
        elapsedSeconds: 0,
      });
    });

    it("lässt die Übungen noch einmal enden, mit eigenem Signal-Schlüssel", () => {
      const events = run({ type: "back", at: at(30) });

      // Zurück bei Uhr 30 auf Spielzeit 0; Hund endet bei Spielzeit 15 = Uhr 45.
      expect(deriveGuidedRunState(STEPS, events, at(45.2)).dueSignal?.key).toBe(
        "exercise-end:1:1",
      );
    });

    it("macht ein Überspringen rückgängig: die Übung klingt beim Spielen wieder", () => {
      const events = run(
        { type: "skip", at: at(8) },
        { type: "back", at: at(9) },
      );

      expect(deriveGuidedRunState(STEPS, events, at(9)).elapsedSeconds).toBe(0);
      expect(deriveGuidedRunState(STEPS, events, at(24.2)).dueSignal?.key).toBe(
        "exercise-end:1:1",
      );
      expect(
        deriveGuidedRunState(STEPS, events, at(9)).skippedStepIndexes,
      ).toEqual([]);
    });

    it("verwirft eine Verlängerung beim Zurückspringen: der neue Durchgang hat seine eigene Dauer", () => {
      const extended = run({ type: "extend", at: at(8) });
      const events = run(
        { type: "extend", at: at(8) },
        { type: "back", at: at(9) },
      );

      expect(deriveGuidedRunState(STEPS, extended, at(9)).totalSeconds).toBe(78);
      expect(deriveGuidedRunState(STEPS, events, at(9)).totalSeconds).toBe(63);
    });
  });

  describe("Sofort starten", () => {
    it("beendet den Wechsel und beginnt die Übung", () => {
      const events = run({ type: "startNow", at: at(2) });
      const state = deriveGuidedRunState(STEPS, events, at(2));

      expect(state).toMatchObject({
        phase: "exercise",
        sectionIndex: 1,
        remainingSeconds: 10,
        elapsedSeconds: 5,
      });
      expect(guidedRunEndsAt(STEPS, events)).toBe(at(60));
    });

    it("beendet auch den Seitenwechsel", () => {
      const events = run({ type: "startNow", at: at(41) });

      expect(deriveGuidedRunState(STEPS, events, at(41))).toMatchObject({
        phase: "exercise",
        current: { kind: "exercise", side: "right" },
      });
    });

    it("gilt nur im Wechsel", () => {
      expect(() =>
        addGuidedEvent(run(), { type: "startNow", at: at(8) }, STEPS),
      ).toThrow(/nur im Wechsel/);
      expect(
        addGuidedEvent(run(), { type: "startNow", at: at(2) }, STEPS),
      ).toHaveLength(2);
    });
  });

  it("lehnt jedes der neuen Ereignisse vor dem Start, in der Pause und nach dem Ende ab", () => {
    for (const type of ["skip", "extend", "back", "startNow"] as const) {
      expect(() => addGuidedEvent([], { type, at: 1 }, STEPS)).toThrow(
        /noch nicht begonnen/,
      );
      expect(() =>
        addGuidedEvent(
          run({ type: "pause", at: at(8) }),
          { type, at: at(9) },
          STEPS,
        ),
      ).toThrow(/pausiert/);
      expect(() => addGuidedEvent(run(), { type, at: at(100) }, STEPS)).toThrow(
        /zu Ende/,
      );
    }
  });
});

describe("deriveGuidedProtocol", () => {
  // Übungen: Hund 0-5..15 (10 s), Taube L 20-40, Taube R 43-63.
  const ev = (type: GuidedEvent["type"], seconds: number): GuidedEvent => ({
    type,
    at: at(seconds),
  });

  it("nennt nach dem glatten Durchlauf jeden Schritt und jede Seite als gemacht", () => {
    expect(deriveGuidedProtocol(STEPS, START, at(63))).toEqual([
      { stepIndex: 0, name: "Hund", status: "done", plannedSeconds: 10, actualSeconds: 10 },
      { stepIndex: 1, name: "Taube", side: "left", status: "done", plannedSeconds: 20, actualSeconds: 20 },
      { stepIndex: 1, name: "Taube", side: "right", status: "done", plannedSeconds: 20, actualSeconds: 20 },
    ]);
  });

  it("zählt Wechsel und Seitenwechsel nicht als Zeile", () => {
    expect(deriveGuidedProtocol(STEPS, START, at(63))).toHaveLength(3);
  });

  it("markiert eine übersprungene Übung mit der gespielten Zeit", () => {
    // Hund läuft von 5 bis 8, dann Überspringen.
    const protocol = deriveGuidedProtocol(
      STEPS,
      [...START, ev("skip", 8)],
      at(8 + 5 + 20 + 3 + 20 + 5),
    );

    expect(protocol[0]).toMatchObject({ name: "Hund", status: "skipped", plannedSeconds: 10, actualSeconds: 3 });
    expect(protocol[1]).toMatchObject({ side: "left", status: "done", actualSeconds: 20 });
  });

  it("überspringt im Wechsel den Schritt, in den er führt, mit null Sekunden", () => {
    const protocol = deriveGuidedProtocol(STEPS, [...START, ev("skip", 2)], at(100));

    expect(protocol[0]).toMatchObject({ name: "Hund", status: "skipped", actualSeconds: 0 });
  });

  it("markiert beide Seiten als übersprungen, wenn auf der ersten übersprungen wird", () => {
    // Taube links ab 20 s; Überspringen bei 25 s.
    const protocol = deriveGuidedProtocol(STEPS, [...START, ev("skip", 25)], at(30));

    expect(protocol[0]).toMatchObject({ name: "Hund", status: "done" });
    expect(protocol[1]).toMatchObject({ side: "left", status: "skipped", actualSeconds: 5 });
    expect(protocol[2]).toMatchObject({ side: "right", status: "skipped", actualSeconds: 0 });
  });

  it("markiert eine verlängerte Übung mit Soll ohne und Ist mit den 15 s", () => {
    const protocol = deriveGuidedProtocol(STEPS, [...START, ev("extend", 7)], at(100));

    expect(protocol[0]).toEqual({
      stepIndex: 0,
      name: "Hund",
      status: "extended",
      plannedSeconds: 10,
      actualSeconds: 25,
    });
    expect(protocol[1].status).toBe("done");
  });

  it("zählt die Pause nicht zur Dauer", () => {
    // Hund von 5 s, Pause bei 8 s für 30 s, Weiter - Ende 30 s später.
    const events = [...START, ev("pause", 8), ev("resume", 38)];
    const protocol = deriveGuidedProtocol(STEPS, events, at(100));

    expect(protocol[0]).toMatchObject({ status: "done", actualSeconds: 10 });
    expect(protocol).toHaveLength(3);
  });

  it("zählt bei einem Neustart nur den letzten Durchgang", () => {
    // Hund von 5 s, Neustart bei 9 s: neuer Durchgang 10 s.
    const protocol = deriveGuidedProtocol(STEPS, [...START, ev("restart", 9)], at(100));

    expect(protocol[0]).toMatchObject({ status: "done", actualSeconds: 10 });
  });

  it("führt nach Zurück den erneut gemachten Schritt mit dem zweiten Durchgang", () => {
    // Hund fertig bei 15 s, Taube links ab 20 s; Zurück bei 22 s: Hund neu ab 22 s.
    const events = [...START, ev("back", 22)];
    const protocol = deriveGuidedProtocol(STEPS, events, at(22 + 5 + 10 + 5 + 20 + 3 + 20));

    expect(protocol).toHaveLength(3);
    expect(protocol[0]).toMatchObject({ name: "Hund", status: "done", actualSeconds: 10 });
    expect(protocol[1]).toMatchObject({ side: "left", status: "done", actualSeconds: 20 });
  });

  it("verwirft ein „+15 s“ vor Zurück: der Replay hat seine eigene Dauer", () => {
    // +15 s im Hund (7 s), Zurück bei 30 s im ersten Schritt neu.
    const events = [...START, ev("extend", 7), ev("back", 30)];
    const protocol = deriveGuidedProtocol(STEPS, events, at(30 + 5 + 10 + 5 + 20 + 3 + 20));

    expect(protocol[0]).toMatchObject({ status: "done", plannedSeconds: 10, actualSeconds: 10 });
  });

  it("lässt bei einem Abbruch nicht erreichte Übungen weg und nennt die laufende abgebrochen", () => {
    // Hund fertig bei 15 s, Taube links läuft von 20 s, Abbruch bei 28 s.
    const protocol = deriveGuidedProtocol(STEPS, START, at(28));

    expect(protocol).toEqual([
      { stepIndex: 0, name: "Hund", status: "done", plannedSeconds: 10, actualSeconds: 10 },
      { stepIndex: 1, name: "Taube", side: "left", status: "aborted", plannedSeconds: 20, actualSeconds: 8 },
    ]);
  });

  it("ist vor dem Start und im ersten Wechsel leer", () => {
    expect(deriveGuidedProtocol(STEPS, [], at(10))).toEqual([]);
    expect(deriveGuidedProtocol(STEPS, START, at(3))).toEqual([]);
  });

  it("zählt bei einer Pause zum Abbruch nur die gelaufene Zeit", () => {
    const events = [...START, ev("pause", 8)];
    const protocol = deriveGuidedProtocol(STEPS, events, at(500));

    expect(protocol).toEqual([
      { stepIndex: 0, name: "Hund", status: "aborted", plannedSeconds: 10, actualSeconds: 3 },
    ]);
  });
});

describe("fällige Ansage", () => {
  it("nennt im ersten Wechsel vor Schritt 1 die erste Übung", () => {
    const state = deriveGuidedRunState(STEPS, START, at(0.3));

    expect(state.dueAnnouncement).toEqual({
      key: "announce:start",
      text: "Als Nächstes: Hund, 10 Sekunden",
      dueAt: at(0),
    });
  });

  it("kommt im ersten Wechsel nicht mehr, wenn er länger als 2 s läuft", () => {
    expect(deriveGuidedRunState(STEPS, START, at(2.5)).dueAnnouncement).toBeNull();
    expect(deriveGuidedRunState(STEPS, START, at(4)).dueAnnouncement).toBeNull();
  });

  it("folgt dem Wechselsignal mit der nächsten Übung samt Seite", () => {
    const state = deriveGuidedRunState(STEPS, START, at(15.2));

    expect(state.dueSignal?.key).toBe("exercise-end:1");
    expect(state.dueAnnouncement).toEqual({
      key: "announce:exercise-end:1",
      text: "Als Nächstes: Taube, links, 20 Sekunden",
      dueAt: at(15),
    });
  });

  it("nennt nach der linken Seite die rechte", () => {
    expect(deriveGuidedRunState(STEPS, START, at(40.5)).dueAnnouncement).toMatchObject({
      key: "announce:exercise-end:3",
      text: "Als Nächstes: Taube, rechts, 20 Sekunden",
    });
  });

  it("sagt am Ende der letzten Übung „Geschafft.“", () => {
    const state = deriveGuidedRunState(STEPS, START, at(63.5));

    expect(state.phase).toBe("finished");
    expect(state.dueAnnouncement).toMatchObject({
      key: "announce:exercise-end:5",
      text: "Geschafft.",
    });
  });

  it("nimmt den Sprechnamen vor dem Namen", () => {
    const steps: GuidedStep[] = [{ name: "BWS", spokenName: "Brustwirbelsäule", seconds: 10 }];

    expect(deriveGuidedRunState(steps, START, at(0.1)).dueAnnouncement?.text).toBe(
      "Als Nächstes: Brustwirbelsäule, 10 Sekunden",
    );
  });

  it("gilt etwa 2 Sekunden lang wie das Signal", () => {
    const fresh = at(15) + GUIDED_SIGNAL_MAX_DELAY_MS;

    expect(deriveGuidedRunState(STEPS, START, fresh).dueAnnouncement).not.toBeNull();
    expect(deriveGuidedRunState(STEPS, START, fresh + 1).dueAnnouncement).toBeNull();
  });

  it("holt nach der Rückkehr aus dem Hintergrund nichts nach", () => {
    expect(deriveGuidedRunState(STEPS, START, at(63 + 180)).dueAnnouncement).toBeNull();
    expect(deriveGuidedRunState(STEPS, START, at(42.5)).dueAnnouncement).toBeNull();
  });

  it("kommt weder im Wechsel noch mitten in der Übung noch in der Pause", () => {
    expect(deriveGuidedRunState(STEPS, START, at(8)).dueAnnouncement).toBeNull();
    expect(deriveGuidedRunState(STEPS, START, at(30)).dueAnnouncement).toBeNull();

    const paused: GuidedEvent[] = [...START, { type: "pause", at: at(15.1) }];

    expect(deriveGuidedRunState(STEPS, paused, at(15.3)).dueAnnouncement).toBeNull();
    expect(deriveGuidedRunState(STEPS, [], at(0.3)).dueAnnouncement).toBeNull();
  });

  it("behält den Schlüssel über Pause und Weiter, damit sie nicht doppelt kommt", () => {
    const events: GuidedEvent[] = [
      ...START,
      { type: "pause", at: at(0.5) },
      { type: "resume", at: at(30) },
    ];

    expect(deriveGuidedRunState(STEPS, events, at(30.5)).dueAnnouncement?.key).toBe(
      "announce:start",
    );
  });

  it("sagt nach einem Neustart oder Zurück erneut an, mit eigener Nummer", () => {
    const events: GuidedEvent[] = [...START, { type: "restart", at: at(12) }];
    const again = deriveGuidedRunState(STEPS, events, at(12 + 10 + 0.2));

    expect(again.dueAnnouncement?.key).toBe("announce:exercise-end:1:1");

    const back: GuidedEvent[] = [...START, { type: "back", at: at(20) }];

    expect(deriveGuidedRunState(STEPS, back, at(20.4)).dueAnnouncement).toMatchObject({
      key: "announce:jump:1",
      text: "Als Nächstes: Hund, 10 Sekunden",
    });
  });

  it("nennt nach dem Überspringen gleich die Übung, in die der Sprung führt", () => {
    const events: GuidedEvent[] = [...START, { type: "skip", at: at(8) }];

    expect(deriveGuidedRunState(STEPS, events, at(8.2)).dueAnnouncement).toEqual({
      key: "announce:jump:1",
      text: "Als Nächstes: Taube, links, 20 Sekunden",
      dueAt: at(8),
    });
    expect(deriveGuidedRunState(STEPS, events, at(8 + 2.5)).dueAnnouncement).toBeNull();
  });

  it("schweigt am Ende einer übersprungenen Übung - wie das Signal", () => {
    // Übersprungen in der Übung Hund (5-15 s): sie endet nie.
    const events: GuidedEvent[] = [...START, { type: "skip", at: at(14) }];

    expect(deriveGuidedRunState(STEPS, events, at(16.5)).dueAnnouncement).toBeNull();
  });

  it("zählt Sprünge im Schlüssel, damit jeder einmal ansagt", () => {
    const events: GuidedEvent[] = [
      ...START,
      { type: "skip", at: at(8) },
      { type: "back", at: at(12) },
    ];

    expect(deriveGuidedRunState(STEPS, events, at(12.3)).dueAnnouncement).toMatchObject({
      key: "announce:jump:2",
      text: "Als Nächstes: Hund, 10 Sekunden",
    });
  });

  it("nennt nach Zurück die Übung des vorigen Schritts", () => {
    const events: GuidedEvent[] = [...START, { type: "back", at: at(50) }];

    expect(deriveGuidedRunState(STEPS, events, at(50.3)).dueAnnouncement).toMatchObject({
      key: "announce:jump:1",
      text: "Als Nächstes: Hund, 10 Sekunden",
    });
  });

  it("sagt „Geschafft.“, wenn das Überspringen der letzten Übung die Einheit beendet", () => {
    const events: GuidedEvent[] = [...START, { type: "skip", at: at(30) }];
    const state = deriveGuidedRunState(STEPS, events, at(30.2));

    expect(state.phase).toBe("finished");
    expect(state.dueAnnouncement).toMatchObject({
      key: "announce:jump:1",
      text: "Geschafft.",
    });
  });
});
