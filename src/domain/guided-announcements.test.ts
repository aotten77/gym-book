import { describe, expect, it } from 'vitest';
import {
  buildNextAnnouncement,
  describeSpokenDuration,
  applyGuidance,
  GUIDED_DONE_TEXT,
  guidanceTransitionSeconds,
  requiredAnnouncementTexts,
  requiredGuidanceTexts,
} from '@/domain/guided-announcements';

describe('describeSpokenDuration', () => {
  it('nennt Dauern bis 90 Sekunden in Sekunden', () => {
    expect(describeSpokenDuration(45)).toBe('45 Sekunden');
    expect(describeSpokenDuration(75)).toBe('75 Sekunden');
    expect(describeSpokenDuration(90)).toBe('90 Sekunden');
  });

  it('nennt längere Dauern in Minuten', () => {
    expect(describeSpokenDuration(120)).toBe('2 Minuten');
    expect(describeSpokenDuration(150)).toBe('2 Minuten 30');
    expect(describeSpokenDuration(91)).toBe('1 Minute 31');
    expect(describeSpokenDuration(60 * 10)).toBe('10 Minuten');
  });
});

describe('buildNextAnnouncement', () => {
  it('nimmt spokenName vor name und nennt die Seite', () => {
    expect(
      buildNextAnnouncement({ name: 'BWS', spokenName: 'Brustwirbelsäule', seconds: 75 }, 'left'),
    ).toBe('Als Nächstes: Brustwirbelsäule, links, 75 Sekunden');
    expect(buildNextAnnouncement({ name: 'Taube', seconds: 120 }, 'right')).toBe(
      'Als Nächstes: Taube, rechts, 2 Minuten',
    );
  });

  it('nennt bei einem beidseitigen Schritt die Zeit einer Seite', () => {
    expect(buildNextAnnouncement({ name: 'Hamstrings', seconds: 240, bothSides: true }, 'left')).toBe(
      'Als Nächstes: Hamstrings, links, 2 Minuten',
    );
  });

  it('lässt die Seite bei einseitigen Schritten weg', () => {
    expect(buildNextAnnouncement({ name: 'Kindhaltung', seconds: 60 })).toBe(
      'Als Nächstes: Kindhaltung, 60 Sekunden',
    );
  });
});

describe('requiredAnnouncementTexts', () => {
  it('liefert je Übungsabschnitt einen Satz plus „Geschafft.“, ohne Duplikate', () => {
    const texts = requiredAnnouncementTexts([
      { name: 'Kindhaltung', seconds: 60 },
      { name: 'Taube', seconds: 150, bothSides: true },
      { name: 'Kindhaltung', seconds: 60 },
    ]);

    expect(texts).toEqual([
      'Als Nächstes: Kindhaltung, 60 Sekunden',
      'Als Nächstes: Taube, links, 75 Sekunden',
      'Als Nächstes: Taube, rechts, 75 Sekunden',
      GUIDED_DONE_TEXT,
    ]);
  });
});

const GUIDE = 'Erfundener Beispieltext zum Einstieg.';

describe('buildNextAnnouncement mit Anleitung', () => {
  it('hängt die Anleitung nur mit guidanceSeconds an', () => {
    const step = { name: 'Beispiel A', seconds: 40, guidance: GUIDE };
    expect(buildNextAnnouncement(step)).toBe('Als Nächstes: Beispiel A, 40 Sekunden');
    expect(buildNextAnnouncement({ ...step, guidanceSeconds: 12 })).toBe(
      `Als Nächstes: Beispiel A, 40 Sekunden. ${GUIDE}`,
    );
  });

  it('spricht sie bei beidseitigen Schritten nur links', () => {
    const step = {
      name: 'Beispiel C',
      seconds: 60,
      bothSides: true,
      guidance: GUIDE,
      guidanceSeconds: 12,
    };
    expect(buildNextAnnouncement(step, 'left')).toBe(
      `Als Nächstes: Beispiel C, links, 30 Sekunden. ${GUIDE}`,
    );
    expect(buildNextAnnouncement(step, 'right')).toBe('Als Nächstes: Beispiel C, rechts, 30 Sekunden');
  });
});

describe('requiredAnnouncementTexts mit Anleitung', () => {
  it('liefert für einen Snapshot mit guidanceSeconds die Sätze mit Anleitung', () => {
    expect(
      requiredAnnouncementTexts([
        { name: 'Beispiel A', seconds: 40, guidance: GUIDE, guidanceSeconds: 12 },
      ]),
    ).toEqual([`Als Nächstes: Beispiel A, 40 Sekunden. ${GUIDE}`, 'Geschafft.']);
  });
});

describe('requiredGuidanceTexts', () => {
  it('ein Satz je Schritt mit Anleitung, leere Anleitung zählt nicht', () => {
    expect(
      requiredGuidanceTexts([
        { name: 'Beispiel A', seconds: 40 },
        { name: 'Beispiel C', seconds: 60, bothSides: true, guidance: GUIDE },
        { name: 'Beispiel B', seconds: 30, guidance: '  ' },
      ]),
    ).toEqual([{ stepIndex: 1, text: `Als Nächstes: Beispiel C, links, 30 Sekunden. ${GUIDE}` }]);
  });
});

describe('guidanceTransitionSeconds', () => {
  it('rundet 0,7 s + Dauer + 4 s auf und hält den geplanten Wechsel als Untergrenze', () => {
    expect(guidanceTransitionSeconds(5, 12_000)).toBe(17); // 16,7 → 17
    expect(guidanceTransitionSeconds(5, 12_400)).toBe(18); // 17,1 → 18
    expect(guidanceTransitionSeconds(20, 3_000)).toBe(20);
  });
});

describe('applyGuidance', () => {
  const steps = [
    { name: 'Beispiel A', seconds: 40, guidance: GUIDE },
    { name: 'Beispiel B', seconds: 30, transitionSeconds: 25, guidance: GUIDE },
    { name: 'Beispiel D', seconds: 20 },
  ];
  const texts = requiredGuidanceTexts(steps).map((entry) => entry.text);

  it('setzt guidanceSeconds nur an Schritten mit Anleitung', () => {
    const result = applyGuidance(
      steps,
      new Map([
        [texts[0], 12_000],
        [texts[1], 12_000],
      ]),
    );
    expect(result?.map((step) => step.guidanceSeconds)).toEqual([17, 25, undefined]);
    expect(steps[0]).not.toHaveProperty('guidanceSeconds');
  });

  it('gibt null zurück, wenn eine Dauer fehlt oder keine Anleitung da ist', () => {
    expect(applyGuidance(steps, new Map([[texts[0], 12_000]]))).toBeNull();
    expect(applyGuidance([{ name: 'Beispiel D', seconds: 20 }], new Map())).toBeNull();
  });
});
