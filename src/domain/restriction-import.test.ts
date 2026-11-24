import { describe, expect, it } from 'vitest';
import {
  parseLibraryImportPayload,
  planHasChanges,
  planLibraryImport,
  type LibraryImportPlan,
  type LibraryImportState,
} from '@/domain/library-import';
import type {
  Exercise,
  Restriction,
  WorkoutTemplate,
  WorkoutTemplateExercise,
} from '@/domain/models';

const STAMP = '2026-11-01T00:00:00.000Z';
const TODAY = '2026-11-24';

function exercise(id: string, name: string): Exercise {
  return {
    id,
    name,
    trackingMode: 'reps_weight',
    unilateral: false,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

function template(id: string, name: string, steps?: WorkoutTemplate['steps']): WorkoutTemplate {
  return { id, name, ...(steps ? { steps } : {}), createdAt: STAMP, updatedAt: STAMP };
}

function assignment(id: string, templateId: string, exerciseId: string): WorkoutTemplateExercise {
  return {
    id,
    templateId,
    exerciseId,
    orderIndex: Number(id.slice(1)),
    workSetCount: 3,
    targetReps: 8,
    targetWeight: 45,
  };
}

function restriction(overrides: Partial<Restriction> = {}): Restriction {
  return {
    id: 'r1',
    name: 'Beispiel A',
    from: '2026-12-01',
    until: '2026-12-14',
    pauses: [{ exerciseId: 'e1' }],
    adjustments: [],
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

function baseState(overrides: Partial<LibraryImportState> = {}): LibraryImportState {
  return {
    exercises: [
      exercise('e1', 'Sprungkniebeuge'),
      exercise('e2', 'Step-up'),
      exercise('e3', 'Kniebeuge (LH)'),
      exercise('e4', 'Ausfallschritt rückwärts'),
    ],
    templates: [
      template('t1', 'Einheit B'),
      template('g1', 'Mobility geführt', [
        { name: 'Tiefe Hocke', seconds: 60 },
        { name: 'Taubenpose', seconds: 45, bothSides: true },
        { name: 'Kosakenhocke', seconds: 40 },
      ]),
      template('g2', 'Yoga', [{ name: 'Taubenpose', seconds: 60 }]),
    ],
    templateExercises: [
      assignment('a1', 't1', 'e1'),
      assignment('a2', 't1', 'e3'),
      assignment('a3', 't1', 'e4'),
    ],
    bandLevels: [],
    progressionRules: [],
    planEntries: [],
    takenPlanEntryIds: new Set(),
    today: TODAY,
    restrictions: [],
    ...overrides,
  };
}

function plan(payload: Record<string, unknown>, state = baseState()): LibraryImportPlan {
  return planLibraryImport(
    parseLibraryImportPayload(JSON.stringify({ schemaVersion: 1, ...payload })),
    state,
  );
}

function planRestrictions(restrictions: unknown[], state = baseState()) {
  return plan({ restrictions }, state);
}

function problemOf(restrictions: unknown[], state = baseState()): string {
  try {
    planRestrictions(restrictions, state);
  } catch (error) {
    return (error as Error).message;
  }

  throw new Error('Der Import lief durch, erwartet war ein Abbruch.');
}

const KNEE = { name: 'Beispiel A', from: '2026-12-01', until: '2026-12-14' };

describe('Block restrictions: Abbruchgründe', () => {
  it('bricht ab, wenn der Name fehlt', () => {
    expect(problemOf([{ from: '2026-12-01', pauses: [{ exercise: 'Step-up' }] }])).toContain(
      'Einschränkung 1, Feld "name"',
    );
  });

  it('bricht bei einem doppelten Namen ab', () => {
    const pauses = [{ exercise: 'Step-up' }];

    expect(problemOf([{ ...KNEE, pauses }, { ...KNEE, name: ' beispiel a', pauses }])).toContain(
      'Einschränkung 2: "beispiel a" steht mehrfach in dieser Datei.',
    );
  });

  it('bricht ab, wenn einer neuen from fehlt', () => {
    expect(problemOf([{ name: 'Beispiel A', pauses: [{ exercise: 'Step-up' }] }])).toContain(
      'Einschränkung 1: Eine neue Einschränkung braucht "from".',
    );
  });

  it('bricht bei einem ungültigen Datum ab', () => {
    expect(problemOf([{ ...KNEE, until: '2026-13-01', pauses: [{ exercise: 'Step-up' }] }])).toContain(
      'Einschränkung 1: "2026-13-01" ist kein gültiges Datum (JJJJ-MM-TT).',
    );
  });

  it('bricht ab, wenn until vor from liegt', () => {
    expect(problemOf([{ ...KNEE, until: '2026-11-30', pauses: [{ exercise: 'Step-up' }] }])).toContain(
      'Einschränkung 1: "until" (2026-11-30) liegt vor "from" (2026-12-01).',
    );
  });

  it('bricht ab, wenn eine neue kein Ziel hat', () => {
    expect(problemOf([{ ...KNEE, pauses: [] }])).toContain(
      'Einschränkung 1: Eine neue Einschränkung braucht mindestens eine Pause oder Anpassung.',
    );
  });

  it('bricht bei einer unbekannten Übung ab', () => {
    expect(problemOf([{ ...KNEE, pauses: [{ exercise: 'Gibtsnicht' }] }])).toContain(
      'Einschränkung 1, Pause 1: Übung "Gibtsnicht" gibt es nicht.',
    );
  });

  it('bricht bei einer unbekannten Ersatzübung ab', () => {
    expect(
      problemOf([
        {
          ...KNEE,
          pauses: [{ exercise: 'Sprungkniebeuge', replacement: { exercise: 'Gibtsnicht', workSetCount: 3 } }],
        },
      ]),
    ).toContain('Einschränkung 1, Pause 1: Ersatzübung "Gibtsnicht" gibt es nicht.');
  });

  it('bricht bei einem unbekannten Workout ab', () => {
    expect(problemOf([{ ...KNEE, pauses: [{ template: 'Gibtsnicht', exercise: 'Step-up' }] }])).toContain(
      'Einschränkung 1, Pause 1: Workout "Gibtsnicht" gibt es nicht.',
    );
  });

  it('bricht bei einem unbekannten Schritt ab', () => {
    expect(
      problemOf([{ ...KNEE, pauses: [{ template: 'Mobility geführt', step: 'Gibtsnicht' }] }]),
    ).toContain('Einschränkung 1, Pause 1: Schritt "Gibtsnicht" gibt es in "Mobility geführt" nicht.');
  });

  it('bricht ab, wenn ein Schritt ohne Vorlage nirgends vorkommt', () => {
    expect(problemOf([{ ...KNEE, adjustments: [{ step: 'Gibtsnicht', seconds: 20 }] }])).toContain(
      'Einschränkung 1, Anpassung 1: Schritt "Gibtsnicht" kommt in keiner geführten Vorlage vor.',
    );
  });

  it('bricht bei einem Schritt an einem Workout ohne Schritte ab', () => {
    expect(problemOf([{ ...KNEE, pauses: [{ template: 'Einheit B', step: 'Tiefe Hocke' }] }])).toContain(
      'Einschränkung 1, Pause 1: Workout "Einheit B" hat keine Schritte.',
    );
  });

  it('bricht ab, wenn das Workout die Übung nicht enthält', () => {
    expect(problemOf([{ ...KNEE, pauses: [{ template: 'Einheit B', exercise: 'Step-up' }] }])).toContain(
      'Einschränkung 1, Pause 1: Workout "Einheit B" enthält "Step-up" nicht.',
    );
  });

  it('bricht bei einer unklaren Zielform ab', () => {
    expect(problemOf([{ ...KNEE, pauses: [{ template: 'Einheit B' }] }])).toContain(
      'Einschränkung 1, Pause 1: braucht genau eine Zielform',
    );
  });

  it('bricht ab, wenn ein Ziel zweimal in der Liste steht', () => {
    expect(
      problemOf([{ ...KNEE, pauses: [{ exercise: 'Step-up' }, { exercise: 'step-up' }] }]),
    ).toContain('Einschränkung 1, Pause 2: dasselbe Ziel steht schon in Pause 1.');
  });

  it('bricht bei einer Anpassung ohne Wert, Notiz oder holdProgression ab', () => {
    expect(
      problemOf([{ ...KNEE, adjustments: [{ exercise: 'Step-up', holdProgression: false, note: ' ' }] }]),
    ).toContain(
      'Einschränkung 1, Anpassung 1: braucht einen Wert, eine Notiz oder "holdProgression".',
    );
  });

  it('bricht bei einem Übungswert an einem Schritt ab', () => {
    expect(
      problemOf([{ ...KNEE, adjustments: [{ step: 'Taubenpose', targetWeight: 10 }] }]),
    ).toContain('Einschränkung 1, Anpassung 1: An einem Schritt gibt es nur "seconds" und "note".');
  });

  it('bricht bei seconds an einer Übung ab', () => {
    expect(problemOf([{ ...KNEE, adjustments: [{ exercise: 'Step-up', seconds: 30 }] }])).toContain(
      'Einschränkung 1, Anpassung 1: "seconds" gibt es nur an einem Schritt.',
    );
  });

  it('bricht bei einem Ersatz an einem Schritt ab', () => {
    expect(
      problemOf([
        {
          ...KNEE,
          pauses: [{ step: 'Taubenpose', replacement: { exercise: 'Step-up', workSetCount: 3 } }],
        },
      ]),
    ).toContain('Einschränkung 1, Pause 1: Einen Ersatz gibt es nur für eine Übung, nicht für einen Schritt.');
  });

  it('bricht bei einem Ersatz ohne workSetCount ab', () => {
    expect(
      problemOf([
        { ...KNEE, pauses: [{ exercise: 'Sprungkniebeuge', replacement: { exercise: 'Step-up' } }] },
      ]),
    ).toContain('Einschränkung 1, Pause 1: Der Ersatz braucht "workSetCount".');
  });

  it('bricht ab, wenn Datei und Bestand denselben Wert setzen', () => {
    const state = baseState({
      restrictions: [
        restriction({ name: 'Beispiel C', pauses: [], adjustments: [{ exerciseId: 'e3', targetWeight: 35 }] }),
      ],
    });

    expect(
      problemOf([{ ...KNEE, adjustments: [{ exercise: 'Kniebeuge (LH)', targetWeight: 40 }] }], state),
    ).toContain(
      'Einschränkungen "Beispiel C" und "Beispiel A" setzen beide "targetWeight" an Kniebeuge (LH) im selben Zeitraum.',
    );
  });

  it('bricht bei zwei Ersatzübungen für dieselbe Übung ab', () => {
    const replacement = { exercise: 'Step-up', workSetCount: 3 };

    expect(
      problemOf([
        { ...KNEE, pauses: [{ exercise: 'Sprungkniebeuge', replacement }] },
        { ...KNEE, name: 'Beispiel C', pauses: [{ exercise: 'Sprungkniebeuge', replacement }] },
      ]),
    ).toContain('setzen beide einen Ersatz für Sprungkniebeuge im selben Zeitraum.');
  });

  it('bricht bei einem vertippten Feldnamen ab', () => {
    expect(
      problemOf([{ ...KNEE, adjustments: [{ exercise: 'Step-up', targetWieght: 40 }] }]),
    ).toContain('Einschränkung 1, Anpassung 1: Unbekanntes Feld „targetWieght“.');
  });
});

describe('Block restrictions: Vorschau', () => {
  it('legt eine neue an, mit Zielen auf Ids und Zielzeilen in Klarnamen', () => {
    const [entry] = planRestrictions([
      {
        ...KNEE,
        reason: 'erfunden',
        pauses: [
          {
            exercise: 'Sprungkniebeuge',
            replacement: { exercise: 'Step-up', workSetCount: 3, targetReps: 8 },
          },
          { template: 'Einheit B', exercise: 'Ausfallschritt rückwärts' },
          { template: 'Mobility geführt', step: 'Tiefe Hocke' },
          { step: 'Kosakenhocke' },
        ],
        adjustments: [
          { exercise: 'Kniebeuge (LH)', targetWeight: 40, note: 'nur bis Parallel' },
          { step: 'taubenpose', seconds: 30 },
        ],
      },
    ]).restrictions;

    expect(entry.kind).toBe('new');
    expect(entry.label).toBe('Beispiel A');
    expect(entry.stateAfter).toBe('angekündigt');
    expect(entry.record).toEqual({
      name: 'Beispiel A',
      reason: 'erfunden',
      from: '2026-12-01',
      until: '2026-12-14',
      pauses: [
        { exerciseId: 'e1', replacement: { exerciseId: 'e2', workSetCount: 3, targetReps: 8 } },
        { exerciseId: 'e4', templateId: 't1' },
        { stepName: 'Tiefe Hocke', templateId: 'g1' },
        { stepName: 'Kosakenhocke' },
      ],
      adjustments: [
        { exerciseId: 'e3', targetWeight: 40, note: 'nur bis Parallel' },
        { stepName: 'taubenpose', seconds: 30 },
      ],
    });
    expect(entry.targets).toEqual([
      'Pause: Sprungkniebeuge → Ersatz Step-up, 3 Sätze, 8 Wdh.',
      'Pause: Ausfallschritt rückwärts in Einheit B',
      'Pause: Schritt Tiefe Hocke in Mobility geführt',
      'Pause: Schritt Kosakenhocke in allen geführten Vorlagen',
      'Anpassung: Kniebeuge (LH) – 40 kg, Notiz „nur bis Parallel“',
      'Anpassung: Schritt taubenpose in allen geführten Vorlagen – 30 s',
    ]);
  });

  it('löst Übung und Workout aus derselben Datei auf', () => {
    const [entry] = plan({
      exercises: [{ name: 'Box Jump', trackingMode: 'reps_weight', unilateral: false }],
      templates: [{ name: 'Einheit C' }],
      templateAssignments: [
        { template: 'Einheit C', exercise: 'Box Jump', orderIndex: 1, workSetCount: 3 },
      ],
      restrictions: [{ ...KNEE, pauses: [{ template: 'Einheit C', exercise: 'Box Jump' }] }],
    }).restrictions;

    expect(entry.kind).toBe('new');
    expect(entry.targets).toEqual(['Pause: Box Jump in Einheit C']);
  });

  it('zeigt eine Änderung von until als alt → neu', () => {
    const state = baseState({ restrictions: [restriction()] });
    const [entry] = planRestrictions([{ name: 'Beispiel A', until: '2026-12-21' }], state)
      .restrictions;

    expect(entry.kind).toBe('update');
    expect(entry.id).toBe('r1');
    expect(entry.changes).toEqual([{ field: 'Bis', from: '14.12.2026', to: '21.12.2026' }]);
    expect(entry.values).toEqual({ until: '2026-12-21' });
    expect(entry.liftedAt).toBeUndefined();
  });

  it('macht mit until: null das Ende offen', () => {
    const state = baseState({ restrictions: [restriction()] });
    const [entry] = planRestrictions([{ name: 'Beispiel A', until: null }], state).restrictions;

    expect(entry.kind).toBe('update');
    expect('until' in entry.values && entry.values.until === undefined).toBe(true);
    expect(entry.changes).toEqual([{ field: 'Bis', from: '14.12.2026', to: 'ohne Enddatum' }]);
  });

  it('hebt mit lifted: true auf und aktiviert mit lifted: false wieder', () => {
    const lifted = planRestrictions(
      [{ name: 'Beispiel A', lifted: true }],
      baseState({ restrictions: [restriction()] }),
    ).restrictions[0];
    const reactivated = planRestrictions(
      [{ name: 'Beispiel A', lifted: false }],
      baseState({ restrictions: [restriction({ liftedAt: STAMP })] }),
    ).restrictions[0];

    expect(lifted.kind).toBe('lifted');
    expect(typeof lifted.liftedAt).toBe('string');
    expect(lifted.stateAfter).toBe('aufgehoben');
    expect(reactivated.kind).toBe('reactivated');
    expect(reactivated.liftedAt).toBeNull();
    expect(reactivated.stateAfter).toBe('angekündigt');
  });

  it('lässt eine aufgehobene ohne lifted aufgehoben', () => {
    const [entry] = planRestrictions(
      [{ name: 'Beispiel A', until: '2026-12-21' }],
      baseState({ restrictions: [restriction({ liftedAt: STAMP })] }),
    ).restrictions;

    expect(entry.kind).toBe('update');
    expect(entry.liftedAt).toBeUndefined();
    expect(entry.stateAfter).toBe('aufgehoben');
  });

  it('meldet dieselbe Datei zweimal als unverändert', () => {
    const file = [
      {
        ...KNEE,
        pauses: [{ exercise: 'Sprungkniebeuge', replacement: { exercise: 'Step-up', workSetCount: 3 } }],
        adjustments: [{ step: 'Taubenpose', seconds: 30 }],
      },
    ];
    const first = planRestrictions(file).restrictions[0];
    const state = baseState({
      restrictions: [{ ...(first.record as Restriction), id: 'r1', createdAt: STAMP, updatedAt: STAMP }],
    });
    const second = planRestrictions(file, state);

    expect(second.restrictions[0].kind).toBe('unchanged');
    expect(planHasChanges(second)).toBe(false);
  });

  it('ersetzt pauses ganz, wenn genannt, und lässt sie sonst stehen', () => {
    const state = baseState({ restrictions: [restriction()] });
    const named = planRestrictions([{ name: 'Beispiel A', pauses: [{ exercise: 'Step-up' }] }], state)
      .restrictions[0];
    const omitted = planRestrictions([{ name: 'Beispiel A', reason: 'neu' }], state).restrictions[0];

    expect(named.values.pauses).toEqual([{ exerciseId: 'e2' }]);
    expect(named.targets).toEqual(['Pause: Step-up']);
    expect('pauses' in omitted.values).toBe(false);
    expect(omitted.targets).toEqual(['Pause: Sprungkniebeuge']);
  });

  it('sagt bei from in der Vergangenheit, dass gespeicherte Einheiten bleiben', () => {
    const [entry] = planRestrictions([
      { name: 'Beispiel A', from: '2026-11-20', pauses: [{ exercise: 'Step-up' }] },
    ]).restrictions;

    expect(entry.stateAfter).toBe('aktiv');
    expect(entry.note).toContain('gilt ab 20.11.');
    expect(entry.note).toContain('bereits gespeicherte Einheiten ändern sich nicht');
  });

  it('zählt die vier Arten in der Zusammenfassung', () => {
    const state = baseState({
      restrictions: [
        restriction(),
        restriction({ id: 'r2', name: 'Beispiel C', liftedAt: STAMP }),
        restriction({ id: 'r3', name: 'Beispiel F' }),
      ],
    });
    const result = planRestrictions(
      [
        { ...KNEE, name: 'Beispiel E', pauses: [{ exercise: 'Step-up' }] },
        { name: 'Beispiel A', lifted: true },
        { name: 'Beispiel C', lifted: false },
        { name: 'Beispiel F', until: '2026-12-20' },
      ],
      state,
    );

    expect(result.summary).toMatchObject({
      createdRestrictions: 1,
      updatedRestrictions: 1,
      liftedRestrictions: 1,
      reactivatedRestrictions: 1,
    });
    expect(planHasChanges(result)).toBe(true);
  });
});

describe('Block restrictions: verlorene Schritte', () => {
  const lostStepsPayload = {
    templates: [
      {
        name: 'Mobility geführt',
        steps: [
          { name: 'Taubenpose', seconds: 45, bothSides: true },
          { name: 'Kosakenhocke', seconds: 40 },
        ],
      },
    ],
  };

  function planWith(restrictions: Restriction[], extra: Record<string, unknown> = {}) {
    return plan({ ...lostStepsPayload, ...extra }, baseState({ restrictions }));
  }

  it('bricht ab, wenn ein steps-Import einen pausierten Schritt verliert', () => {
    expect(() =>
      planWith([restriction({ pauses: [{ stepName: 'Tiefe Hocke', templateId: 'g1' }] })]),
    ).toThrow('Workout "Mobility geführt" verliert Schritt "Tiefe Hocke"');
  });

  it('bricht auch bei einer Schrittanpassung mit Vorlage ab', () => {
    expect(() =>
      planWith([
        restriction({ pauses: [], adjustments: [{ stepName: 'Tiefe Hocke', templateId: 'g1', seconds: 30 }] }),
      ]),
    ).toThrow('verliert Schritt "Tiefe Hocke"');
  });

  it('lässt durch, wenn dieselbe Datei die Einschränkung mitändert', () => {
    expect(() =>
      planWith([restriction({ pauses: [{ stepName: 'Tiefe Hocke', templateId: 'g1' }] })], {
        restrictions: [{ name: 'Beispiel A', pauses: [{ template: 'Mobility geführt', step: 'Taubenpose' }] }],
      }),
    ).not.toThrow();
  });

  it('prüft einen Schritt ohne Vorlage nie', () => {
    expect(() => planWith([restriction({ pauses: [{ stepName: 'Tiefe Hocke' }] })])).not.toThrow();
  });

  it('prüft keine abgelaufene oder aufgehobene Einschränkung', () => {
    const pauses = [{ stepName: 'Tiefe Hocke', templateId: 'g1' }];

    expect(() =>
      planWith([restriction({ pauses, from: '2026-11-01', until: '2026-11-10' })]),
    ).not.toThrow();
    expect(() => planWith([restriction({ pauses, liftedAt: STAMP })])).not.toThrow();
  });
});
