import { describe, expect, it } from 'vitest';
import { describeRemainingEstimate, formatRemainingEstimate } from '@/lib/format';

describe('formatRemainingEstimate', () => {
  it('sagt unter einer Minute nie "0 min"', () => {
    expect(formatRemainingEstimate(0)).toEqual({ value: '<1', unit: 'min' });
    expect(formatRemainingEstimate(29)).toEqual({ value: '<1', unit: 'min' });
  });

  it('rundet auf ganze Minuten', () => {
    expect(formatRemainingEstimate(90)).toEqual({ value: '~2', unit: 'min' });
    expect(formatRemainingEstimate(2520)).toEqual({ value: '~42', unit: 'min' });
  });

  it('schaltet ab einer vollen Stunde auf Stunden um', () => {
    // Gerundet wird vor dem Umschalten: 59:30 sind bereits 60 Minuten.
    expect(formatRemainingEstimate(3540)).toEqual({ value: '~59', unit: 'min' });
    expect(formatRemainingEstimate(3570)).toEqual({ value: '~1:00', unit: 'h' });
    expect(formatRemainingEstimate(3630)).toEqual({ value: '~1:01', unit: 'h' });
    expect(formatRemainingEstimate(4800)).toEqual({ value: '~1:20', unit: 'h' });
  });

  it('nimmt eine negative Eingabe als abgelaufen', () => {
    expect(formatRemainingEstimate(-10)).toEqual({ value: '<1', unit: 'min' });
  });
});

describe('describeRemainingEstimate', () => {
  it('beschreibt Minuten und Stunden ausgeschrieben', () => {
    expect(describeRemainingEstimate(20)).toBe('weniger als eine Minute');
    expect(describeRemainingEstimate(2520)).toBe('etwa 42 Minuten');
    expect(describeRemainingEstimate(3600)).toBe('etwa eine Stunde');
    expect(describeRemainingEstimate(4800)).toBe('etwa eine Stunde und 20 Minuten');
    expect(describeRemainingEstimate(7500)).toBe('etwa 2 Stunden und 5 Minuten');
  });
});
