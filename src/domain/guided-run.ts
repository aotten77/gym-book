import {
  resolveGuidedSections,
  sumGuidedSeconds,
  type GuidedSection,
} from '@/domain/guided-steps';
import type { GuidedEvent, GuidedStep, WorkoutSession } from '@/domain/models';

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
 * nachgerechnet. Ereignisse sind eine Union: Pause, Weiter und Neustart
 * falten sich in `foldTimeline` in die Spielzeit, weitere Eingriffe kommen
 * als weitere Typen dazu - der Rest dieses Moduls liest nur diese.
 */

/**
 * Ab dieser Verspätung bleibt ein Signal aus - dieselbe Regel und derselbe
 * Wert wie bei den Satz-Timer-Ansagen: der Sekundentakt kann knapp vor dem
 * Zeitpunkt abtasten, die nächste Probe kommt gut eine Sekunde später.
 */
export const GUIDED_SIGNAL_MAX_DELAY_MS = 2000;

export type GuidedPhase = 'transition' | 'exercise' | 'paused' | 'finished';

/** Ein fälliges Signal. Den `key` merkt sich der Aufrufer, damit es nicht doppelt klingt. */
export interface GuidedDueSignal {
  key: string;
  /** Wann es fällig wurde (ms). */
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
  dueSignal: GuidedDueSignal | null;
}

/** Ob die Session eine geführte ist: sie trägt einen Ablauf. */
export function isGuidedSession(session?: Pick<WorkoutSession, 'guided'> | null): boolean {
  return Boolean(session?.guided);
}

function findStart(events: readonly GuidedEvent[]) {
  return events.find((event) => event.type === 'start');
}

/** Ob die Einheit gestartet ist und gerade steht. */
function isPausedByEvents(events: readonly GuidedEvent[]): boolean {
  let paused = false;

  for (const event of events) {
    if (event.type === 'pause') {
      paused = true;
    } else if (event.type === 'resume') {
      paused = false;
    }
  }

  return paused;
}

interface Timeline {
  /** Die Spielzeit (ms) auf der Abfolge, ohne Pausen, begrenzt auf die Gesamtdauer. */
  positionMs: number;
  /** Wie `positionMs`, aber ohne Begrenzung: wie weit die Zeit über das Ende hinaus lief. */
  rawPositionMs: number;
  /** Seit wann die Zeit läuft; `null`, solange sie steht oder der Start fehlt. */
  runningSince: number | null;
}

/**
 * Faltet die Ereignisse zur Spielzeit bis `until`: die Zeit läuft zwischen
 * Start/Weiter und Pause, ein Neustart springt auf den Anfang des Abschnitts,
 * in dem die Einheit gerade steht (die Seite bei beidseitigen Schritten, der
 * Wechsel im Wechsel). Ein Zeitstempel vor dem vorigen Ereignis zählt als
 * dessen Zeitpunkt, damit eine springende Uhr keine negative Zeit ergibt.
 */
function foldTimeline(
  sections: readonly GuidedSection[],
  events: readonly GuidedEvent[],
  until: number,
): Timeline {
  const totalMs = sumGuidedSeconds(sections) * 1000;
  let position = 0;
  let runningSince: number | null = null;
  let lastAt = Number.NEGATIVE_INFINITY;

  const rawPositionAt = (time: number) =>
    position + (runningSince === null ? 0 : Math.max(0, time - runningSince));
  const positionAt = (time: number) => Math.min(totalMs, rawPositionAt(time));

  for (const event of events) {
    const at = Math.max(event.at, lastAt);

    lastAt = at;

    switch (event.type) {
      case 'start':
        position = 0;
        runningSince = at;
        break;
      case 'pause':
        position = positionAt(at);
        runningSince = null;
        break;
      case 'resume':
        runningSince = at;
        break;
      case 'restart': {
        const seconds = positionAt(at) / 1000;
        const section = sections.find(
          (candidate) =>
            seconds >= candidate.startSeconds &&
            seconds < candidate.startSeconds + candidate.seconds,
        );

        if (section) {
          position = section.startSeconds * 1000;
          runningSince = runningSince === null ? null : at;
        }
        break;
      }
    }
  }

  const end = Math.max(until, lastAt);

  return { positionMs: positionAt(end), rawPositionMs: rawPositionAt(end), runningSince };
}

