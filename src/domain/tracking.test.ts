import { describe, expect, it } from 'vitest';
import type { TrackingMode } from '@/domain/models';
import {
  supportsBand,
  supportsHeight,
  supportsLoad,
  supportsReps,
  supportsSeconds,
  supportsWeight,
} from '@/domain/tracking';

const ALL_MODES: TrackingMode[] = ['reps_weight', 'time', 'time_weight'];

describe('Wiederholungen und Zeit', () => {
  it('trennt die drei Modi überschneidungsfrei', () => {
    expect(ALL_MODES.filter(supportsReps)).toEqual(['reps_weight']);
    expect(ALL_MODES.filter(supportsSeconds)).toEqual(['time', 'time_weight']);
    expect(ALL_MODES.filter(supportsLoad)).toEqual(['reps_weight', 'time_weight']);
  });

  it('behandelt einen fehlenden Modus als „trägt nichts mit"', () => {
    expect(supportsReps(undefined)).toBe(false);
    expect(supportsSeconds(undefined)).toBe(false);
    expect(supportsLoad(undefined)).toBe(false);
  });
});

describe('Kilo oder Band, nie beides', () => {
  it('zeigt ohne `loadKind` weiterhin Kilo', () => {
    // Additiv wie `includeWarmup`: alle Datensätze von vor der Einführung der
    // Bänder tragen kein `loadKind` und bleiben Kilo-Übungen.
    expect(supportsWeight('reps_weight', undefined)).toBe(true);
    expect(supportsBand('reps_weight', undefined)).toBe(false);
  });

  it('schaltet mit `band` von Kilo auf Band um', () => {
    expect(supportsWeight('reps_weight', 'band')).toBe(false);
    expect(supportsBand('reps_weight', 'band')).toBe(true);

    expect(supportsWeight('time_weight', 'band')).toBe(false);
    expect(supportsBand('time_weight', 'band')).toBe(true);
  });

  it('schließt einander in jeder Kombination aus', () => {
    for (const trackingMode of [...ALL_MODES, undefined]) {
      for (const loadKind of ['weight', 'band', undefined] as const) {
        expect(supportsWeight(trackingMode, loadKind) && supportsBand(trackingMode, loadKind)).toBe(
          false,
        );
      }
    }
  });

  it('gibt einer lastfreien Übung weder Kilo noch Band', () => {
    // `time` trägt keine Last - ein `loadKind` daran ändert daran nichts.
    expect(supportsWeight('time', 'weight')).toBe(false);
    expect(supportsBand('time', 'band')).toBe(false);
  });

  it('verliert das Band, sobald die Belastungsart fehlt', () => {
    /*
     * Die Falle, vor der CLAUDE.md warnt: „Call sites that have a `loadKind`
     * must pass it - the one-argument form silently keeps showing kg." Ein
     * Aufruf ohne zweites Argument ist nicht falsch genug, um aufzufallen - er
     * zeigt der Bandübung stumm ein Kilofeld.
     */
    expect(supportsWeight('reps_weight')).toBe(true);
    expect(supportsBand('reps_weight')).toBe(false);
  });
});

describe('Höhe in Zentimetern', () => {
  it('steht neben Kilo und Band, nicht an deren Stelle', () => {
    // Ein Step-Down von 25 cm darf Kurzhanteln tragen, ein Bandzug aus 20 cm
    // ein Band - die Höhe verdrängt keines von beiden.
    expect([supportsHeight(true), supportsWeight('reps_weight', 'weight')]).toEqual([true, true]);
    expect([supportsHeight(true), supportsBand('reps_weight', 'band')]).toEqual([true, true]);
  });

  it('trägt eine Übung ohne jede Last', () => {
    // Als einziges Feld hängt die Höhe nicht am Tracking-Modus: `time` gibt
    // weder Kilo noch Band her, die Höhe bleibt trotzdem.
    expect(supportsLoad('time')).toBe(false);
    expect(supportsHeight(true)).toBe(true);
  });

  it('zählt `undefined` als aus und schreibt kein `false` vor', () => {
    expect(supportsHeight(undefined)).toBe(false);
    expect(supportsHeight(false)).toBe(false);
  });
});
