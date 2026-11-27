import {
  GUIDED_PAUSE_MIN_SECONDS,
  resolveGuidedSections,
  sumGuidedSeconds,
  type GuidedSection,
} from "@/domain/guided-steps";
import {
  GUIDED_DONE_TEXT,
  buildNextAnnouncement,
} from "@/domain/guided-announcements";
import type {
  GuidedEvent,
  GuidedProtocolEntry,
  GuidedStep,
  WorkoutSession,
} from "@/domain/models";

/*
 * Der Ablauf einer geführten Einheit.
 *
 * Aus dem Schritt-Snapshot, der Ereignisliste und `now` (Millisekunden) wird
 * der **Ablaufstand** abgeleitet: Phase, aktueller und nächster Abschnitt,
 * Restzeit, Fortschritt und das fällige Signal. Es gibt keine Uhr und keinen
 * Seiteneffekt - wie bei `set-timer.ts` kommt `now` als Parameter, und der
 * Stand ist an jedem Zeitpunkt neu berechenbar. Deshalb überlebt die Einheit
 * Reload und Hintergrund: die Zeit stimmt, was fehlt, ist nur ein verpasstes
 * Signal, und das fällt nach der Frische-Regel weg.
 *
 * Die Abschnitte kommen aus `resolveGuidedSections` und werden hier nicht
 * nachgerechnet. Ereignisse sind eine Union: Pause, Weiter, Neustart,
 * Überspringen, +15 s, Zurück und Sofort starten falten sich in
 * `foldTimeline` in die Spielzeit, weitere Eingriffe kommen als weitere Typen
 * dazu - der Rest dieses Moduls liest nur diese.
 *
 * Die Spielzeit steht als Abschnitt plus Versatz darin, nicht als Sekunde auf
 * der Basis-Abfolge: ein „+15 s“ macht einen Abschnitt länger und schiebt alle
 * danach. Die Abfolge, auf der der Stand gerechnet wird, ist deshalb die
 * *wirksame* (`Timeline.sections`), nicht die aufgelöste.
 */

/** So viel verlängert „+15 s“ die laufende Übung. */
export const GUIDED_EXTEND_SECONDS = 15;

/**
 * Ab dieser Verspätung bleibt ein Signal aus - dieselbe Regel und derselbe
 * Wert wie bei den Satz-Timer-Ansagen: der Sekundentakt kann knapp vor dem
 * Zeitpunkt abtasten, die nächste Probe kommt gut eine Sekunde später.
 */
export const GUIDED_SIGNAL_MAX_DELAY_MS = 2000;

/**
 * Ab dieser Verspätung bleibt ein Countdown- oder Start-Ton aus: kürzer als
 * der Abstand zweier Töne (1 s), damit keiner in den nächsten fällt, länger
 * als ein Tick des Run-Screens (250 ms). Nach einer Rückkehr aus dem
 * Hintergrund wird nichts nachgeholt.
 */
export const GUIDED_COUNT_MAX_DELAY_MS = 600;

export type GuidedPhase = "transition" | "exercise" | "paused" | "finished";

/**
 * Welcher Ton: das Signal am Ende einer Übung, ein Countdown-Ton bei 3, 2, 1
 * Sekunden Rest eines langen Wechsels oder der Start-Ton an seinem Ende.
 */
export type GuidedSignalKind = "exercise-end" | "count" | "go";

/** Ein fälliges Signal. Den `key` merkt sich der Aufrufer, damit es nicht doppelt klingt. */
export interface GuidedDueSignal {
  kind: GuidedSignalKind;
  key: string;
  /** Wann es fällig wurde (ms). */
  dueAt: number;
}

/**
 * Eine fällige Ansage: der Satz und der Schlüssel, den sich der Aufrufer
 * merkt. Nur „Stimme + Ton“ spielt sie; ob das gilt, weiß der Aufrufer.
 */
