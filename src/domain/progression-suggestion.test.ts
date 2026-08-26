import { describe, expect, it } from 'vitest';
import type { BandLevel, WorkoutSessionExercise, WorkoutSetLog } from '@/domain/models';
import {
  describeProgressionSuggestion,
  nextBandLevel,
  resolveProgressionDimension,
  suggestNextProgression,
} from '@/domain/progression-suggestion';

function exercise(overrides: Partial<WorkoutSessionExercise> = {}): WorkoutSessionExercise {
  return {
    id: 'session-exercise-1',
    sessionId: 'session-1',
    exerciseId: 'exercise-1',
    exerciseNameSnapshot: 'Front Squat',
    trackingMode: 'reps_weight',
    unilateral: false,
    orderIndex: 1,
    wasSkipped: false,
    addedInSession: false,
    workSetCount: 3,
    targetReps: 8,
    targetRepsMax: 10,
    ...overrides,
  };
}

let logCounter = 0;

function log(overrides: Partial<WorkoutSetLog> = {}): WorkoutSetLog {
  logCounter += 1;

  return {
    id: `set-${logCounter}`,
    sessionExerciseId: 'session-exercise-1',
    setKind: 'work',
    side: 'both',
    setNumber: 1,
    completed: true,
    ...overrides,
  };
}

