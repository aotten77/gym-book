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

/** Der Wechsel vor dem ersten Schritt - fest, auch wenn der Schritt einen eigenen nennt. */
export const GUIDED_START_TRANSITION_SECONDS = 5;

/** Der Wechsel vor jedem weiteren Schritt, solange er keinen eigenen nennt. */
export const GUIDED_DEFAULT_TRANSITION_SECONDS = 5;

/** Der Seitenwechsel zwischen links und rechts eines beidseitigen Schritts. */
export const GUIDED_SIDE_SWITCH_SECONDS = 3;

export type GuidedSide = 'left' | 'right';

/**
 * Was ein Abschnitt ist:
 *
 * - `transition`: der Wechsel vor einem Schritt, auch der erste vor Schritt 1,
 * - `exercise`: die Übung selbst, bei einem beidseitigen Schritt je Seite,
 * - `sideSwitch`: die drei Sekunden zwischen links und rechts.
 *
 * Wechsel und Seitenwechsel sind beide „es geht gleich weiter“ - wer nur
 * zwischen Übung und Pause unterscheidet, fasst sie zusammen.
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
  /** Sekunden seit Beginn der Einheit, an denen dieser Abschnitt anfängt. */
  startSeconds: number;
}

/** Ob die Vorlage eine geführte ist: mindestens ein Schritt. */
export function isGuidedTemplate(template?: Pick<WorkoutTemplate, 'steps'> | null): boolean {
  return (template?.steps?.length ?? 0) > 0;
}

/**
 * Löst die Schritte in die Abfolge der Abschnitte auf.
 *
 * Vor jedem Schritt steht ein Wechsel: vor dem ersten fest 5 Sekunden, vor
 * jedem weiteren die `transitionSeconds` dieses Schritts (Standard 5). Ein
 * beidseitiger Schritt wird links, 3 Sekunden Seitenwechsel, rechts - jede
 * Seite mit der vollen Dauer des Schritts. Nach dem letzten Schritt folgt
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
      seconds:
        stepIndex === 0
          ? GUIDED_START_TRANSITION_SECONDS
          : (step.transitionSeconds ?? GUIDED_DEFAULT_TRANSITION_SECONDS),
    });
    push({ kind: 'exercise', stepIndex, ...first, seconds: step.seconds });

    if (step.bothSides) {
      push({
        kind: 'sideSwitch',
        stepIndex,
        side: 'right',
        seconds: GUIDED_SIDE_SWITCH_SECONDS,
      });
      push({ kind: 'exercise', stepIndex, side: 'right', seconds: step.seconds });
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
 */
export function describeGuidedFacts(steps: readonly GuidedStep[]): string[] {
  const { stepCount, bothSidesCount, totalSeconds } = summarizeGuidedSteps(steps);
  const facts = [
    describeStepCount(stepCount),
    `≈ ${formatNumber(Math.max(1, Math.round(totalSeconds / 60)))} min`,
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

/** Die Dauer in der Schrittliste: „1:00“, bei einem beidseitigen Schritt „2 × 1:15“. */
export function describeGuidedStepDuration(step: GuidedStep): string {
  const clock = formatStepClock(step.seconds);

  return step.bothSides ? `2 × ${clock}` : clock;
}
