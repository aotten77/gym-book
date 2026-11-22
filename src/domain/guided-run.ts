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
 * nachgerechnet. Ereignisse sind eine Union: Pause, Überspringen und die
 * übrigen Eingriffe ergänzen weitere Typen in `GuidedEvent` und falten sich in
 * `playedSeconds` in die Spielzeit - der Rest dieses Moduls liest nur diese.
 */

/**
 * Ab dieser Verspätung bleibt ein Signal aus - dieselbe Regel und derselbe
 * Wert wie bei den Satz-Timer-Ansagen: der Sekundentakt kann knapp vor dem
 * Zeitpunkt abtasten, die nächste Probe kommt gut eine Sekunde später.
 */
export const GUIDED_SIGNAL_MAX_DELAY_MS = 2000;

export type GuidedPhase = 'transition' | 'exercise' | 'finished';

/** Ein fälliges Signal. Den `key` merkt sich der Aufrufer, damit es nicht doppelt klingt. */
export interface GuidedDueSignal {
  key: string;
  /** Wann es fällig wurde (ms). */
  dueAt: number;
}

export interface GuidedRunState {
  /** Wechsel und Seitenwechsel zählen beide als `transition`. */
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

/**
 * Wie viele Millisekunden der Ablauf bis `now` gelaufen ist. Heute zählt nur
 * die Zeit seit dem Start; Pausen werden hier herausgerechnet, sobald es sie gibt.
 */
function playedMs(events: readonly GuidedEvent[], now: number): number {
  const start = findStart(events);

  return start ? Math.max(0, now - start.at) : 0;
}

/**
 * Hängt ein Ereignis an. Rein und ohne Mutation; ein sinnloses Ereignis wirft
 * eine Meldung auf Deutsch, die die Aktion weiterreicht.
 */
export function addGuidedEvent(
  events: readonly GuidedEvent[],
  event: GuidedEvent,
): GuidedEvent[] {
  if (event.type === 'start' && findStart(events)) {
    throw new Error('Die Einheit läuft bereits.');
  }

  return [...events, event];
}

/** Der Zeitpunkt (ms), an dem die Einheit ohne Eingriffe endet - `null` vor dem Start. */
export function guidedRunEndsAt(
  steps: readonly GuidedStep[],
  events: readonly GuidedEvent[],
): number | null {
  const start = findStart(events);

  return start ? start.at + sumGuidedSeconds(resolveGuidedSections(steps)) * 1000 : null;
}

/** Das Signal am Ende der Übung `index` - und `null`, wenn keines frisch fällig ist. */
function findDueSignal(
  sections: readonly GuidedSection[],
  startAt: number,
  now: number,
): GuidedDueSignal | null {
  let due: GuidedDueSignal | null = null;

  sections.forEach((section, index) => {
    if (section.kind !== 'exercise') {
      return;
    }

    const dueAt = startAt + (section.startSeconds + section.seconds) * 1000;

    if (dueAt <= now && now - dueAt <= GUIDED_SIGNAL_MAX_DELAY_MS) {
      due = { key: `exercise-end:${index}`, dueAt };
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
  const start = findStart(events);
  const elapsedMs = Math.min(playedMs(events, now), totalSeconds * 1000);
  const elapsedSeconds = elapsedMs / 1000;
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
    phase: !current ? 'finished' : current.kind === 'exercise' ? 'exercise' : 'transition',
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
    dueSignal: start ? findDueSignal(sections, start.at, now) : null,
  };
}