const bandLevels: BandLevel[] = [
  {
    id: 'band-gelb',
    name: 'gelb',
    orderIndex: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'band-gruen',
    name: 'grün',
    orderIndex: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'band-rot',
    name: 'rot',
    orderIndex: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

describe('suggestNextProgression', () => {
  it('schlägt ohne Vorgeschichte nichts vor', () => {
    expect(suggestNextProgression({ exercise: exercise(), lastWorkLogs: [] })).toBeUndefined();
  });

  it('schlägt ohne geplante Decke nichts vor', () => {
    // Eine Wiederholungsvorgabe allein ist ein Boden, kein Deckel - ohne
    // targetRepsMax hat "Spanne ausgereizt?" keine Antwort.
    expect(
      suggestNextProgression({
        exercise: exercise({ targetRepsMax: undefined }),
        lastWorkLogs: [
          log({ reps: 12, weight: 60 }),
          log({ reps: 12, weight: 60 }),
          log({ reps: 12, weight: 60 }),
        ],
      }),
    ).toBeUndefined();
  });

  it('schlägt nichts vor, solange ein Satz unter der Decke bleibt', () => {
    expect(
      suggestNextProgression({
        exercise: exercise(),
        lastWorkLogs: [
          log({ reps: 10, weight: 60 }),
          log({ reps: 10, weight: 60 }),
          log({ reps: 9, weight: 60 }),
        ],
      }),
    ).toBeUndefined();
  });

  it('schlägt den nächsten Gewichtsschritt vor, wenn alle Sätze die Decke erreichen', () => {
    expect(
      suggestNextProgression({
        exercise: exercise(),
        lastWorkLogs: [
          log({ reps: 10, weight: 60 }),
          log({ reps: 10, weight: 60 }),
          log({ reps: 10, weight: 60 }),
        ],
      }),
    ).toEqual({ kind: 'weight', value: 62.5, reason: 'reps_range_topped' });
  });

  it('schlägt auch über der Decke vor', () => {
    // Wer 11 von 8-10 geschafft hat, hat den Schritt erst recht verdient.
    expect(
      suggestNextProgression({
        exercise: exercise(),
        lastWorkLogs: [log({ reps: 11, weight: 60 }), log({ reps: 12, weight: 60 })],
      }),
    ).toMatchObject({ kind: 'weight', value: 62.5 });
  });

  it('schlägt nichts vor, wenn ein Satz gar keine Wiederholungen trägt', () => {
    // Ein fehlender Wert besteht die Deckenprüfung nicht: was nicht gemessen
    // wurde, gilt nicht als geschafft.
    expect(
      suggestNextProgression({
        exercise: exercise(),
        lastWorkLogs: [log({ reps: 10, weight: 60 }), log({ reps: undefined, weight: 60 })],
      }),
    ).toBeUndefined();
  });

  it('schlägt nichts vor, wenn von einer einseitigen Übung nur eine Seite vorliegt', () => {
    expect(
      suggestNextProgression({
        exercise: exercise({ unilateral: true }),
        lastWorkLogs: [
          log({ side: 'left', reps: 10, weight: 20 }),
          log({ side: 'left', setNumber: 2, reps: 10, weight: 20 }),
        ],
      }),
    ).toBeUndefined();
  });

  it('nimmt bei beidseitiger Ausführung die schwächere Seite als Basis', () => {
    expect(
      suggestNextProgression({
        exercise: exercise({ unilateral: true }),
        lastWorkLogs: [
          log({ side: 'left', reps: 10, weight: 20 }),
          log({ side: 'right', reps: 10, weight: 22.5 }),
        ],
      }),
    ).toEqual({ kind: 'weight', value: 22.5, reason: 'reps_range_topped' });
  });

  it('rechnet 62,5 + 2,5 auf genau 65', () => {
    const suggestion = suggestNextProgression({
      exercise: exercise(),
      lastWorkLogs: [log({ reps: 10, weight: 62.5 }), log({ reps: 10, weight: 62.5 })],
    });

    expect(suggestion).toEqual({ kind: 'weight', value: 65, reason: 'reps_range_topped' });
  });

  it('schlägt nichts vor, wenn kein einziger Satz ein Gewicht trägt', () => {
    expect(
      suggestNextProgression({
        exercise: exercise(),
        lastWorkLogs: [log({ reps: 10 }), log({ reps: 10 })],
      }),
    ).toBeUndefined();
  });

  it('schlägt das nächstschwerere Band vor', () => {
    expect(
      suggestNextProgression({
        exercise: exercise({ loadKind: 'band', targetBandId: 'band-gelb' }),
        lastWorkLogs: [
          log({ reps: 10, bandId: 'band-gelb' }),
          log({ reps: 10, bandId: 'band-gelb' }),
        ],
        bandLevels,
      }),
    ).toEqual({
      kind: 'band',
      bandId: 'band-gruen',
      bandName: 'grün',
      reason: 'reps_range_topped',
    });
  });

  it('schlägt bei gemischten Bändern nichts vor', () => {
    expect(
      suggestNextProgression({
        exercise: exercise({ loadKind: 'band' }),
        lastWorkLogs: [
          log({ reps: 10, bandId: 'band-gelb' }),
          log({ reps: 10, bandId: 'band-gruen' }),
        ],
        bandLevels,
      }),
    ).toBeUndefined();
  });

  it('schlägt beim schwersten Band nichts vor', () => {
    expect(
      suggestNextProgression({
        exercise: exercise({ loadKind: 'band' }),
        lastWorkLogs: [log({ reps: 10, bandId: 'band-rot' }), log({ reps: 10, bandId: 'band-rot' })],
        bandLevels,
      }),
    ).toBeUndefined();
  });

  it('lässt die Höhe das Gewicht schlagen', () => {
    // Man schaltet tracksHeight genau deshalb ein: dort findet der
    // Fortschritt statt. Dieselbe Rangfolge wie im Diagramm.
    expect(
      suggestNextProgression({
        exercise: exercise({ tracksHeight: true }),
        lastWorkLogs: [
          log({ reps: 10, weight: 12.5, heightCm: 25 }),
          log({ reps: 10, weight: 12.5, heightCm: 25 }),
        ],
      }),
    ).toEqual({ kind: 'heightCm', value: 30, reason: 'reps_range_topped' });
  });

  it('steigert eine Zeitübung von der Vorgabe aus, nicht vom gehaltenen Wert', () => {
    expect(
      suggestNextProgression({
        exercise: exercise({
          trackingMode: 'time',
          targetReps: undefined,
          targetRepsMax: undefined,
          targetSeconds: 45,
        }),
        lastWorkLogs: [log({ seconds: 47 }), log({ seconds: 45 })],
      }),
    ).toEqual({ kind: 'seconds', value: 50, reason: 'seconds_target_met' });
  });

  it('schlägt bei Zeit mit Gewicht das Gewicht vor - das ist die Doppelprogression', () => {
    expect(
      suggestNextProgression({
        exercise: exercise({
          trackingMode: 'time_weight',
          targetReps: undefined,
          targetRepsMax: undefined,
          targetSeconds: 45,
        }),
        lastWorkLogs: [
          log({ seconds: 45, weight: 10 }),
          log({ seconds: 45, weight: 10 }),
          log({ seconds: 45, weight: 10 }),
        ],
      }),
    ).toEqual({ kind: 'weight', value: 12.5, reason: 'seconds_target_met' });
  });

  it('schlägt nichts vor, solange die Zeitvorgabe nicht gehalten wurde', () => {
    expect(
      suggestNextProgression({
        exercise: exercise({
          trackingMode: 'time',
          targetReps: undefined,
          targetRepsMax: undefined,
          targetSeconds: 45,
        }),
        lastWorkLogs: [log({ seconds: 45 }), log({ seconds: 38 })],
      }),
    ).toBeUndefined();
  });
});

describe('resolveProgressionDimension', () => {
  const cases: {
    name: string;
    input: Parameters<typeof resolveProgressionDimension>[0];
    expected: ReturnType<typeof resolveProgressionDimension>;
  }[] = [
    { name: 'Höhe schlägt alles', input: { trackingMode: 'reps_weight', tracksHeight: true }, expected: 'heightCm' },
    {
      name: 'Höhe schlägt auch das Band',
      input: { trackingMode: 'reps_weight', loadKind: 'band', tracksHeight: true },
      expected: 'heightCm',
    },
    { name: 'Band vor Gewicht', input: { trackingMode: 'reps_weight', loadKind: 'band' }, expected: 'band' },
    { name: 'Gewicht ohne loadKind', input: { trackingMode: 'reps_weight' }, expected: 'weight' },
    { name: 'Gewicht bei Zeit mit Last', input: { trackingMode: 'time_weight' }, expected: 'weight' },
    { name: 'Sekunden bei reiner Zeit', input: { trackingMode: 'time' }, expected: 'seconds' },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(resolveProgressionDimension(testCase.input)).toBe(testCase.expected);
    });
  }
});