export interface GuidedDueAnnouncement {
  key: string;
  text: string;
  /** Wann sie fällig wurde (ms). */
  dueAt: number;
}

export interface GuidedRunState {
  /**
   * Wechsel und Seitenwechsel zählen beide als `transition`. Bei `paused`
   * stehen `current` und die Zeiten, wo die Zeit stehen blieb.
   */
  phase: GuidedPhase;
  /** Index in der aufgelösten Abfolge; bei `finished` deren Länge. */
  sectionIndex: number;
  current: GuidedSection | null;
  /** Die nächste Übung nach dem jetzigen Abschnitt; im Wechsel die, in die er führt. */
  nextExercise: GuidedSection | null;
  /** Der Schritt, in dem man gerade ist; bei `finished` der letzte. */
  stepIndex: number;
  /** Restzeit des jetzigen Abschnitts, aufgerundet. */
  remainingSeconds: number;
  elapsedSeconds: number;
  totalSeconds: number;
  remainingTotalSeconds: number;
  /** 0 bis 1 über die ganze Einheit. */
  progress: number;
  /** 0 bis 1 je Schritt - die Segmente des Fortschrittsbalkens. */
  stepProgress: number[];
  /** Schritte, von denen eine Übung übersprungen wurde - der Abschluss zählt sie nicht als gemacht. */
  skippedStepIndexes: number[];
  dueSignal: GuidedDueSignal | null;
  /** Die Ansage dazu: frisch wie das Signal, ohne Doppelung über den Schlüssel. */
  dueAnnouncement: GuidedDueAnnouncement | null;
}

/** Ob die Session eine geführte ist: sie trägt einen Ablauf. */
export function isGuidedSession(
  session?: Pick<WorkoutSession, "guided"> | null,
): boolean {
  return Boolean(session?.guided);
}

function findStart(events: readonly GuidedEvent[]) {
  return events.find((event) => event.type === "start");
}

/** Ob die Einheit gestartet ist und gerade steht. */
function isPausedByEvents(events: readonly GuidedEvent[]): boolean {
  let paused = false;

  for (const event of events) {
    if (event.type === "pause") {
      paused = true;
    } else if (event.type === "resume") {
      paused = false;
    }
  }

  return paused;
}

interface Timeline {
  /** Die wirksame Abfolge: Verlängerungen eingerechnet, `startSeconds` neu gelegt. */
  sections: GuidedSection[];
  /** Die Spielzeit (ms) auf der wirksamen Abfolge, ohne Pausen, begrenzt auf die Gesamtdauer. */
  positionMs: number;
  /** Wie `positionMs`, aber ohne Begrenzung: wie weit die Zeit über das Ende hinaus lief. */
  rawPositionMs: number;
  /** Seit wann die Zeit läuft; `null`, solange sie steht oder der Start fehlt. */
  runningSince: number | null;
  /** Abschnitte der Abfolge, deren Ende kein Signal auslöst: sie wurden übersprungen. */
  skipped: ReadonlySet<number>;
  /**
   * Wechsel der Abfolge, die „Sofort starten“ beendet hat: ihr Countdown und
   * ihr Start-Ton entfallen - wer tippt, weiß, dass es losgeht.
   */
  cutShort: ReadonlySet<number>;
  /** Wie oft die Zeit zurückgesprungen ist (Neustart, Zurück) - Teil des Signal-Schlüssels. */
  rewinds: number;
  /**
   * Der letzte Sprung (Überspringen, Zurück): seine Nummer, wo er landete
   * (ms auf der wirksamen Abfolge) und ab welchem Abschnitt die nächste Übung
   * gesucht wird - hinter dem letzten heißt: zu Ende.
   */
  lastJump: { count: number; atMs: number; from: number } | null;
  /**
   * Wie lange (ms) die Zeit je Abschnitt der wirksamen Abfolge gelaufen ist,
   * ohne Pausen - nur der letzte Durchgang: Neustart und Zurück setzen zurück.
   */
  playedMs: number[];
  /** Index des Abschnitts, in dem die Zeit am Ende steht. */
  index: number;
  /** Ob die Zeit das Ende des letzten Abschnitts erreicht hat. */
  isOver: boolean;
}

