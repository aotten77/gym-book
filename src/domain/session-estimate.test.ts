import { describe, expect, it } from 'vitest';
import type { WorkoutSessionExercise, WorkoutSetLog } from '@/domain/models';
import {
  estimateRemainingSessionSeconds,
  estimatedEndAt,
  MAX_PACE_FACTOR,
  type SessionEstimateInput,
} from '@/domain/session-estimate';
import type { SupersetBlock } from '@/domain/superset';

/*
 * Die Zahlen in den Erwartungen sind ausgerechnet, nicht abgelesen: mit
 * `targetReps: 10` kostet eine Zeile 10 × 3 s Arbeit plus 20 s Handgriffe,
 * also 50 s, und eine Runde trägt zusätzlich die Pause - außer der letzten.
 */
const BASE = Date.parse('2026-08-02T18:00:00.000Z');

function at(offsetSeconds: number) {
  return new Date(BASE + offsetSeconds * 1000).toISOString();
}

function exercise(
  overrides: Partial<WorkoutSessionExercise> & Pick<WorkoutSessionExercise, 'id'>,
): WorkoutSessionExercise {
  return {
    sessionId: 'session-1',
    exerciseId: `exercise-${overrides.id}`,
    exerciseNameSnapshot: 'Übung',
    trackingMode: 'reps_weight',
    unilateral: false,
    orderIndex: 1,
    wasSkipped: false,
    addedInSession: false,
    workSetCount: 3,
    targetReps: 10,
    restSeconds: 90,
    ...overrides,
  };
}

function log(
  overrides: Partial<WorkoutSetLog> & Pick<WorkoutSetLog, 'id' | 'sessionExerciseId'>,
): WorkoutSetLog {
  return {
    setKind: 'work',
    side: 'both',
    setNumber: 1,
    completed: false,
    ...overrides,
  };
}

/** `count` Arbeitssätze einer beidseitigen Übung, aufsteigend nummeriert. */
function workSets(sessionExerciseId: string, count: number) {
  return Array.from({ length: count }, (_, index) =>
    log({
      id: `${sessionExerciseId}-${index + 1}`,
      sessionExerciseId,
      setNumber: index + 1,
    }),
  );
}

/** Hakt die ersten Zeilen ab, mit den übergebenen Abständen in Sekunden. */
function completeSets(logs: WorkoutSetLog[], offsets: number[]) {
  return logs.map((row, index) =>
    index < offsets.length ? { ...row, completed: true, completedAt: at(offsets[index]) } : row,
  );
}

function single(item: WorkoutSessionExercise): SupersetBlock<WorkoutSessionExercise> {
  return { kind: 'single', exercise: item };
}

function estimate(input: Partial<SessionEstimateInput> & Pick<SessionEstimateInput, 'blocks'>) {
  return estimateRemainingSessionSeconds({
    logsByExercise: {},
    now: BASE,
    ...input,
  });
}

