import { describe, expect, it } from 'vitest';
import {
  describeGuidedFacts,
  describeGuidedStepDuration,
  describeGuidedSummary,
  describeGuidedSteps,
  GUIDED_SIDE_SWITCH_SECONDS,
  GUIDED_START_TRANSITION_SECONDS,
  guidedSideSeconds,
  isGuidedTemplate,
  resolveGuidedSections,
  sumGuidedSeconds,
  summarizeGuidedSteps,
} from '@/domain/guided-steps';
import type { GuidedStep } from '@/domain/models';

const KINDHALTUNG: GuidedStep = { name: 'Kindhaltung', seconds: 60 };
const KATZE_KUH: GuidedStep = { name: 'Katze-Kuh', seconds: 45 };
const TAUBE: GuidedStep = { name: 'Taube', seconds: 150, bothSides: true };

describe('isGuidedTemplate', () => {
  it('kennt eine Vorlage mit mindestens einem Schritt', () => {
    expect(isGuidedTemplate({ steps: [KINDHALTUNG] })).toBe(true);
  });

  it('kennt weder eine Vorlage ohne Feld noch eine mit leerer Liste', () => {
    expect(isGuidedTemplate({})).toBe(false);
    expect(isGuidedTemplate({ steps: [] })).toBe(false);
    expect(isGuidedTemplate(undefined)).toBe(false);
    expect(isGuidedTemplate(null)).toBe(false);
  });
});

describe('resolveGuidedSections', () => {
  it('stellt jedem Schritt einen Wechsel voran, der erste dauert fest 5 Sekunden', () => {
    const sections = resolveGuidedSections([KINDHALTUNG, KATZE_KUH]);

    expect(sections.map((section) => [section.kind, section.stepIndex, section.seconds])).toEqual([
      ['transition', 0, GUIDED_START_TRANSITION_SECONDS],
      ['exercise', 0, 60],
      ['transition', 1, 5],
      ['exercise', 1, 45],
    ]);
  });

  it('hängt nach dem letzten Schritt nichts an', () => {
    const sections = resolveGuidedSections([KINDHALTUNG]);

    expect(sections.at(-1)?.kind).toBe('exercise');
  });

  it('nimmt den Wechsel vor einem Schritt aus dessen transitionSeconds', () => {
    const sections = resolveGuidedSections([
      KINDHALTUNG,
      { ...KATZE_KUH, transitionSeconds: 12 },
    ]);

    expect(sections[2]).toMatchObject({ kind: 'transition', stepIndex: 1, seconds: 12 });
  });

  it('lässt den ersten Wechsel bei 5 Sekunden, auch wenn der erste Schritt einen eigenen nennt', () => {
    const sections = resolveGuidedSections([{ ...KINDHALTUNG, transitionSeconds: 20 }, KATZE_KUH]);

    expect(sections[0]).toMatchObject({ kind: 'transition', seconds: 5 });
  });

  it('macht aus einem beidseitigen Schritt links, drei Sekunden Seitenwechsel und rechts', () => {
    const sections = resolveGuidedSections([TAUBE]);

    expect(sections.map((section) => [section.kind, section.side, section.seconds])).toEqual([
      ['transition', 'left', 5],
      ['exercise', 'left', 75],
      ['sideSwitch', 'right', GUIDED_SIDE_SWITCH_SECONDS],
      ['exercise', 'right', 75],
    ]);
  });

  it('teilt seconds eines beidseitigen Schritts auf die Seiten, abgerundet', () => {
    expect(guidedSideSeconds({ seconds: 240, bothSides: true })).toBe(120);
    expect(guidedSideSeconds({ seconds: 75, bothSides: true })).toBe(37);
    expect(guidedSideSeconds({ seconds: 1, bothSides: true })).toBe(1);
    expect(guidedSideSeconds({ seconds: 75 })).toBe(75);
  });

  it('rechnet die Gesamtdauer aus 5 s Start, Wechseln, allen seconds und 3 s je beidseitigem Schritt', () => {
    // Die Faszien-Einheit aus dem Import: 17:54.
    const steps: GuidedStep[] = [
      { name: 'Waden', seconds: 180, bothSides: true },
      { name: 'Hamstrings', seconds: 240, bothSides: true, transitionSeconds: 8 },
      { name: 'Quadrizeps', seconds: 180, bothSides: true, transitionSeconds: 8 },
      { name: 'Gesäß', seconds: 240, bothSides: true, transitionSeconds: 10 },
      { name: 'Hüftaußenseite', seconds: 180, bothSides: true, transitionSeconds: 8 },
    ];

    expect(summarizeGuidedSteps(steps).totalSeconds).toBe(17 * 60 + 54);
    expect(describeGuidedStepDuration(steps[1])).toBe('2 × 2:00');
  });

  it('gibt einseitigen Abschnitten keine Seite', () => {
    const sections = resolveGuidedSections([KINDHALTUNG]);

    expect(sections.every((section) => section.side === undefined)).toBe(true);
    expect('side' in sections[0]).toBe(false);
  });

  it('gibt dem Wechsel vor einem beidseitigen Schritt die Seite, in die er hineinführt', () => {
    const sections = resolveGuidedSections([KINDHALTUNG, TAUBE]);

    expect(sections[2]).toMatchObject({ kind: 'transition', stepIndex: 1, side: 'left' });
  });

  it('zählt den Seitenwechsel zum Schritt, nicht zum nächsten', () => {
    const sections = resolveGuidedSections([TAUBE, KATZE_KUH]);

    expect(sections.map((section) => section.stepIndex)).toEqual([0, 0, 0, 0, 1, 1]);
  });

  it('trägt die Startzeit jedes Abschnitts als Summe der vorigen', () => {
    const sections = resolveGuidedSections([KINDHALTUNG, TAUBE]);

    expect(sections.map((section) => section.startSeconds)).toEqual([0, 5, 65, 70, 145, 148]);
  });

  it('liefert für eine leere Liste keine Abschnitte', () => {
    expect(resolveGuidedSections([])).toEqual([]);
  });

  it('verändert die Eingabe nicht', () => {
    const steps = [KINDHALTUNG, TAUBE];
    const snapshot = JSON.stringify(steps);

    resolveGuidedSections(steps);

    expect(JSON.stringify(steps)).toBe(snapshot);
  });
});