function layOut(
  sections: readonly GuidedSection[],
  extra: readonly number[],
): GuidedSection[] {
  let startSeconds = 0;

  return sections.map((section, index) => {
    const seconds = section.seconds + (extra[index] ?? 0);
    const laid = { ...section, seconds, startSeconds };

    startSeconds += seconds;

    return laid;
  });
}

/**
 * Faltet die Ereignisse zur Spielzeit bis `until`: die Zeit läuft zwischen
 * Start/Weiter und Pause. Ein Neustart springt auf den Anfang des Abschnitts,
 * in dem die Einheit gerade steht (die Seite bei beidseitigen Schritten, der
 * Wechsel im Wechsel). Überspringen springt an den Anfang des nächsten
 * Schritts und merkt sich die übergangenen Übungen (kein Wechselsignal),
 * Zurück an den Anfang des vorigen, +15 s verlängert die laufende Übung,
 * Sofort starten beendet den Wechsel. Ein Zeitstempel vor dem vorigen
 * Ereignis zählt als dessen Zeitpunkt, damit eine springende Uhr keine
 * negative Zeit ergibt. Ein Ereignis, das nicht (mehr) passt - etwa +15 s im
 * Wechsel -, ändert nichts: `addGuidedEvent` hält es fern, hier bleibt die
 * Rechnung bei einer alten oder importierten Liste trotzdem gültig.
 */
