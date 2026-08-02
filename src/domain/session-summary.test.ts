import { describe, expect, it } from 'vitest';
import type { WorkoutSessionExercise, WorkoutSetLog } from '@/domain/models';
import {
  buildSessionBlockProgress,
  buildSetRounds,
  describeExerciseTarget,
  describeSetRow,
  describeSetRowValues,
  setRowFallback,
  summarizeCompletedExercise,
  summarizeExerciseAsymmetry,
  summarizeSessionProgress,
} from '@/domain/session-summary';
import type { SupersetBlock } from '@/domain/superset';

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
    ...overrides,
  };
}

function log(overrides: Partial<WorkoutSetLog> & Pick<WorkoutSetLog, 'id' | 'sessionExerciseId'>): WorkoutSetLog {
  return {
    setKind: 'work',
    side: 'both',
    setNumber: 1,
    completed: false,
    ...overrides,
  };
}

describe('buildSessionBlockProgress', () => {
  it('zählt Satzzeilen über beide Mitglieder eines Supersatzes', () => {
    const first = exercise({ id: 'a1', unilateral: true });
    const second = exercise({ id: 'a2', trackingMode: 'time' });
    const blocks: SupersetBlock<WorkoutSessionExercise>[] = [
      { kind: 'group', groupId: 'group-1', exercises: [first, second] },
    ];

    const [block] = buildSessionBlockProgress(blocks, {
      a1: [
        log({ id: '1', sessionExerciseId: 'a1', side: 'left', completed: true }),
        log({ id: '2', sessionExerciseId: 'a1', side: 'right', completed: true }),
        log({ id: '3', sessionExerciseId: 'a1', side: 'left', setNumber: 2 }),
        log({ id: '4', sessionExerciseId: 'a1', side: 'right', setNumber: 2 }),
      ],
      a2: [log({ id: '5', sessionExerciseId: 'a2', completed: true })],
    });

    expect(block.key).toBe('group-1');
    expect(block.isSuperset).toBe(true);
    expect(block.completedCount).toBe(3);
    expect(block.totalCount).toBe(5);
  });

  it('markiert den Block mit dem Fokus als current, die fertigen als done', () => {
    const blocks: SupersetBlock<WorkoutSessionExercise>[] = [
      { kind: 'single', exercise: exercise({ id: 'done' }) },
      { kind: 'single', exercise: exercise({ id: 'here' }) },
      { kind: 'single', exercise: exercise({ id: 'later' }) },
    ];

    const progress = buildSessionBlockProgress(
      blocks,
      {
        done: [log({ id: '1', sessionExerciseId: 'done', completed: true })],
        here: [log({ id: '2', sessionExerciseId: 'here' })],
        later: [log({ id: '3', sessionExerciseId: 'later' })],
      },
      'here',
    );

    expect(progress.map((item) => item.status)).toEqual(['done', 'current', 'upcoming']);
  });

  it('behandelt eine ausgelassene Übung als erledigt und bietet keinen offenen Satz an', () => {
    const blocks: SupersetBlock<WorkoutSessionExercise>[] = [
      { kind: 'single', exercise: exercise({ id: 'skipped', wasSkipped: true }) },
    ];

    const [block] = buildSessionBlockProgress(blocks, {
      skipped: [log({ id: '1', sessionExerciseId: 'skipped' })],
    });

    expect(block.status).toBe('done');
    expect(block.exercises[0].nextOpenLog).toBeUndefined();
  });

  it('liefert als nächsten offenen Satz die erste unerledigte Zeile in Satzreihenfolge', () => {
    const blocks: SupersetBlock<WorkoutSessionExercise>[] = [
      { kind: 'single', exercise: exercise({ id: 'a', unilateral: true }) },
    ];

    const [block] = buildSessionBlockProgress(blocks, {
      a: [
        log({ id: '2', sessionExerciseId: 'a', side: 'right', setNumber: 1, completed: true }),
        log({ id: '1', sessionExerciseId: 'a', side: 'left', setNumber: 1, completed: true }),
        log({ id: '4', sessionExerciseId: 'a', side: 'right', setNumber: 2 }),
        log({ id: '3', sessionExerciseId: 'a', side: 'left', setNumber: 2 }),
      ],
    });

    expect(block.exercises[0].nextOpenLog?.id).toBe('3');
  });

  it('lässt einen fertigen Block auch dann done sein, wenn der Fokus noch darin steht', () => {
    const blocks: SupersetBlock<WorkoutSessionExercise>[] = [
      { kind: 'single', exercise: exercise({ id: 'a' }) },
    ];

    const [block] = buildSessionBlockProgress(
      blocks,
      { a: [log({ id: '1', sessionExerciseId: 'a', completed: true })] },
      'a',
    );

    expect(block.status).toBe('done');
  });
});