describe('sumGuidedSeconds', () => {
  it('summiert Wechsel, Übungen und Seitenwechsel', () => {
    // 5 + 60 + 5 + 45 + 5 + 75 + 3 + 75
    expect(sumGuidedSeconds(resolveGuidedSections([KINDHALTUNG, KATZE_KUH, TAUBE]))).toBe(273);
  });

  it('ist bei keinem Abschnitt 0', () => {
    expect(sumGuidedSeconds([])).toBe(0);
  });
});

describe('summarizeGuidedSteps', () => {
  it('zählt Schritte, beidseitige Schritte und die Gesamtdauer samt Wechseln', () => {
    expect(summarizeGuidedSteps([KINDHALTUNG, KATZE_KUH, TAUBE])).toEqual({
      stepCount: 3,
      bothSidesCount: 1,
      totalSeconds: 273,
    });
  });
});

describe('describeGuidedSteps', () => {
  it('nennt eine geführte Vorlage mit der Zahl ihrer Schritte', () => {
    expect(describeGuidedSteps([KINDHALTUNG, KATZE_KUH, TAUBE])).toBe('geführt, 3 Schritte');
    expect(describeGuidedSteps([KINDHALTUNG])).toBe('geführt, 1 Schritt');
  });
});

describe('describeGuidedFacts', () => {
  it('beschreibt Schritte, ungefähre Minuten und beidseitige Schritte', () => {
    expect(describeGuidedFacts([KINDHALTUNG, KATZE_KUH, TAUBE])).toEqual([
      '3 Schritte',
      '≈ 5 min',
      '1 beidseitig',
    ]);
  });

  it('lässt „beidseitig“ weg, wenn es keinen gibt', () => {
    expect(describeGuidedFacts([KINDHALTUNG])).toEqual(['1 Schritt', '≈ 1 min']);
  });

  it('rundet nicht unter eine Minute', () => {
    expect(describeGuidedFacts([{ name: 'Kurz', seconds: 10 }])[1]).toBe('≈ 1 min');
  });
});

describe('describeGuidedSummary', () => {
  it('nennt Schritte und Minuten, ohne die beidseitigen', () => {
    expect(describeGuidedSummary([KINDHALTUNG, KATZE_KUH, TAUBE])).toBe('3 Schritte · ≈ 5 min');
  });
});

describe('describeGuidedStepDuration', () => {
  it('schreibt eine einseitige Dauer als Minuten und Sekunden', () => {
    expect(describeGuidedStepDuration(KINDHALTUNG)).toBe('1:00');
    expect(describeGuidedStepDuration(KATZE_KUH)).toBe('0:45');
  });

  it('schreibt eine beidseitige Dauer je Seite', () => {
    expect(describeGuidedStepDuration(TAUBE)).toBe('2 × 1:15');
  });
});