function foldTimeline(
  baseSections: readonly GuidedSection[],
  events: readonly GuidedEvent[],
  until: number,
): Timeline {
  const count = baseSections.length;
  const extra: number[] = baseSections.map(() => 0);
  const skipped = new Set<number>();
  const cutShort = new Set<number>();
  const playedMs: number[] = baseSections.map(() => 0);
  let sections = layOut(baseSections, extra);
  let index = 0;
  let offsetMs = 0;
  let runningSince: number | null = null;
  let rewinds = 0;
  let lastJump: Timeline["lastJump"] = null;
  let lastAt = Number.NEGATIVE_INFINITY;

  const lengthMs = (at: number) => (sections[at]?.seconds ?? 0) * 1000;
  const isOver = () => index >= count - 1 && offsetMs >= lengthMs(count - 1);

  /** Läuft die Zeit bis `time` weiter und rückt in den Abschnitt, in dem sie dann steht. */
  const advance = (time: number) => {
    if (runningSince !== null) {
      let delta = Math.max(0, time - runningSince);

      runningSince = time;

      // Die Zeit je Abschnitt festhalten: eine Strecke über eine Grenze wird geteilt.
      while (delta > 0) {
        const room =
          index >= count - 1
            ? delta
            : Math.max(0, lengthMs(index) - offsetMs);
        const used = Math.min(delta, room);

        // Hinter dem Ende des letzten Abschnitts läuft nichts mehr mit.
        playedMs[index] += Math.min(used, Math.max(0, lengthMs(index) - offsetMs));
        offsetMs += used;
        delta -= used;

        if (delta > 0) {
          offsetMs -= lengthMs(index);
          index += 1;
        }
      }
    }

    while (index < count - 1 && offsetMs >= lengthMs(index)) {
      offsetMs -= lengthMs(index);
      index += 1;
    }
  };

  const jumpTo = (target: number) => {
    index = target;
    offsetMs = 0;
  };

  const noteJump = (from: number) => {
    lastJump = {
      count: (lastJump?.count ?? 0) + 1,
      atMs: (sections[index].startSeconds * 1000) + offsetMs,
      from,
    };
  };

  const firstSectionOfStep = (stepIndex: number) =>
    Math.max(
      0,
      baseSections.findIndex((section) => section.stepIndex === stepIndex),
    );

  for (const event of events) {
    const at = Math.max(event.at, lastAt);

    lastAt = at;

    if (event.type === "start") {
      index = 0;
      offsetMs = 0;
      runningSince = at;
      continue;
    }

    advance(at);

    if (count === 0) {
      continue;
    }

    switch (event.type) {
      case "pause":
        runningSince = null;
        break;
      case "resume":
        runningSince = at;
        break;
      case "restart":
        if (!isOver()) {
          offsetMs = 0;
          playedMs[index] = 0;
          rewinds += 1;
        }
        break;
      case "extend":
        if (!isOver() && sections[index].kind === "exercise") {
          extra[index] += GUIDED_EXTEND_SECONDS;
          sections = layOut(baseSections, extra);
        }
        break;
      case "startNow":
        if (!isOver() && sections[index].kind !== "exercise") {
          cutShort.add(index);
          jumpTo(index + 1);
        }
        break;
      case "skip": {
        if (isOver()) {
          break;
        }

        const nextStart = baseSections.findIndex(
          (section) => section.stepIndex > sections[index].stepIndex,
        );
        const target = nextStart < 0 ? count : nextStart;

        // Die übergangenen Übungen enden nicht, sie werden verlassen: kein Signal.
        for (let passed = index; passed < target; passed += 1) {
          if (sections[passed].kind === "exercise") {
            skipped.add(passed);
          }
        }

        if (target >= count) {
          index = count - 1;
          offsetMs = lengthMs(count - 1);
        } else {
          jumpTo(target);
        }
        noteJump(target);
        break;
      }
      case "back": {
        if (isOver()) {
          break;
        }

        const target = firstSectionOfStep(
          Math.max(0, sections[index].stepIndex - 1),
        );

        // Was ab hier noch einmal läuft, endet wieder mit Signal und mit seiner
        // eigenen Dauer: ein „+15 s“ galt dem vorigen Durchgang.
        for (const passed of [...skipped]) {
          if (passed >= target) {
            skipped.delete(passed);
          }
        }

        for (const passed of [...cutShort]) {
          if (passed >= target) {
            cutShort.delete(passed);
          }
        }

        for (let again = target; again < count; again += 1) {
          extra[again] = 0;
          playedMs[again] = 0;
        }

        sections = layOut(baseSections, extra);

        jumpTo(target);
        noteJump(target);
        rewinds += 1;
        break;
      }
    }
  }

  advance(Math.max(until, lastAt));

  const totalMs = sumGuidedSeconds(sections) * 1000;
  const startMs = (sections[index]?.startSeconds ?? 0) * 1000;
  const rawPositionMs = startMs + offsetMs;

  return {
    sections,
    positionMs: Math.min(totalMs, rawPositionMs),
    rawPositionMs,
    runningSince,
    skipped,
    cutShort,
    rewinds,
    lastJump,
    playedMs,
    index,
    isOver: index >= count - 1 && offsetMs >= lengthMs(count - 1),
  };
}

/**
 * Hängt ein Ereignis an. Rein und ohne Mutation; ein sinnloses Ereignis wirft
 * eine Meldung auf Deutsch, die die Aktion weiterreicht.
 */