describe('estimateRemainingSessionSeconds', () => {
  it('rechnet ohne Messung die reine Planzeit', () => {
    const item = exercise({ id: 'a1' });

    const result = estimate({
      blocks: [single(item)],
      logsByExercise: { a1: workSets('a1', 3) },
    });

    // (50 + 90) + (50 + 90) + 50 - die letzte Runde zahlt keine Pause.
    expect(result.remainingSeconds).toBe(330);
    expect(result.openRowCount).toBe(3);
    expect(result.sampleCount).toBe(0);
    expect(result.paceFactor).toBe(1);
    expect(result.quality).toBe('plan');
  });

  it('zählt im Supersatz nicht für jede Zeile eine volle Pause', () => {
    const first = exercise({ id: 'a1', supersetGroupId: 'group-1' });
    const second = exercise({ id: 'a2', supersetGroupId: 'group-1', orderIndex: 2 });
    const logsByExercise = { a1: workSets('a1', 2), a2: workSets('a2', 2) };

    const grouped = estimate({
      blocks: [{ kind: 'group', groupId: 'group-1', exercises: [first, second] }],
      logsByExercise,
    });
    const separate = estimate({
      blocks: [single({ ...first, supersetGroupId: undefined }), single({ ...second, supersetGroupId: undefined })],
      logsByExercise,
    });

    /*
     * Runde: 50 + 50 Arbeit, 25 Gerätewechsel, und als Nachlauf nur die Pause
     * der *zweiten* Übung (90) - die der ersten läuft ab, während die zweite
     * ausgeführt wird. Also (125 + 90) + 125.
     */
    expect(grouped.remainingSeconds).toBe(340);
    expect(separate.remainingSeconds).toBe(470);
    expect(grouped.remainingSeconds).toBeLessThan(separate.remainingSeconds);
  });

  it('lässt eine lange Unterbrechung nicht ins Tempo einfließen', () => {
    const item = exercise({ id: 'a1' });
    const rows = workSets('a1', 10);
    const durchgehend = [0, 280, 560, 840, 1120, 1400, 1680, 1960];
    const unterbrochen = [0, 280, 560, 840, 2040, 2320, 2600, 2880];

    const control = estimate({
      blocks: [single(item)],
      logsByExercise: { a1: completeSets(rows, durchgehend) },
      now: BASE + 1960 * 1000,
    });
    const interrupted = estimate({
      blocks: [single(item)],
      logsByExercise: { a1: completeSets(rows, unterbrochen) },
      now: BASE + 2880 * 1000,
    });

    expect(control.sampleCount).toBe(7);
    // Die Lücke von 20 Minuten fällt raus, die sechs übrigen Takte bleiben.
    expect(interrupted.sampleCount).toBe(6);
    expect(interrupted.paceFactor).toBe(control.paceFactor);
    expect(interrupted.remainingSeconds).toBe(control.remainingSeconds);
  });

  it('nimmt bei einer Zeitübung die Zielzeit statt der Wiederholungen', () => {
    const item = exercise({ id: 'a1', trackingMode: 'time', targetSeconds: 120, restSeconds: 60 });

    const result = estimate({
      blocks: [single(item)],
      logsByExercise: { a1: workSets('a1', 2) },
    });

    // (120 + 20 + 60) + (120 + 20)
    expect(result.remainingSeconds).toBe(340);
  });

  it('fällt ohne eigene Pause auf die Standardpause zurück', () => {
    const item = exercise({ id: 'a1', restSeconds: undefined });

    const result = estimate({
      blocks: [single(item)],
      logsByExercise: { a1: workSets('a1', 2) },
    });

    // 90 Sekunden aus DEFAULT_REST_SECONDS: (50 + 90) + 50
    expect(result.remainingSeconds).toBe(190);
  });

  it('rechnet den Aufwärmsatz mit halber Pause', () => {
    const item = exercise({ id: 'a1', restSeconds: 100 });

    const result = estimate({
      blocks: [single(item)],
      logsByExercise: {
        a1: [
          log({ id: 'w', sessionExerciseId: 'a1', setKind: 'warmup', setNumber: 0 }),
          log({ id: 'a1-1', sessionExerciseId: 'a1' }),
        ],
      },
    });

    // (50 + 50) + 50
    expect(result.remainingSeconds).toBe(150);
  });

  it('lässt die Pause nach dem letzten Satz weg', () => {
    const item = exercise({ id: 'a1' });

    const result = estimate({
      blocks: [single(item)],
      logsByExercise: { a1: workSets('a1', 1) },
    });

    expect(result.remainingSeconds).toBe(50);
  });

  it('rechnet auf einer einbeinigen Übung zwei Zeilen, aber eine Pause', () => {
    const item = exercise({ id: 'a1', unilateral: true });

    const result = estimate({
      blocks: [single(item)],
      logsByExercise: {
        a1: [
          log({ id: '1', sessionExerciseId: 'a1', side: 'left' }),
          log({ id: '2', sessionExerciseId: 'a1', side: 'right' }),
          log({ id: '3', sessionExerciseId: 'a1', side: 'left', setNumber: 2 }),
          log({ id: '4', sessionExerciseId: 'a1', side: 'right', setNumber: 2 }),
        ],
      },
    });

    // Runde: 2 × 50 plus 20 Seitenwechsel = 120, dazu einmal 90 Pause.
    expect(result.remainingSeconds).toBe(330);
    expect(result.openRowCount).toBe(4);
  });

  it('ignoriert eine ausgelassene Übung vollständig', () => {
    const item = exercise({ id: 'a1' });
    const skipped = exercise({ id: 'a2', orderIndex: 2, wasSkipped: true });

    const result = estimate({
      blocks: [single(item), single(skipped)],
      logsByExercise: { a1: workSets('a1', 1), a2: workSets('a2', 4) },
    });

    expect(result.remainingSeconds).toBe(50);
    expect(result.openRowCount).toBe(1);
  });

  it('meldet keine offenen Zeilen, wenn alles erledigt ist', () => {
    const item = exercise({ id: 'a1' });

    const result = estimate({
      blocks: [single(item)],
      logsByExercise: { a1: completeSets(workSets('a1', 2), [0, 280]) },
      now: BASE + 280 * 1000,
    });

    expect(result.openRowCount).toBe(0);
    expect(result.remainingSeconds).toBe(0);
  });

  it('kommt mit einer leeren Einheit klar', () => {
    const result = estimate({ blocks: [] });

    expect(result).toEqual({
      remainingSeconds: 0,
      openRowCount: 0,
      sampleCount: 0,
      paceFactor: 1,
      quality: 'plan',
    });
  });

  it('misst das Tempo erst ab der zweiten erledigten Zeile', () => {
    const item = exercise({ id: 'a1' });

    const result = estimate({
      blocks: [single(item)],
      logsByExercise: { a1: completeSets(workSets('a1', 3), [0]) },
      now: BASE,
    });

    expect(result.sampleCount).toBe(0);
    expect(result.quality).toBe('plan');
    // Unverändert die Planzeit der beiden offenen Zeilen: (50 + 90) + 50
    expect(result.remainingSeconds).toBe(190);
  });

  it('skaliert die Restzeit mit dem gemessenen Tempo', () => {
    const item = exercise({ id: 'a1' });
    const offsets = [0, 280, 560, 840, 1120, 1400, 1680];

    const result = estimate({
      blocks: [single(item)],
      logsByExercise: { a1: completeSets(workSets('a1', 8), offsets) },
      now: BASE + 1680 * 1000,
    });

    // Jede Zeile brauchte doppelt so lange wie geplant (280 statt 140).
    expect(result.sampleCount).toBe(6);
    expect(result.paceFactor).toBe(2);
    expect(result.quality).toBe('measured');
    expect(result.remainingSeconds).toBe(100);
  });

  it('gewichtet eine einzelne Messung nur schwach', () => {
    const item = exercise({ id: 'a1' });

    const result = estimate({
      blocks: [single(item)],
      logsByExercise: { a1: completeSets(workSets('a1', 4), [0, 420]) },
      now: BASE + 420 * 1000,
    });

    // Dreifaches Tempo, gedeckelt auf 2,5 und mit einem Sechstel gewichtet.
    expect(result.sampleCount).toBe(1);
    expect(result.paceFactor).toBeCloseTo(1.25, 5);
  });

  it('nimmt den Median, nicht den Mittelwert', () => {
    const item = exercise({ id: 'a1' });
    const rows = workSets('a1', 10);

    const control = estimate({
      blocks: [single(item)],
      logsByExercise: { a1: completeSets(rows, [0, 280, 560, 840, 1120, 1400, 1680]) },
      now: BASE + 1680 * 1000,
    });
    // Ein Ausreißer knapp unter der Verwurfsgrenze - ein Mittel würde kippen.
    const outlier = estimate({
      blocks: [single(item)],
      logsByExercise: { a1: completeSets(rows, [0, 280, 560, 840, 1120, 1400, 1940]) },
      now: BASE + 1940 * 1000,
    });

    expect(outlier.sampleCount).toBe(control.sampleCount);
    expect(outlier.paceFactor).toBe(control.paceFactor);
  });

  it('deckelt das Tempo nach oben', () => {
    const item = exercise({ id: 'a1' });
    const offsets = [0, 560, 1120, 1680, 2240, 2800, 3360];

    const result = estimate({
      blocks: [single(item)],
      logsByExercise: { a1: completeSets(workSets('a1', 10), offsets) },
      now: BASE + 3360 * 1000,
    });

    // Vierfaches Tempo, aber mehr als MAX_PACE_FACTOR wird nicht angenommen.
    expect(result.paceFactor).toBe(MAX_PACE_FACTOR);
  });

  it('zieht die laufende Zeile ab, aber höchstens ihr eigenes Budget', () => {
    const item = exercise({ id: 'a1' });
    const logsByExercise = { a1: completeSets(workSets('a1', 8), [0]) };

    const kurz = estimate({ blocks: [single(item)], logsByExercise, now: BASE + 30 * 1000 });
    const lang = estimate({ blocks: [single(item)], logsByExercise, now: BASE + 900 * 1000 });

    // Offen: 6 × 140 plus die letzte Zeile mit 50 = 890.
    expect(kurz.remainingSeconds).toBe(860);
    expect(lang.remainingSeconds).toBe(750);
  });

  it('rechnet ohne abgehakte Zeile nichts an, egal wie spät es ist', () => {
    const item = exercise({ id: 'a1' });

    const result = estimate({
      blocks: [single(item)],
      logsByExercise: { a1: workSets('a1', 3) },
      now: BASE + 3600 * 1000,
    });

    expect(result.remainingSeconds).toBe(330);
  });
});

