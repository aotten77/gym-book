import { describe, expect, it } from 'vitest';
import { isChimeFresh } from '@/lib/sound';

describe('isChimeFresh', () => {
  const now = 1_700_000_000_000;

  it('meldet den Ablauf, der gerade passiert ist', () => {
    expect(isChimeFresh(now, now)).toBe(true);
    expect(isChimeFresh(now - 3_000, now)).toBe(true);
  });

  it('bleibt still, wenn der Ablauf lange zurückliegt', () => {
    // Der Fall nach dem Zurückwechseln aus dem Hintergrund: dort tickt keine
    // Uhr, der Ablauf fällt erst Minuten später auf.
    expect(isChimeFresh(now - 60_000, now)).toBe(false);
  });

  it('behandelt eine Uhr, die zurückgesprungen ist, als frisch', () => {
    // Zeitumstellung oder eine korrigierte Systemuhr sollen den Ton nicht
    // unterdrücken - der Timer ist trotzdem gerade abgelaufen.
    expect(isChimeFresh(now + 5_000, now)).toBe(true);
  });
});
