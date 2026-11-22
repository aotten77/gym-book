import { describe, expect, it } from 'vitest';
import {
  buildNextAnnouncement,
  describeSpokenDuration,
  GUIDED_DONE_TEXT,
  requiredAnnouncementTexts,
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
      { name: 'Taube', seconds: 75, bothSides: true },
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
