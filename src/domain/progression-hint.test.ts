import { describe, expect, it } from 'vitest';
import type { SetValues } from '@/domain/history';
import type { BandLevel, WorkoutSessionExercise, WorkoutSetLog } from '@/domain/models';
import { hasProgressionDimension, hasProgressionHint, nextBandLevel } from '@/domain/progression-hint';

/*
 * Die Marke ist eine Aussage über *eine* Satzzeile.
 *
 * Deshalb steht in jedem Fall unten genau eine Zeile und genau ein Vorgänger -
 * und deshalb ist der wichtigste Test der, dass die Satznummer exakt passen
 * muss: der Vorgänger dieser Regel nahm das Minimum über alle Sätze und machte
 * damit aus einer Rampe (10×30 / 10×35 / 10×40) einen Vorschlag unterhalb der
 * Arbeitslast.
 */

type HintExercise = Parameters<typeof hasProgressionHint>[0]['exercise'];

function exercise(overrides: Partial<WorkoutSessionExercise> = {}): HintExercise {
  return {
    trackingMode: 'reps_weight',
    unilateral: false,
    targetReps: 8,
    targetRepsMax: 10,
    ...overrides,
  };
}

function log(overrides: Partial<WorkoutSetLog> = {}): Pick<WorkoutSetLog, 'setKind' | 'completed'> {
  return { setKind: 'work', completed: false, ...overrides };
}

const bandLevels: BandLevel[] = [
  { id: 'band-gelb', name: 'gelb', orderIndex: 1, createdAt: '', updatedAt: '' },
  { id: 'band-gruen', name: 'grün', orderIndex: 2, createdAt: '', updatedAt: '' },
  { id: 'band-rot', name: 'rot', orderIndex: 3, createdAt: '', updatedAt: '' },
];