describe('estimatedEndAt', () => {
  it('legt die Restdauer auf die Uhr', () => {
    const item = exercise({ id: 'a1' });
    const result = estimate({
      blocks: [single(item)],
      logsByExercise: { a1: workSets('a1', 3) },
    });

    expect(estimatedEndAt(result, BASE)).toBe(BASE + 330 * 1000);
  });

  it('gibt ohne offene Zeile kein Ende zurück', () => {
    const item = exercise({ id: 'a1' });
    const result = estimate({
      blocks: [single(item)],
      logsByExercise: { a1: completeSets(workSets('a1', 3), [0, 140, 280]) },
    });

    expect(result.openRowCount).toBe(0);
    // "fertig" ist ein Zustand, keine Uhrzeit - deshalb null und nicht `now`.
    expect(estimatedEndAt(result, BASE + 400 * 1000)).toBeNull();
  });

  it('steht während einer Pause still, obwohl die Restdauer sinkt', () => {
    const item = exercise({ id: 'a1' });
    const logsByExercise = { a1: completeSets(workSets('a1', 8), [0]) };

    const früh = BASE + 30 * 1000;
    const später = BASE + 60 * 1000;

    const a = estimate({ blocks: [single(item)], logsByExercise, now: früh });
    const b = estimate({ blocks: [single(item)], logsByExercise, now: später });

    /*
     * Genau das ist der Grund, die Uhrzeit überhaupt anzuzeigen: der Abzug der
     * verstrichenen Pause sinkt im selben Takt, in dem `now` steigt.
     */
    expect(b.remainingSeconds).toBeLessThan(a.remainingSeconds);
    expect(estimatedEndAt(b, später)).toBe(estimatedEndAt(a, früh));
  });

  it('wandert nach hinten, sobald länger getrödelt wird als die nächste Zeile kostet', () => {
    const item = exercise({ id: 'a1' });
    const logsByExercise = { a1: completeSets(workSets('a1', 8), [0]) };

    const früh = BASE + 30 * 1000;
    const spät = BASE + 900 * 1000;

    const a = estimate({ blocks: [single(item)], logsByExercise, now: früh });
    const b = estimate({ blocks: [single(item)], logsByExercise, now: spät });

    expect(estimatedEndAt(b, spät)).toBeGreaterThan(estimatedEndAt(a, früh) as number);
  });
});
