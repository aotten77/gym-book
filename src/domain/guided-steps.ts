import type { GuidedStep, WorkoutTemplate } from '@/domain/models';
import { formatNumber, formatStepClock } from '@/lib/format';

/*
 * Geführte Vorlagen: eine Liste von Schritten, die von selbst abläuft.
 *
 * Die Schritte liegen als Werte an der Vorlage (`WorkoutTemplate.steps`).
 * Für Start-Screen, Fortschrittsbalken, Ansagen und den Ablauf werden sie in
 * eine flache Abfolge von **Abschnitten** aufgelöst - `resolveGuidedSections`
 * ist die eine Stelle dafür. Wer eine Dauer, eine Reihenfolge oder eine
 * Seite braucht, liest sie aus den Abschnitten und rechnet sie nicht aus den
 * Schritten nach: zwei Auflösungen liefen früher oder später auseinander.
 *
 * Rein: keine Uhr, kein Dexie, kein React.
 */

/**
 * Der Wechsel vor dem ersten Schritt - fest, auch wenn der Schritt einen
 * eigenen nennt, außer bei `guidanceSeconds`.
 */
export const GUIDED_START_TRANSITION_SECONDS = 5;

/** Der Wechsel vor jedem weiteren Schritt, solange er keinen eigenen nennt. */
export const GUIDED_DEFAULT_TRANSITION_SECONDS = 5;

/** Der Seitenwechsel zwischen links und rechts eines beidseitigen Schritts. */
export const GUIDED_SIDE_SWITCH_SECONDS = 3;

/**
 * Ab dieser Länge ist ein Wechsel eine Pause - gemessen an der **geplanten**
 * Länge (`plannedTransitionSeconds`). Dieselbe Grenze gilt für den Countdown
 * am Ende eines Wechsels, dort aber gegen die tatsächliche Länge.
 */
export const GUIDED_PAUSE_MIN_SECONDS = 15;

export type GuidedSide = 'left' | 'right';

/**
 * Was ein Abschnitt ist:
 *
 * - `transition`: der Wechsel vor einem Schritt, auch der erste vor Schritt 1,
 * - `exercise`: die Übung selbst, bei einem beidseitigen Schritt je Seite,
 * - `sideSwitch`: die drei Sekunden zwischen links und rechts.
 *
 * Wechsel und Seitenwechsel sind beide „es geht gleich weiter“ - wer nur
 * zwischen Übung und „keine Übung“ unterscheidet, fasst sie zusammen. Eine
 * Pause ist ein langer Wechsel (`GuidedSection.pause`), keine eigene Art.
 */
export type GuidedSectionKind = 'transition' | 'exercise' | 'sideSwitch';

export interface GuidedSection {
  kind: GuidedSectionKind;
  /**
   * Der Schritt in `steps`. Bei einem Wechsel und einem Seitenwechsel der
   * Schritt, in den sie hineinführen - der Seitenwechsel gehört also zu
   * seinem eigenen Schritt, nicht zum nächsten.
   */
  stepIndex: number;
  /**
   * Nur bei einem beidseitigen Schritt. Bei einem Wechsel die Seite, mit der
   * der Schritt beginnt, beim Seitenwechsel die, zu der gewechselt wird:
   * „Als Nächstes: Taube, links“ steht im Wechsel davor.
   */
  side?: GuidedSide;
  seconds: number;
  /**
   * Nur am Wechsel: ob er eine Pause ist (`isGuidedPause`). Maßgeblich ist die
   * geplante Länge, nicht die Verlängerung durch die Anleitung.
   */
  pause?: boolean;
  /** Sekunden seit Beginn der Einheit, an denen dieser Abschnitt anfängt. */
  startSeconds: number;
}

/** Ob die Vorlage eine geführte ist: mindestens ein Schritt. */
/**
 * So lange läuft eine Seite eines Schritts: bei einem beidseitigen die Hälfte
 * von `seconds` (abgerundet, mindestens 1), sonst `seconds`. `seconds` ist
 * also immer die Übungszeit des ganzen Schritts - so steht es im Import.
 */