export function addGuidedEvent(
  events: readonly GuidedEvent[],
  event: GuidedEvent,
  steps: readonly GuidedStep[],
): GuidedEvent[] {
  const started = Boolean(findStart(events));

  if (event.type === "start") {
    if (started) {
      throw new Error("Die Einheit läuft bereits.");
    }
  } else if (!started) {
    throw new Error("Die Einheit hat noch nicht begonnen.");
  } else if (event.type === "pause" && isPausedByEvents(events)) {
    throw new Error("Die Einheit ist schon pausiert.");
  } else if (event.type === "resume" && !isPausedByEvents(events)) {
    throw new Error("Die Einheit ist nicht pausiert.");
  } else if (
    event.type === "skip" ||
    event.type === "extend" ||
    event.type === "back" ||
    event.type === "startNow"
  ) {
    const state = deriveGuidedRunState(steps, events, event.at);

    if (state.phase === "finished") {
      throw new Error("Die Einheit ist schon zu Ende.");
    }

    if (state.phase === "paused") {
      throw new Error("Die Einheit ist pausiert.");
    }

    if (event.type === "extend" && state.current?.kind !== "exercise") {
      throw new Error("Verlängern geht nur in einer Übung.");
    }

    if (event.type === "startNow" && state.current?.kind === "exercise") {
      throw new Error("Sofort starten geht nur im Wechsel.");
    }
  }

  return [...events, event];
}

/**
 * Der Zeitpunkt (ms), an dem die Einheit ohne weitere Eingriffe endet - `null`
 * vor dem Start und solange sie pausiert ist.
 */
export function guidedRunEndsAt(
  steps: readonly GuidedStep[],
  events: readonly GuidedEvent[],
): number | null {
  if (!findStart(events)) {
    return null;
  }

  const lastAt = events.reduce(
    (latest, event) => Math.max(latest, event.at),
    0,
  );
  const { sections, positionMs, runningSince } = foldTimeline(
    resolveGuidedSections(steps),
    events,
    lastAt,
  );

  return runningSince === null
    ? null
    : lastAt + (sumGuidedSeconds(sections) * 1000 - positionMs);
}

/**
 * Das Signal, das zur Zeit fällig ist - und `null`, wenn keines frisch fällig
 * ist oder die Zeit steht.
 *
 * Am Ende jeder Übung das Übungsende-Signal (Frische
 * `GUIDED_SIGNAL_MAX_DELAY_MS`). Ein Wechsel, der tatsächlich mindestens
 * `GUIDED_PAUSE_MIN_SECONDS` dauert, zählt bei 3, 2 und 1 Sekunden Rest
 * herunter und endet mit dem Start-Ton (Frische `GUIDED_COUNT_MAX_DELAY_MS`) -
 * außer „Sofort starten“ hat ihn beendet. Sind mehrere frisch, gewinnt das
 * jüngste. Ein Neustart oder Zurück hängt seine Nummer an den Schlüssel: was
 * neu gespielt wird, endet noch einmal und soll noch einmal klingen. Eine
 * übersprungene Übung endet nie - ohne Signal.
 */
function findDueSignal(
  timeline: Timeline,
  now: number,
): GuidedDueSignal | null {
  if (timeline.runningSince === null) {
    return null;
  }

  const suffix = timeline.rewinds > 0 ? `:${timeline.rewinds}` : "";
  let due: GuidedDueSignal | null = null;
  let dueDelay = Number.POSITIVE_INFINITY;

  const consider = (
    kind: GuidedSignalKind,
    key: string,
    atMs: number,
    maxDelayMs: number,
  ) => {
    const delay = timeline.rawPositionMs - atMs;

    if (delay >= 0 && delay <= maxDelayMs && delay <= dueDelay) {
      due = { kind, key: `${key}${suffix}`, dueAt: now - delay };
      dueDelay = delay;
    }
  };

  timeline.sections.forEach((section, index) => {
    const endMs = (section.startSeconds + section.seconds) * 1000;

    if (section.kind === "exercise" && !timeline.skipped.has(index)) {
      consider("exercise-end", `exercise-end:${index}`, endMs, GUIDED_SIGNAL_MAX_DELAY_MS);
    }

    if (
      section.kind === "transition" &&
      section.seconds >= GUIDED_PAUSE_MIN_SECONDS &&
      !timeline.cutShort.has(index)
    ) {
      for (const n of [3, 2, 1]) {
        consider("count", `pause-count:${index}:${n}`, endMs - n * 1000, GUIDED_COUNT_MAX_DELAY_MS);
      }

      consider("go", `pause-go:${index}`, endMs, GUIDED_COUNT_MAX_DELAY_MS);
    }
  });

  return due;
}

