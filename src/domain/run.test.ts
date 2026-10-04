import { describe, expect, it } from 'vitest';
import {
  durationFromParts,
  formatPace,
  formatRunDuration,
  paceSecondsPerKm,
  splitDuration,
  validateRunLogValues,
  type RunLogValues,
} from '@/domain/run';

const today = new Date(2026, 9, 4, 18);
const valid: RunLogValues = {
  date: '2026-10-04',
  distanceKm: 10,
  durationSeconds: 3120,
  elevationGainM: null,
  averageHeartRate: null,
  notes: null,
};
const check = (patch: Partial<RunLogValues>) => validateRunLogValues({ ...valid, ...patch }, today);

describe('Dauer', () => {
  it('rechnet Teile um und zurück', () => {
    expect(durationFromParts(1, 21, 5)).toBe(4865);
    expect(splitDuration(4865)).toEqual({ hours: 1, minutes: 21, seconds: 5 });
  });
});

describe('Pace und Formatierung', () => {
  it('rechnet die Pace', () => {
    expect(paceSecondsPerKm(10, 3120)).toBe(312);
    expect(paceSecondsPerKm(0, 3120)).toBeUndefined();
    expect(paceSecondsPerKm(5, 0)).toBeUndefined();
  });

  it('formatiert die Pace', () => {
    expect(formatPace(312)).toBe('5:12');
    expect(formatPace(299.6)).toBe('5:00');
    expect(formatPace(65)).toBe('1:05');
  });

  it('formatiert die Dauer', () => {
    expect(formatRunDuration(3150)).toBe('52:30');
    expect(formatRunDuration(4865)).toBe('1:21:05');
    expect(formatRunDuration(59)).toBe('0:59');
  });
});

describe('validateRunLogValues', () => {
  it('nimmt einen gültigen Lauf an', () => {
    expect(check({})).toBeUndefined();
  });

  it('prüft Strecke und Dauer', () => {
    expect(check({ distanceKm: 0 })).toBe('Bitte eine Strecke über 0 km eintragen.');
    expect(check({ durationSeconds: 0 })).toBe('Bitte eine Dauer eintragen.');
  });

  it('prüft das Datum', () => {
    expect(check({ date: '2026-13-01' })).toBe('Bitte ein gültiges Datum eintragen.');
    expect(check({ date: '2026-02-30' })).toBe('Bitte ein gültiges Datum eintragen.');
    expect(check({ date: '2026-10-05' })).toBe('Ein Lauf kann nicht in der Zukunft liegen.');
    expect(check({ date: '2026-10-04' })).toBeUndefined();
  });

  it('prüft Höhenmeter', () => {
    expect(check({ elevationGainM: 12.5 })).toBe('Höhenmeter bitte als ganze Zahl ab 0.');
    expect(check({ elevationGainM: -1 })).toBe('Höhenmeter bitte als ganze Zahl ab 0.');
    expect(check({ elevationGainM: 180 })).toBeUndefined();
  });

  it('prüft den Puls', () => {
    for (const averageHeartRate of [29, 251, 150.5]) {
      expect(check({ averageHeartRate })).toBe('Puls bitte zwischen 30 und 250.');
    }
    expect(check({ averageHeartRate: null })).toBeUndefined();
  });
});