export function guidedSideSeconds(step: Pick<GuidedStep, 'seconds' | 'bothSides'>): number {
  return step.bothSides ? Math.max(1, Math.floor(step.seconds / 2)) : step.seconds;
}

export function isGuidedTemplate(template?: Pick<WorkoutTemplate, 'steps'> | null): boolean {
  return (template?.steps?.length ?? 0) > 0;
}

/**
 * Der Wechsel vor einem Schritt ohne Anleitung: vor dem ersten fest
 * `GUIDED_START_TRANSITION_SECONDS`, sonst `transitionSeconds` (Standard 5).
 * Die eine Regel für die Zeitachse und für die Länge eines Wechsels mit Anleitung.
 */
export function plannedTransitionSeconds(steps: readonly GuidedStep[], stepIndex: number): number {
  return stepIndex === 0
    ? GUIDED_START_TRANSITION_SECONDS
    : (steps[stepIndex].transitionSeconds ?? GUIDED_DEFAULT_TRANSITION_SECONDS);
}

/**
 * Ob der Wechsel vor diesem Schritt eine Pause ist: geplant mindestens
 * `GUIDED_PAUSE_MIN_SECONDS`. Der Wechsel vor dem ersten Schritt ist fest
 * 5 Sekunden und damit nie eine.
 */
export function isGuidedPause(steps: readonly GuidedStep[], stepIndex: number): boolean {
  return plannedTransitionSeconds(steps, stepIndex) >= GUIDED_PAUSE_MIN_SECONDS;
}

/**
 * Löst die Schritte in die Abfolge der Abschnitte auf.
 *
 * Vor jedem Schritt steht ein Wechsel: vor dem ersten fest 5 Sekunden, vor
 * jedem weiteren die `transitionSeconds` dieses Schritts (Standard 5) - außer
 * bei `guidanceSeconds`: trägt ein Schritt im Snapshot dieses Feld, wird dort
 * die Anleitung gesprochen und der Wechsel ist so lang wie sie, auch beim
 * ersten Schritt. Ein beidseitiger Schritt wird links, 3 Sekunden
 * Seitenwechsel, rechts - jede Seite mit der Hälfte der Dauer des Schritts
 * (`guidedSideSeconds`). Nach dem letzten Schritt folgt
 * nichts: das Ende ist ein Ereignis (Signal und „Geschafft.“), kein Abschnitt.
 */
export function resolveGuidedSections(steps: readonly GuidedStep[]): GuidedSection[] {
  const sections: GuidedSection[] = [];
  let startSeconds = 0;

  const push = (section: Omit<GuidedSection, 'startSeconds'>) => {
    sections.push({ ...section, startSeconds });
    startSeconds += section.seconds;
  };

  steps.forEach((step, stepIndex) => {
    const first: { side?: GuidedSide } = step.bothSides ? { side: 'left' } : {};

    push({
      kind: 'transition',
      stepIndex,
      ...first,
      seconds: step.guidanceSeconds ?? plannedTransitionSeconds(steps, stepIndex),
      pause: isGuidedPause(steps, stepIndex),
    });
    push({ kind: 'exercise', stepIndex, ...first, seconds: guidedSideSeconds(step) });

    if (step.bothSides) {
      push({
        kind: 'sideSwitch',
        stepIndex,
        side: 'right',
        seconds: GUIDED_SIDE_SWITCH_SECONDS,
      });
      push({ kind: 'exercise', stepIndex, side: 'right', seconds: guidedSideSeconds(step) });
    }
  });

  return sections;
}

/** Die Gesamtdauer der aufgelösten Abfolge in Sekunden - Wechsel eingerechnet. */
export function sumGuidedSeconds(sections: readonly GuidedSection[]): number {
  return sections.reduce((sum, section) => sum + section.seconds, 0);
}