/**
 * Die Ansage, die zur Zeit fällig ist - mit derselben Frische-Regel wie das
 * Signal und `null`, wenn die Zeit steht.
 *
 * Drei Anlässe: der Anfang des ersten Wechsels (die erste Übung, ohne Signal
 * davor), ein Sprung durch Überspringen oder Zurück (die Übung, in die er
 * führt, ohne Signal davor; endet die Einheit damit, „Geschafft.“) und das
 * Ende einer Übung, gleichzeitig mit ihrem Signal (die nächste Übung samt
 * Seite, nach der letzten „Geschafft.“). Der Schlüssel trägt wie der des
 * Signals die Nummer nach Neustart oder Zurück, der eines Sprungs dessen
 * Nummer. Eine übersprungene Übung endet nie und sagt an ihrem Ende nichts an.
 */
function findDueAnnouncement(
  timeline: Timeline,
  steps: readonly GuidedStep[],
  now: number,
): GuidedDueAnnouncement | null {
  if (timeline.runningSince === null) {
    return null;
  }

  const suffix = timeline.rewinds > 0 ? `:${timeline.rewinds}` : "";
  const textFrom = (from: number): string => {
    const next = timeline.sections.find(
      (section, index) => index >= from && section.kind === "exercise",
    );

    return next
      ? buildNextAnnouncement(steps[next.stepIndex], next.side)
      : GUIDED_DONE_TEXT;
  };

  let due: GuidedDueAnnouncement | null = null;

  const opening = timeline.sections[0];

  if (timeline.index === 0 && opening?.kind === "transition") {
    const delay = timeline.rawPositionMs;

    if (delay >= 0 && delay <= GUIDED_SIGNAL_MAX_DELAY_MS) {
      due = { key: `announce:start${suffix}`, text: textFrom(1), dueAt: now - delay };
    }
  }

  const jump = timeline.lastJump;

  if (jump) {
    const delay = timeline.rawPositionMs - jump.atMs;

    if (delay >= 0 && delay <= GUIDED_SIGNAL_MAX_DELAY_MS) {
      due = { key: `announce:jump:${jump.count}`, text: textFrom(jump.from), dueAt: now - delay };
    }
  }

  timeline.sections.forEach((section, index) => {
    if (section.kind !== "exercise" || timeline.skipped.has(index)) {
      return;
    }

    const delay =
      timeline.rawPositionMs - (section.startSeconds + section.seconds) * 1000;

    if (delay >= 0 && delay <= GUIDED_SIGNAL_MAX_DELAY_MS) {
      due = {
        key: `announce:exercise-end:${index}${suffix}`,
        text: textFrom(index + 1),
        dueAt: now - delay,
      };
    }
  });

  return due;
}

/**
 * Das Schritt-Protokoll bis `until` (ms): eine Zeile je Übung, bei beidseitigen
 * Schritten je Seite - Wechsel und Seitenwechsel kommen nicht vor.
 *
 * Status: `skipped`, wenn die Übung übersprungen wurde (auch die zweite Seite,
 * wenn auf der ersten übersprungen wird), sonst `extended` bei einem „+15 s“
 * in ihrem letzten Durchgang, sonst `done`; die Übung, in der die Zeit bei
 * einem Abbruch stand, ist `aborted`. Übungen, die nicht erreicht wurden,
 * fehlen. Die Ist-Dauer ist die gelaufene Zeit des letzten Durchgangs ohne
 * Pausen, ganze Sekunden, höchstens die wirksame Länge. Das Soll ist die
 * Länge der Vorlage ohne Verlängerung.
 */
