import { describe, expect, it } from 'vitest';
import { readScreenAngle } from '@/lib/orientation';

describe('readScreenAngle', () => {
  it('liest den Winkel aus screen.orientation', () => {
    expect(readScreenAngle({ screen: { orientation: { angle: 270 } } })).toBe(270);
  });

  it('fällt auf window.orientation zurück und normalisiert negative Werte', () => {
    expect(readScreenAngle({ orientation: -90 })).toBe(270);
    expect(readScreenAngle({ orientation: 90 })).toBe(90);
  });

  it('bevorzugt screen.orientation vor dem alten Wert', () => {
    expect(readScreenAngle({ screen: { orientation: { angle: 90 } }, orientation: -90 })).toBe(90);
  });

  it('rundet auf die nächste Vierteldrehung', () => {
    expect(readScreenAngle({ screen: { orientation: { angle: 89 } } })).toBe(90);
  });

  it('liefert bei fehlenden oder unbrauchbaren Werten 0', () => {
    expect(readScreenAngle({})).toBe(0);
    expect(readScreenAngle({ orientation: 'landscape' })).toBe(0);
    expect(readScreenAngle({ screen: { orientation: { angle: Number.NaN } } })).toBe(0);
  });
});