export interface GuidedStepsSummary {
  stepCount: number;
  bothSidesCount: number;
  /** Mit Wechseln und Seitenwechseln: so lange läuft die Einheit tatsächlich. */
  totalSeconds: number;
}

export function summarizeGuidedSteps(steps: readonly GuidedStep[]): GuidedStepsSummary {
  return {
    stepCount: steps.length,
    bothSidesCount: steps.filter((step) => step.bothSides).length,
    totalSeconds: sumGuidedSeconds(resolveGuidedSections(steps)),
  };
}

function describeStepCount(count: number) {
  return `${formatNumber(count)} ${count === 1 ? 'Schritt' : 'Schritte'}`;
}

/** „geführt, 12 Schritte“ - so nennt die Import-Vorschau eine geführte Vorlage. */
export function describeGuidedSteps(steps: readonly GuidedStep[]): string {
  return `geführt, ${describeStepCount(steps.length)}`;
}

/**
 * Die Kennzahlen über der Schrittliste: Schritte, ungefähre Dauer, beidseitige.
 *
 * Die Minuten sind gerundet und nie unter einer - „≈ 0 min“ sagte nichts. Die
 * Zahl der beidseitigen steht nur da, wo es welche gibt.
 *
 * `totalSeconds` ersetzt die aus den Schritten gerechnete Dauer - mit
 * Anleitung kommt sie aus den gemessenen Ansagen; `withGuidance` sagt es dazu.
 */
export function describeGuidedFacts(
  steps: readonly GuidedStep[],
  options: { totalSeconds?: number; withGuidance?: boolean } = {},
): string[] {
  const summary = summarizeGuidedSteps(steps);
  const totalSeconds = options.totalSeconds ?? summary.totalSeconds;
  const { stepCount, bothSidesCount } = summary;
  const minutes = `≈ ${formatNumber(Math.max(1, Math.round(totalSeconds / 60)))} min`;
  const facts = [
    describeStepCount(stepCount),
    options.withGuidance ? `${minutes} mit Anleitung` : minutes,
  ];

  if (bothSidesCount > 0) {
    facts.push(`${formatNumber(bothSidesCount)} beidseitig`);
  }

  return facts;
}

/** Die Kurzfassung für Listen, wo sonst „0 Übungen“ stünde: „3 Schritte · ≈ 6 min“. */
export function describeGuidedSummary(steps: readonly GuidedStep[]): string {
  return describeGuidedFacts(steps).slice(0, 2).join(' · ');
}

/** Die Pausenzeile der Schrittliste: „45 s Pause“, ab einer Minute „1:30 Pause“. */
export function describeGuidedPause(seconds: number): string {
  return `${seconds < 60 ? `${formatNumber(seconds)} s` : formatStepClock(seconds)} Pause`;
}

/**
 * Die Pausenzeile vor jedem Schritt der Vorlage, je Position - oder `null`.
 *
 * Gerechnet wird auf den gespielten Schritten, mit derselben Regel wie die
 * Zeitachse (`isGuidedPause`): ein pausierter Schritt (`isPaused`, durch eine
 * Einschränkung) läuft nicht und hat keine Zeile, und der erste gespielte hat
 * fest 5 Sekunden Wechsel - auch wenn er in der Vorlage nicht der erste ist.
 */
export function describeGuidedPausesBefore(
  steps: readonly GuidedStep[],
  isPaused: (index: number) => boolean,
): (string | null)[] {
  const played = steps.filter((_, index) => !isPaused(index));
  let playedIndex = 0;

  return steps.map((_, index) => {
    if (isPaused(index)) {
      return null;
    }

    const at = playedIndex++;

    return isGuidedPause(played, at)
      ? describeGuidedPause(plannedTransitionSeconds(played, at))
      : null;
  });
}

/** Die Dauer in der Schrittliste: „1:00“, bei einem beidseitigen Schritt je Seite „2 × 1:15“. */
export function describeGuidedStepDuration(step: GuidedStep): string {
  const clock = formatStepClock(guidedSideSeconds(step));

  return step.bothSides ? `2 × ${clock}` : clock;
}