describe('summarizeSessionProgress', () => {
  it('zählt Zeilen, nicht Sätze', () => {
    const progress = summarizeSessionProgress([
      log({ id: '1', sessionExerciseId: 'a', side: 'left', completed: true }),
      log({ id: '2', sessionExerciseId: 'a', side: 'right', completed: true }),
      log({ id: '3', sessionExerciseId: 'a', side: 'left', setNumber: 2 }),
      log({ id: '4', sessionExerciseId: 'a', side: 'right', setNumber: 2 }),
    ]);

    expect(progress).toEqual({ completedCount: 2, totalCount: 4, percent: 50 });
  });

  it('bleibt bei einer leeren Einheit bei null Prozent statt NaN', () => {
    expect(summarizeSessionProgress([])).toEqual({ completedCount: 0, totalCount: 0, percent: 0 });
  });
});

describe('summarizeCompletedExercise', () => {
  it('zählt Wiederholungen zusammen', () => {
    expect(
      summarizeCompletedExercise([
        log({ id: '1', sessionExerciseId: 'a', reps: 12, completed: true }),
        log({ id: '2', sessionExerciseId: 'a', reps: 10, completed: true }),
        log({ id: '3', sessionExerciseId: 'a', reps: 8 }),
      ]),
    ).toBe('22 Wdh');
  });

  it('zählt Zeiten auf, statt sie zu summieren', () => {
    expect(
      summarizeCompletedExercise([
        log({ id: '1', sessionExerciseId: 'a', seconds: 45, completed: true }),
        log({ id: '2', sessionExerciseId: 'a', setNumber: 2, seconds: 42, completed: true }),
      ]),
    ).toBe('45 · 42 s');
  });

  it('liefert nichts, solange kein Satz steht', () => {
    expect(summarizeCompletedExercise([log({ id: '1', sessionExerciseId: 'a' })])).toBeUndefined();
  });
});

describe('summarizeExerciseAsymmetry', () => {
  it('rechnet die Seitendifferenz über alle erledigten Sätze', () => {
    expect(
      summarizeExerciseAsymmetry([
        log({ id: '1', sessionExerciseId: 'a', side: 'left', reps: 12, completed: true }),
        log({ id: '2', sessionExerciseId: 'a', side: 'right', reps: 10, completed: true }),
      ]),
    ).toBe(16.7);
  });

  it('schweigt, solange eine Seite nichts beigetragen hat', () => {
    expect(
      summarizeExerciseAsymmetry([
        log({ id: '1', sessionExerciseId: 'a', side: 'left', reps: 12, completed: true }),
        log({ id: '2', sessionExerciseId: 'a', side: 'right', reps: 10 }),
      ]),
    ).toBeUndefined();
  });
});

describe('describeExerciseTarget', () => {
  it('beschreibt eine Bandübung ohne Kilo', () => {
    expect(
      describeExerciseTarget(
        exercise({ id: 'a', workSetCount: 3, targetReps: 12, targetBandNameSnapshot: 'grün' }),
      ),
    ).toBe('3 × 12 Wdh · Band grün');
  });

  it('beschreibt eine Zeitübung', () => {
    expect(
      describeExerciseTarget(exercise({ id: 'a', trackingMode: 'time', workSetCount: 3, targetSeconds: 45 })),
    ).toBe('3 × 45s');
  });

  it('beschreibt eine Langhantelübung mit Gewicht', () => {
    expect(
      describeExerciseTarget(exercise({ id: 'a', workSetCount: 4, targetReps: 5, targetWeight: 62.5 })),
    ).toBe('4 × 5 Wdh · 62.5 kg');
  });
});