/**
 * Hängt ein Ereignis an. Rein und ohne Mutation; ein sinnloses Ereignis wirft
 * eine Meldung auf Deutsch, die die Aktion weiterreicht.
 */
export function addGuidedEvent(
  events: readonly GuidedEvent[],
  event: GuidedEvent,
): GuidedEvent[] {
  const started = Boolean(findStart(events));

  if (event.type === 'start') {
    if (started) {
      throw new Error('Die Einheit läuft bereits.');
    }
  } else if (!started) {
    throw new Error('Die Einheit hat noch nicht begonnen.');
  } else if (event.type === 'pause' && isPausedByEvents(events)) {
    throw new Error('Die Einheit ist schon pausiert.');
  } else if (event.type === 'resume' && !isPausedByEvents(events)) {
    throw new Error('Die Einheit ist nicht pausiert.');
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

  const sections = resolveGuidedSections(steps);
  const lastAt = events.reduce((latest, event) => Math.max(latest, event.at), 0);
  const { positionMs, runningSince } = foldTimeline(sections, events, lastAt);

  return runningSince === null
    ? null
    : lastAt + (sumGuidedSeconds(sections) * 1000 - positionMs);
}

/**
 * Das Signal am Ende der Übung `index` - und `null`, wenn keines frisch fällig
 * ist oder die Zeit steht. Ein Neustart hängt seine Nummer an den Schlüssel:
 * die neu gespielte Übung endet noch einmal und soll noch einmal klingen.
 */
function findDueSignal(
  sections: readonly GuidedSection[],
  timeline: Timeline,
  restartCount: number,
  now: number,
): GuidedDueSignal | null {
  if (timeline.runningSince === null) {
    return null;
  }

  let due: GuidedDueSignal | null = null;

  sections.forEach((section, index) => {
    if (section.kind !== 'exercise') {
      return;
    }

    const delay = timeline.rawPositionMs - (section.startSeconds + section.seconds) * 1000;

    if (delay >= 0 && delay <= GUIDED_SIGNAL_MAX_DELAY_MS) {
      due = {
        key: restartCount > 0 ? `exercise-end:${index}:${restartCount}` : `exercise-end:${index}`,
        dueAt: now - delay,
      };
    }
  });

  return due;
}

export function deriveGuidedRunState(
  steps: readonly GuidedStep[],
  events: readonly GuidedEvent[],
  now: number,
): GuidedRunState {
  const sections = resolveGuidedSections(steps);
  const totalSeconds = sumGuidedSeconds(sections);
  const started = Boolean(findStart(events));
  const timeline = started
    ? foldTimeline(sections, events, now)
    : { positionMs: 0, rawPositionMs: 0, runningSince: null };
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

    return length > 0 ? Math.min(1, Math.max(0, (elapsedSeconds - from) / length)) : 1;
  });

  return {
    phase: !current
      ? 'finished'
      : started && timeline.runningSince === null
        ? 'paused'
        : current.kind === 'exercise'
          ? 'exercise'
          : 'transition',
    sectionIndex,
    current,
    nextExercise:
      sections.slice(sectionIndex + (current?.kind === 'exercise' ? 1 : 0)).find(
        (section) => section.kind === 'exercise',
      ) ?? null,
    stepIndex: current?.stepIndex ?? lastIndex,
    remainingSeconds: current
      ? Math.ceil(current.startSeconds + current.seconds - elapsedSeconds)
      : 0,
    elapsedSeconds,
    totalSeconds,
    remainingTotalSeconds: Math.ceil(totalSeconds - elapsedSeconds),
    progress: totalSeconds > 0 ? elapsedSeconds / totalSeconds : 1,
    stepProgress,
    dueSignal: started
      ? findDueSignal(
          sections,
          timeline,
          events.filter((event) => event.type === 'restart').length,
          now,
        )
      : null,
  };
}