describe('hasProgressionHint', () => {
  it('markiert einen offenen Arbeitssatz, dessen Vorgänger die Decke erreicht hat', () => {
    expect(
      hasProgressionHint({ exercise: exercise(), log: log(), lastExact: { reps: 10, weight: 60 } }),
    ).toBe(true);
  });

  it('markiert den Aufwärmsatz nie - dort wird nichts ausgereizt', () => {
    expect(
      hasProgressionHint({
        exercise: exercise(),
        log: log({ setKind: 'warmup' }),
        lastExact: { reps: 10 },
      }),
    ).toBe(false);
  });

  it('markiert einen abgehakten Satz nicht - er ist erledigt, kein Nachtrag', () => {
    expect(
      hasProgressionHint({
        exercise: exercise(),
        log: log({ completed: true }),
        lastExact: { reps: 10 },
      }),
    ).toBe(false);
  });

  it('schweigt, wenn die Übung die Steigerung abgeschaltet hat', () => {
    expect(
      hasProgressionHint({
        exercise: exercise({ suggestProgression: false }),
        log: log(),
        lastExact: { reps: 12 },
      }),
    ).toBe(false);
  });

  it('zählt `undefined` als eingeschaltet, wie `includeWarmup`', () => {
    expect(
      hasProgressionHint({
        exercise: exercise({ suggestProgression: undefined }),
        log: log(),
        lastExact: { reps: 10 },
      }),
    ).toBe(true);
  });

  it('schweigt ohne Vorgänger - ohne letzte Einheit gibt es nichts zu beobachten', () => {
    expect(hasProgressionHint({ exercise: exercise(), log: log() })).toBe(false);
  });

  it('schweigt, wenn der Vorgänger die Decke verfehlt hat', () => {
    expect(
      hasProgressionHint({ exercise: exercise(), log: log(), lastExact: { reps: 9 } }),
    ).toBe(false);
  });

  it('nimmt `>=` statt `===`: 11 von 8-10 hat den Schritt erst recht verdient', () => {
    expect(
      hasProgressionHint({ exercise: exercise(), log: log(), lastExact: { reps: 11 } }),
    ).toBe(true);
  });

  it('zählt einen fehlenden Messwert nicht als geschafft', () => {
    expect(
      hasProgressionHint({ exercise: exercise(), log: log(), lastExact: { weight: 60 } }),
    ).toBe(false);
  });

  describe('die Decke', () => {
    it('ist `targetRepsMax`, wo eine Spanne eingetragen ist', () => {
      const spanne = exercise({ targetReps: 8, targetRepsMax: 12 });

      expect(hasProgressionHint({ exercise: spanne, log: log(), lastExact: { reps: 10 } })).toBe(
        false,
      );
      expect(hasProgressionHint({ exercise: spanne, log: log(), lastExact: { reps: 12 } })).toBe(
        true,
      );
    });

    it('fällt auf `targetReps` zurück, wo keine Spanne eingetragen ist', () => {
      const einzahl = exercise({ targetReps: 10, targetRepsMax: undefined });

      expect(hasProgressionHint({ exercise: einzahl, log: log(), lastExact: { reps: 9 } })).toBe(
        false,
      );
      expect(hasProgressionHint({ exercise: einzahl, log: log(), lastExact: { reps: 10 } })).toBe(
        true,
      );
    });

    it('fehlt ganz, wenn die Übung kein Wiederholungsziel trägt', () => {
      expect(
        hasProgressionHint({
          exercise: exercise({ targetReps: undefined, targetRepsMax: undefined }),
          log: log(),
          lastExact: { reps: 20 },
        }),
      ).toBe(false);
    });

    it('ist bei Zeit die Zielzeit selbst - eine Zeitvorgabe *ist* eine Decke', () => {
      const plank = exercise({
        trackingMode: 'time',
        targetReps: undefined,
        targetRepsMax: undefined,
        targetSeconds: 45,
      });

      expect(hasProgressionHint({ exercise: plank, log: log(), lastExact: { seconds: 44 } })).toBe(
        false,
      );
      expect(hasProgressionHint({ exercise: plank, log: log(), lastExact: { seconds: 45 } })).toBe(
        true,
      );
    });

    it('schweigt bei einer Zeitübung ohne Zielzeit', () => {
      expect(
        hasProgressionHint({
          exercise: exercise({
            trackingMode: 'time',
            targetReps: undefined,
            targetRepsMax: undefined,
            targetSeconds: undefined,
          }),
          log: log(),
          lastExact: { seconds: 90 },
        }),
      ).toBe(false);
    });
  });

  describe('beim Band', () => {
    const bandExercise = exercise({ trackingMode: 'reps_weight', loadKind: 'band' });

    it('markiert, solange der Katalog ein schwereres Band hergibt', () => {
      expect(
        hasProgressionHint({
          exercise: bandExercise,
          log: log(),
          lastExact: { reps: 10, bandId: 'band-gelb' },
          bandLevels,
        }),
      ).toBe(true);
    });

    it('schweigt beim schwersten Band - die Marke wäre eine Lüge', () => {
      expect(
        hasProgressionHint({
          exercise: bandExercise,
          log: log(),
          lastExact: { reps: 10, bandId: 'band-rot' },
          bandLevels,
        }),
      ).toBe(false);
    });

    it('schweigt ohne geloggtes Band - es gibt keinen Stand, von dem aus zu steigern wäre', () => {
      expect(
        hasProgressionHint({
          exercise: bandExercise,
          log: log(),
          lastExact: { reps: 10 },
          bandLevels,
        }),
      ).toBe(false);
    });
  });

  /*
   * Die beiden Fälle, für die der Umbau gemacht wurde. Sie prüfen keine neue
   * Regel, sondern dass der Aufrufer die richtige Zeile hereinreicht -
   * `hasProgressionHint` sieht immer nur eine.
   */
  describe('satz- und seitengenau', () => {
    it('behandelt eine Rampe satzweise', () => {
      // Vorgänger: 10×30, 10×35, 10×40 - jeder Satz hat sein Ziel erreicht,
      // also trägt auch jeder seine Marke. Der alte Vorschlag hätte über alle
      // drei das Minimum genommen und am ersten Satz 32,5 kg angeboten.
      const rampe: SetValues[] = [
        { reps: 10, weight: 30 },
        { reps: 10, weight: 35 },
        { reps: 10, weight: 40 },
      ];

      expect(
        rampe.map((lastExact) => hasProgressionHint({ exercise: exercise(), log: log(), lastExact })),
      ).toEqual([true, true, true]);
    });

    it('entscheidet je Seite - links geschafft heißt nicht rechts geschafft', () => {
      const einbeinig = exercise({ unilateral: true });

      expect(
        hasProgressionHint({ exercise: einbeinig, log: log(), lastExact: { reps: 10 } }),
      ).toBe(true);
      expect(
        hasProgressionHint({ exercise: einbeinig, log: log(), lastExact: { reps: 8 } }),
      ).toBe(false);
    });
  });
});

/*
 * Kein Gegenbeispiel, und das ist kein Versäumnis: jeder der drei
 * Tracking-Modi trägt heute eine Dimension. Die Prüfung bleibt als Wache für
 * einen Modus, der sie nicht hätte - eine reine Wiederholungsübung ohne Last
 * kann nur in Wiederholungen wachsen, und die *sind* die Spanne.
 */
describe('hasProgressionDimension', () => {
  it('findet bei jedem Tracking-Modus etwas, das wachsen kann', () => {
    expect(hasProgressionDimension({ trackingMode: 'reps_weight' })).toBe(true);
    expect(hasProgressionDimension({ trackingMode: 'reps_weight', loadKind: 'band' })).toBe(true);
    expect(hasProgressionDimension({ trackingMode: 'time' })).toBe(true);
    expect(hasProgressionDimension({ trackingMode: 'time_weight' })).toBe(true);
    expect(hasProgressionDimension({ trackingMode: 'time', tracksHeight: true })).toBe(true);
  });
});

describe('nextBandLevel', () => {
  it('folgt `orderIndex`, nicht der Reihenfolge im Array', () => {
    expect(nextBandLevel([...bandLevels].reverse(), 'band-gelb')?.id).toBe('band-gruen');
  });

  it('kennt kein nächstes Band zu einer Id, die der Katalog nicht führt', () => {
    expect(nextBandLevel(bandLevels, 'band-weg')).toBeUndefined();
  });
});