describe('nextBandLevel', () => {
  it('nimmt den nächsten Rang, nicht die nächste Zeile', () => {
    expect(nextBandLevel([...bandLevels].reverse(), 'band-gelb')?.id).toBe('band-gruen');
  });

  it('gibt für ein unbekanntes Band nichts zurück', () => {
    // Ohne Rang im Katalog gibt es kein "nächstes" - ein gelöschtes Band
    // kostet einen Vorschlag, nie einen falschen.
    expect(nextBandLevel(bandLevels, 'band-weg')).toBeUndefined();
  });
});

describe('describeProgressionSuggestion', () => {
  it('schreibt deutsche Zahlen', () => {
    expect(
      describeProgressionSuggestion({ kind: 'weight', value: 62.5, reason: 'reps_range_topped' }),
    ).toBe('Auf 62,5 kg');
    expect(
      describeProgressionSuggestion({ kind: 'heightCm', value: 30, reason: 'reps_range_topped' }),
    ).toBe('Auf 30 cm');
    expect(
      describeProgressionSuggestion({ kind: 'seconds', value: 50, reason: 'seconds_target_met' }),
    ).toBe('Auf 50 s');
    expect(
      describeProgressionSuggestion({
        kind: 'band',
        bandId: 'band-gruen',
        bandName: 'grün',
        reason: 'reps_range_topped',
      }),
    ).toBe('Auf Band grün');
  });
});
