import { describe, expect, it } from 'vitest';
import { sumWorkVolume } from '@/domain/volume';
import type { WorkoutSetLog } from '@/domain/models';

function log(overrides: Partial<WorkoutSetLog>): WorkoutSetLog {
  return {
    id: crypto.randomUUID(),
    sessionExerciseId: 'session-exercise-1',
    setKind: 'work',
    side: 'both',
    setNumber: 1,
    completed: true,
    ...overrides,
  };
}

describe('sumWorkVolume', () => {
  it('multiplies load by repetitions across all sets', () => {
    expect(sumWorkVolume([log({ weight: 80, reps: 5 }), log({ weight: 90, reps: 3 })])).toBe(670);
  });

  it('falls back to seconds when an exercise is tracked on time', () => {
    expect(sumWorkVolume([log({ weight: 20, seconds: 60 })])).toBe(1200);
  });

  it('prefers repetitions over seconds when both are logged', () => {
    // `time_weight` erlaubt beides; die Wiederholung ist dann die Kennzahl.
    expect(sumWorkVolume([log({ weight: 10, reps: 8, seconds: 30 })])).toBe(80);
  });

  it('contributes nothing for sets without a load in kilos', () => {
    // Bänder tragen kein Gewicht - eine bandlastige Woche untertreibt deshalb.
    expect(sumWorkVolume([log({ reps: 15, bandId: 'band-green' })])).toBe(0);
    expect(sumWorkVolume([log({ weight: 60 })])).toBe(0);
  });

  it('returns zero for an empty list', () => {
    expect(sumWorkVolume([])).toBe(0);
  });

  it('sums exactly what it is given and filters nothing itself', () => {
    // Welche Sätze zählen, entscheidet die Aufrufstelle - hier zählt auch ein
    // nicht abgehakter Aufwärmsatz mit, weil er übergeben wurde.
    const logs = [log({ setKind: 'warmup', completed: false, weight: 40, reps: 10 })];
    expect(sumWorkVolume(logs)).toBe(400);
  });
});