export function deriveGuidedProtocol(
  steps: readonly GuidedStep[],
  events: readonly GuidedEvent[],
  until: number,
): GuidedProtocolEntry[] {
  if (!findStart(events)) {
    return [];
  }

  const baseSections = resolveGuidedSections(steps);
  const timeline = foldTimeline(baseSections, events, until);
  const entries: GuidedProtocolEntry[] = [];

  timeline.sections.forEach((section, index) => {
    if (section.kind !== "exercise") {
      return;
    }

    const skipped = timeline.skipped.has(index);
    const reached = index < timeline.index || (index === timeline.index && (skipped || timeline.playedMs[index] > 0));

    if (!reached) {
      return;
    }

    const playedMs = Math.min(timeline.playedMs[index], section.seconds * 1000);
    const finished =
      index < timeline.index || (index === timeline.index && timeline.isOver);
    const planned = baseSections[index].seconds;
    const status = skipped
      ? "skipped"
      : !finished
        ? "aborted"
        : section.seconds > planned
          ? "extended"
          : "done";

    entries.push({
      stepIndex: section.stepIndex,
      name: steps[section.stepIndex].name,
      ...(section.side ? { side: section.side } : {}),
      status,
      plannedSeconds: planned,
      actualSeconds: Math.round(playedMs / 1000),
    });
  });

  return entries;
}

export function deriveGuidedRunState(
  steps: readonly GuidedStep[],
  events: readonly GuidedEvent[],
  now: number,
): GuidedRunState {
  const baseSections = resolveGuidedSections(steps);
  const started = Boolean(findStart(events));
  const timeline: Timeline = started
    ? foldTimeline(baseSections, events, now)
    : {
        sections: baseSections,
        positionMs: 0,
        rawPositionMs: 0,
        runningSince: null,
        skipped: new Set(),
        cutShort: new Set(),
        rewinds: 0,
        lastJump: null,
        playedMs: [],
        index: 0,
        isOver: false,
      };
  const sections = timeline.sections;
  const totalSeconds = sumGuidedSeconds(sections);
  const elapsedSeconds = timeline.positionMs / 1000;
  const finished = elapsedSeconds >= totalSeconds;

  const found = sections.findIndex(
    (section) =>
      elapsedSeconds >= section.startSeconds &&
      elapsedSeconds < section.startSeconds + section.seconds,
  );
  const sectionIndex = finished || found < 0 ? sections.length : found;
  const current = sections[sectionIndex] ?? null;
  const lastIndex = Math.max(0, steps.length - 1);

  const stepProgress = steps.map((_, stepIndex) => {
    const own = sections.filter((section) => section.stepIndex === stepIndex);
    const from = own[0]?.startSeconds ?? 0;
    const length = own.reduce((sum, section) => sum + section.seconds, 0);

    return length > 0
      ? Math.min(1, Math.max(0, (elapsedSeconds - from) / length))
      : 1;
  });

  return {
    phase: !current
      ? "finished"
      : started && timeline.runningSince === null
        ? "paused"
        : current.kind === "exercise"
          ? "exercise"
          : "transition",
    sectionIndex,
    current,
    nextExercise:
      sections
        .slice(sectionIndex + (current?.kind === "exercise" ? 1 : 0))
        .find((section) => section.kind === "exercise") ?? null,
    stepIndex: current?.stepIndex ?? lastIndex,
    remainingSeconds: current
      ? Math.ceil(current.startSeconds + current.seconds - elapsedSeconds)
      : 0,
    elapsedSeconds,
    totalSeconds,
    remainingTotalSeconds: Math.ceil(totalSeconds - elapsedSeconds),
    progress: totalSeconds > 0 ? elapsedSeconds / totalSeconds : 1,
    stepProgress,
    skippedStepIndexes: [
      ...new Set(
        [...timeline.skipped].map(
          (skippedIndex) => sections[skippedIndex].stepIndex,
        ),
      ),
    ].sort((a, b) => a - b),
    dueSignal: started ? findDueSignal(timeline, now) : null,
    dueAnnouncement: started
      ? findDueAnnouncement(timeline, steps, now)
      : null,
  };
}