describe('buildSetRounds', () => {
  it('legt beide Seiten einer einbeinigen Übung in dieselbe Runde', () => {
    const rounds = buildSetRounds([
      log({ id: '2', sessionExerciseId: 'a', side: 'right', setNumber: 1, completed: true }),
      log({ id: '1', sessionExerciseId: 'a', side: 'left', setNumber: 1, completed: true }),
      log({ id: '3', sessionExerciseId: 'a', side: 'left', setNumber: 2 }),
      log({ id: '4', sessionExerciseId: 'a', side: 'right', setNumber: 2 }),
    ]);

    expect(rounds).toHaveLength(2);
    // Links vor rechts, unabhängig davon, wie die Zeilen hereinkommen.
    expect(rounds[0].rows.map((row) => row.id)).toEqual(['1', '2']);
    expect(rounds[0].isDone).toBe(true);
    expect(rounds[1].isDone).toBe(false);
  });

  it('hält den Aufwärmsatz getrennt und nennt ihn beim Namen', () => {
    const rounds = buildSetRounds([
      log({ id: '1', sessionExerciseId: 'a', setKind: 'warmup', setNumber: 0 }),
      log({ id: '2', sessionExerciseId: 'a', setNumber: 1 }),
    ]);

    expect(rounds.map((round) => round.label)).toEqual(['Aufwärmen', 'Satz 1']);
    expect(rounds[0].kind).toBe('warmup');
  });

  it('gilt erst als erledigt, wenn beide Seiten stehen', () => {
    const [round] = buildSetRounds([
      log({ id: '1', sessionExerciseId: 'a', side: 'left', completed: true }),
      log({ id: '2', sessionExerciseId: 'a', side: 'right' }),
    ]);

    expect(round.isDone).toBe(false);
  });
});

describe('setRowFallback', () => {
  it('lässt die Werte der letzten Ausführung das Ziel schlagen', () => {
    expect(
      setRowFallback(exercise({ id: 'a', targetReps: 5, targetWeight: 62.5 }), { weight: 60 }),
    ).toEqual({ reps: 5, seconds: undefined, weight: 60, bandNameSnapshot: undefined });
  });
});

describe('describeSetRowValues', () => {
  it('nimmt die eingetragenen Werte, sobald sie stehen', () => {
    expect(
      describeSetRowValues(log({ id: '1', sessionExerciseId: 'a', weight: 62.5, reps: 5 }), {
        reps: 8,
        weight: 50,
      }),
    ).toBe('62.5 kg × 5');
  });

  it('greift auf die Vorgabe zurück, solange der Satz offen ist', () => {
    expect(describeSetRowValues(log({ id: '1', sessionExerciseId: 'a' }), { reps: 5, weight: 62.5 })).toBe(
      '62.5 kg × 5',
    );
  });

  it('zeigt bei einem erledigten Satz nichts Erfundenes', () => {
    expect(
      describeSetRowValues(log({ id: '1', sessionExerciseId: 'a', completed: true }), {
        reps: 5,
        weight: 62.5,
      }),
    ).toBe('');
  });

  it('schreibt das Band statt eines Kilos', () => {
    expect(
      describeSetRowValues(log({ id: '1', sessionExerciseId: 'a', reps: 12, bandNameSnapshot: 'grün' }), {
        bandNameSnapshot: 'gelb',
      }),
    ).toBe('grün × 12');
  });

  it('stellt bei einem Satz auf Zeit die Zeit voran', () => {
    expect(
      describeSetRowValues(log({ id: '1', sessionExerciseId: 'a', seconds: 45, weight: 5 }), {
        seconds: 60,
      }),
    ).toBe('45 s · 5 kg');
  });
});

describe('describeSetRow', () => {
  it('nennt die Seite, wo es eine gibt', () => {
    expect(describeSetRow(log({ id: '1', sessionExerciseId: 'a', side: 'left', setNumber: 2 }))).toBe(
      'Satz 2 · links',
    );
    expect(describeSetRow(log({ id: '2', sessionExerciseId: 'a', setKind: 'warmup', setNumber: 0 }))).toBe(
      'Aufwärmen',
    );
  });
});
