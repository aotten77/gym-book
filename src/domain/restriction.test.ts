import { describe, expect, it } from 'vitest';
import type { GuidedStep, Restriction, WorkoutSessionExercise } from '@/domain/models';
import {
  applyRestrictionEffect,
  describeRestrictionState,
  findAdjustmentConflicts,
  isInactiveSessionExercise,
  isPausedSessionExercise,
  isRestrictedExecution,
  isRestrictionActive,
  isStepTarget,
  resolveGuidedSteps,
  resolveRestrictionEffect,
  sessionRestrictionKind,
  suppressesProgressionHint,
  type RestrictionEffect,
} from '@/domain/restriction';

const STAMP = '2026-11-24T10:00:00.000Z';

function restriction(overrides: Partial<Restriction> = {}): Restriction {
  return {
    id: 'r1',
    name: 'Beispiel A',
    from: '2026-12-01',
    until: '2026-12-14',
    pauses: [],
    adjustments: [],
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

function row(overrides: Partial<WorkoutSessionExercise> = {}): WorkoutSessionExercise {
  return {
    id: 'se1',
    sessionId: 's1',
    exerciseId: 'e1',
    exerciseNameSnapshot: 'Kniebeuge',
    trackingMode: 'reps_weight',
    unilateral: false,
    orderIndex: 1,
    wasSkipped: false,
    addedInSession: false,
    workSetCount: 3,
    ...overrides,
  };
}

const EMPTY_EFFECT: RestrictionEffect = { pausedBy: [], replacements: [], adjustments: [] };

describe('isRestrictionActive', () => {
  const knee = restriction();

  it('gilt von from bis until, beide Tage eingeschlossen', () => {
    expect(isRestrictionActive(knee, '2026-11-30')).toBe(false);
    expect(isRestrictionActive(knee, '2026-12-01')).toBe(true);
    expect(isRestrictionActive(knee, '2026-12-14')).toBe(true);
    expect(isRestrictionActive(knee, '2026-12-15')).toBe(false);
  });

  it('gilt ohne until bis zum Aufheben', () => {
    expect(isRestrictionActive(restriction({ until: undefined }), '2027-06-01')).toBe(true);
  });

  it('gilt nicht, wenn sie aufgehoben ist', () => {
    expect(isRestrictionActive(restriction({ liftedAt: STAMP }), '2026-12-05')).toBe(false);
  });
});

describe('describeRestrictionState', () => {
  it('nennt angekündigt, aktiv, abgelaufen und aufgehoben', () => {
    expect(describeRestrictionState(restriction(), '2026-11-30')).toBe('angekündigt');
    expect(describeRestrictionState(restriction(), '2026-12-05')).toBe('aktiv');
    expect(describeRestrictionState(restriction(), '2026-12-15')).toBe('abgelaufen');
  });

  it('nennt aufgehoben auch vor from', () => {
    expect(describeRestrictionState(restriction({ liftedAt: STAMP }), '2026-11-30')).toBe(
      'aufgehoben',
    );
  });
});

describe('isStepTarget', () => {
  it('unterscheidet Schritt- und Übungsziele', () => {
    expect(isStepTarget({ stepName: 'Taubenpose' })).toBe(true);
    expect(isStepTarget({ exerciseId: 'e1', templateId: 't1' })).toBe(false);
  });
});

describe('resolveRestrictionEffect', () => {
  const day = '2026-12-05';

  it('trifft mit einer Pause „überall“ jedes Workout', () => {
    const restrictions = [restriction({ pauses: [{ exerciseId: 'e1' }] })];

    expect(
      resolveRestrictionEffect({ restrictions, day, templateId: 't2', exerciseId: 'e1' }).pausedBy,
    ).toEqual(['Beispiel A']);
    expect(resolveRestrictionEffect({ restrictions, day, exerciseId: 'e1' }).pausedBy).toEqual([
      'Beispiel A',
    ]);
  });

  it('trifft mit einer Pause im Workout kein anderes', () => {
    const restrictions = [restriction({ pauses: [{ exerciseId: 'e1', templateId: 't1' }] })];

    expect(
      resolveRestrictionEffect({ restrictions, day, templateId: 't2', exerciseId: 'e1' }),
    ).toEqual(EMPTY_EFFECT);
    expect(
      resolveRestrictionEffect({ restrictions, day, templateId: 't1', exerciseId: 'e1' }).pausedBy,
    ).toEqual(['Beispiel A']);
  });

  it('nennt bei zwei Pausen beide Namen und das spätere Ende', () => {
    const restrictions = [
      restriction({ name: 'Beispiel C', id: 'r2', until: '2026-12-20', pauses: [{ exerciseId: 'e1' }] }),
      restriction({ pauses: [{ exerciseId: 'e1' }] }),
    ];
    const effect = resolveRestrictionEffect({ restrictions, day, exerciseId: 'e1' });

    expect(effect.pausedBy).toEqual(['Beispiel A', 'Beispiel C']);
    expect(effect.pausedUntil).toBe('2026-12-20');
  });

  it('lässt das Ende weg, wenn eine der Pausen offen ist', () => {
    const restrictions = [
      restriction({ name: 'Beispiel C', id: 'r2', until: undefined, pauses: [{ exerciseId: 'e1' }] }),
      restriction({ pauses: [{ exerciseId: 'e1' }] }),
    ];
    const effect = resolveRestrictionEffect({ restrictions, day, exerciseId: 'e1' });

    expect(effect.pausedBy).toEqual(['Beispiel A', 'Beispiel C']);
    expect('pausedUntil' in effect).toBe(false);
  });

  it('liefert Pause und Anpassung zusammen, Ersatz mit Namen', () => {
    const replacement = { exerciseId: 'e9', workSetCount: 3, targetReps: 8 };
    const restrictions = [
      restriction({
        pauses: [{ exerciseId: 'e1', replacement }],
        adjustments: [{ exerciseId: 'e1', targetWeight: 40 }],
      }),
    ];
    const effect = resolveRestrictionEffect({ restrictions, day, exerciseId: 'e1' });

    expect(effect.pausedBy).toEqual(['Beispiel A']);
    expect(effect.replacements).toEqual([{ restrictionName: 'Beispiel A', replacement }]);
    expect(effect.adjustments).toEqual([
      { restrictionName: 'Beispiel A', adjustment: { exerciseId: 'e1', targetWeight: 40 } },
    ]);
  });

  it('ignoriert Schrittziele und nicht wirksame Einschränkungen', () => {
    const restrictions = [
      restriction({ pauses: [{ stepName: 'Kniebeuge' }], adjustments: [{ stepName: 'Kniebeuge', seconds: 20 }] }),
      restriction({ id: 'r2', name: 'Später', from: '2027-01-01', pauses: [{ exerciseId: 'e1' }] }),
    ];

    expect(resolveRestrictionEffect({ restrictions, day, exerciseId: 'e1' })).toEqual(EMPTY_EFFECT);
  });
});

describe('applyRestrictionEffect', () => {
  it('setzt die Anpassung und merkt den Wochenwert als „statt“', () => {
    const result = applyRestrictionEffect(
      { workSetCount: 3, targetReps: 5, targetWeight: 45 },
      {
        ...EMPTY_EFFECT,
        adjustments: [
          { restrictionName: 'Beispiel A', adjustment: { exerciseId: 'e1', targetWeight: 40 } },
        ],
      },
    );

    expect(result.targets).toEqual({ workSetCount: 3, targetReps: 5, targetWeight: 40 });
    expect(result.snapshot).toEqual({
      adjustedBy: ['Beispiel A'],
      targetsBeforeAdjustment: { targetWeight: 45 },
    });
  });

  it('kennt keine Abweichung, wenn die Anpassung dem Wochenwert entspricht', () => {
    const result = applyRestrictionEffect(
      { workSetCount: 3, targetWeight: 45 },
      {
        ...EMPTY_EFFECT,
        adjustments: [
          { restrictionName: 'Beispiel A', adjustment: { exerciseId: 'e1', targetWeight: 45 } },
        ],
      },
    );

    expect(result.snapshot).toEqual({ adjustedBy: ['Beispiel A'] });
  });

  it('stapelt die Notizen in Reihenfolge der Namen', () => {
    const result = applyRestrictionEffect(
      { workSetCount: 3 },
      {
        ...EMPTY_EFFECT,
        adjustments: [
          { restrictionName: 'Beispiel A', adjustment: { exerciseId: 'e1', note: 'nur bis Parallel' } },
          { restrictionName: 'Beispiel C', adjustment: { exerciseId: 'e1', note: 'Rumpf fest' } },
        ],
      },
    );

    expect(result.snapshot).toEqual({
      adjustedBy: ['Beispiel A', 'Beispiel C'],
      adjustmentNotes: [
        { by: 'Beispiel A', note: 'nur bis Parallel' },
        { by: 'Beispiel C', note: 'Rumpf fest' },
      ],
    });
  });

  it('hält mit holdProgression nur den Hinweis, die Werte bleiben', () => {
    const result = applyRestrictionEffect(
      { workSetCount: 3, targetWeight: 45 },
      {
        ...EMPTY_EFFECT,
        adjustments: [
          { restrictionName: 'Beispiel A', adjustment: { exerciseId: 'e1', holdProgression: true } },
        ],
      },
    );

    expect(result.targets).toEqual({ workSetCount: 3, targetWeight: 45 });
    expect(result.snapshot).toEqual({ adjustedBy: ['Beispiel A'], progressionHeld: true });
  });

  it('übernimmt die Pause in den Snapshot und lässt leere Felder weg', () => {
    expect(
      applyRestrictionEffect(
        { workSetCount: 3 },
        { ...EMPTY_EFFECT, pausedBy: ['Beispiel A'], pausedUntil: '2026-12-14' },
      ).snapshot,
    ).toEqual({ pausedBy: ['Beispiel A'], pausedUntil: '2026-12-14' });
    expect(applyRestrictionEffect({ workSetCount: 3 }, EMPTY_EFFECT).snapshot).toEqual({});
  });
});

describe('resolveGuidedSteps', () => {
  const steps: GuidedStep[] = [
    { name: 'Tiefe Hocke', seconds: 60 },
    { name: 'Taubenpose', seconds: 45, bothSides: true },
    { name: 'Kosakenhocke', seconds: 40 },
  ];
  const day = '2026-12-05';

  it('nimmt pausierte Schritte heraus, Groß- und Kleinschreibung egal', () => {
    const result = resolveGuidedSteps({
      restrictions: [restriction({ pauses: [{ stepName: 'tiefe hocke ' }] })],
      day,
      templateId: 't1',
      steps,
    });

    expect(result.steps.map((step) => step.name)).toEqual(['Taubenpose', 'Kosakenhocke']);
    expect(result.pausedSteps).toEqual([
      { index: 0, step: steps[0], pausedBy: ['Beispiel A'], pausedUntil: '2026-12-14' },
    ]);
    expect(result.adjustedSteps).toEqual([]);
  });

  it('setzt angepasste Sekunden und zählt den Index in den abgespielten Schritten', () => {
    const result = resolveGuidedSteps({
      restrictions: [
        restriction({
          pauses: [{ stepName: 'Tiefe Hocke' }],
          adjustments: [{ stepName: 'Taubenpose', seconds: 30, note: 'langsam ausführen' }],
        }),
      ],
      day,
      templateId: 't1',
      steps,
    });

    expect(result.steps[0]).toEqual({ name: 'Taubenpose', seconds: 30, bothSides: true });
    expect(result.adjustedSteps).toEqual([
      {
        index: 0,
        adjustedBy: ['Beispiel A'],
        secondsBefore: 45,
        notes: [{ by: 'Beispiel A', note: 'langsam ausführen' }],
      },
    ]);
  });

  it('lässt secondsBefore weg, wenn sich die Dauer nicht ändert', () => {
    const result = resolveGuidedSteps({
      restrictions: [restriction({ adjustments: [{ stepName: 'Kosakenhocke', seconds: 40 }] })],
      day,
      templateId: 't1',
      steps,
    });

    expect(result.adjustedSteps).toEqual([{ index: 2, adjustedBy: ['Beispiel A'] }]);
  });

  it('lässt die Pause die Anpassung desselben Schritts schlagen', () => {
    const result = resolveGuidedSteps({
      restrictions: [
        restriction({
          pauses: [{ stepName: 'Taubenpose' }],
          adjustments: [{ stepName: 'Taubenpose', seconds: 30 }],
        }),
      ],
      day,
      templateId: 't1',
      steps,
    });

    expect(result.steps).toHaveLength(2);
    expect(result.pausedSteps.map((paused) => paused.index)).toEqual([1]);
    expect(result.adjustedSteps).toEqual([]);
  });

  it('trifft mit templateId keine andere Vorlage', () => {
    const result = resolveGuidedSteps({
      restrictions: [restriction({ pauses: [{ stepName: 'Tiefe Hocke', templateId: 't1' }] })],
      day,
      templateId: 't2',
      steps,
    });

    expect(result.steps).toEqual(steps);
    expect(result.pausedSteps).toEqual([]);
  });
});

describe('findAdjustmentConflicts', () => {
  const knee = restriction();

  it('meldet zwei Anpassungen desselben Werts am selben Ziel', () => {
    const conflicts = findAdjustmentConflicts([
      restriction({ adjustments: [{ exerciseId: 'e1', targetWeight: 40 }] }),
      restriction({ id: 'r2', name: 'Beispiel C', adjustments: [{ exerciseId: 'e1', targetWeight: 35 }] }),
    ]);

    expect(conflicts).toEqual([
      { names: ['Beispiel A', 'Beispiel C'], target: { exerciseId: 'e1' }, field: 'targetWeight' },
    ]);
  });

  it('meldet verschiedene Werte, reine Notizen und holdProgression nicht', () => {
    expect(
      findAdjustmentConflicts([
        restriction({ adjustments: [{ exerciseId: 'e1', targetWeight: 40, note: 'a', holdProgression: true }] }),
        restriction({ id: 'r2', name: 'Beispiel C', adjustments: [{ exerciseId: 'e1', targetReps: 5, note: 'b', holdProgression: true }] }),
      ]),
    ).toEqual([]);
  });

  it('sieht „überall“ im Konflikt mit einem Workout', () => {
    expect(
      findAdjustmentConflicts([
        restriction({ adjustments: [{ exerciseId: 'e1', targetWeight: 40 }] }),
        restriction({ id: 'r2', name: 'Beispiel C', adjustments: [{ exerciseId: 'e1', templateId: 't1', targetWeight: 40 }] }),
      ]),
    ).toHaveLength(1);
  });

  it('meldet nichts bei getrennten Zeiträumen oder einer aufgehobenen', () => {
    const other = { id: 'r2', name: 'Beispiel C', adjustments: [{ exerciseId: 'e1', targetWeight: 40 }] };

    expect(
      findAdjustmentConflicts([
        restriction({ adjustments: [{ exerciseId: 'e1', targetWeight: 40 }] }),
        restriction({ ...other, from: '2026-12-15', until: undefined }),
      ]),
    ).toEqual([]);
    expect(
      findAdjustmentConflicts([
        restriction({ adjustments: [{ exerciseId: 'e1', targetWeight: 40 }] }),
        restriction({ ...other, liftedAt: STAMP }),
      ]),
    ).toEqual([]);
  });

  it('meldet zwei Ersatzübungen für dieselbe Übung', () => {
    const replacement = { exerciseId: 'e9', workSetCount: 3 };

    expect(
      findAdjustmentConflicts([
        restriction({ pauses: [{ exerciseId: 'e1', replacement }] }),
        restriction({ id: 'r2', name: 'Beispiel C', pauses: [{ exerciseId: 'e1', templateId: 't1', replacement }] }),
      ]),
    ).toEqual([
      { names: ['Beispiel A', 'Beispiel C'], target: { exerciseId: 'e1' }, field: 'replacement' },
    ]);
  });

  it('sieht einen Schritt ohne Vorlage im Konflikt mit demselben Schritt einer Vorlage', () => {
    expect(
      findAdjustmentConflicts([
        restriction({ adjustments: [{ stepName: 'Taubenpose', seconds: 30 }] }),
        restriction({ id: 'r2', name: 'Beispiel C', adjustments: [{ stepName: 'taubenpose', templateId: 't1', seconds: 20 }] }),
      ]),
    ).toEqual([
      { names: ['Beispiel A', 'Beispiel C'], target: { stepName: 'Taubenpose' }, field: 'seconds' },
    ]);
  });

  it('vergleicht eine Einschränkung nicht mit sich selbst', () => {
    expect(findAdjustmentConflicts([knee])).toEqual([]);
  });
});

describe('Art einer Session-Zeile', () => {
  const cases: [string, Partial<WorkoutSessionExercise>, string | undefined][] = [
    ['pausiert', { pausedBy: ['Beispiel A'] }, 'pausiert'],
    ['trotzdem', { pausedBy: ['Beispiel A'], pauseOverriddenAt: STAMP }, 'trotzdem'],
    ['angepasst', { adjustedBy: ['Beispiel A'], targetsBeforeAdjustment: { targetWeight: 45 } }, 'angepasst'],
    ['ausgenommen', { excludedFromProgressAt: STAMP }, 'ausgenommen'],
    ['ersatz', { replacementFor: { sessionExerciseId: 'se0', restrictionName: 'Beispiel A' } }, 'ersatz'],
    ['gehalten', { adjustedBy: ['Beispiel A'], progressionHeld: true }, 'gehalten'],
    ['hinweis', { adjustedBy: ['Beispiel A'], adjustmentNotes: [{ by: 'Beispiel A', note: 'x' }] }, 'hinweis'],
    ['ohne', {}, undefined],
    ['angepasst ohne Abweichung', { adjustedBy: ['Beispiel A'], targetsBeforeAdjustment: {} }, undefined],
  ];

  it.each(cases)('erkennt %s', (_label, overrides, kind) => {
    expect(sessionRestrictionKind(row(overrides))).toBe(kind);
  });

  it('folgt der Rangfolge', () => {
    const adjusted = { targetsBeforeAdjustment: { targetWeight: 45 } };
    const replacementFor = { sessionExerciseId: 'se0', restrictionName: 'Beispiel A' };

    expect(sessionRestrictionKind(row({ pausedBy: ['Beispiel A'], ...adjusted }))).toBe('pausiert');
    expect(
      sessionRestrictionKind(row({ pausedBy: ['Beispiel A'], pauseOverriddenAt: STAMP, ...adjusted })),
    ).toBe('trotzdem');
    expect(sessionRestrictionKind(row({ ...adjusted, excludedFromProgressAt: STAMP }))).toBe('angepasst');
    expect(sessionRestrictionKind(row({ replacementFor, progressionHeld: true }))).toBe('ersatz');
  });

  it('zählt trotzdem, angepasst und ausgenommen als eingeschränkte Ausführung', () => {
    const restricted = cases
      .filter(([, overrides]) => isRestrictedExecution(row(overrides)))
      .map(([label]) => label);

    expect(restricted).toEqual(['trotzdem', 'angepasst', 'ausgenommen']);
  });

  it('unterdrückt den Steigerungshinweis bei trotzdem, angepasst und gehalten', () => {
    const suppressed = cases
      .filter(([, overrides]) => suppressesProgressionHint(row(overrides)))
      .map(([label]) => label);

    expect(suppressed).toEqual(['trotzdem', 'angepasst', 'gehalten']);
    // Ein gehaltener Ersatz hat die Art „ersatz“ und trotzdem keinen Hinweis.
    expect(
      suppressesProgressionHint(
        row({ replacementFor: { sessionExerciseId: 'se0', restrictionName: 'Beispiel A' }, progressionHeld: true }),
      ),
    ).toBe(true);
  });

  it('nennt pausierte und übersprungene Zeilen inaktiv, trotzdem nicht', () => {
    expect(isPausedSessionExercise(row({ pausedBy: ['Beispiel A'] }))).toBe(true);
    expect(isPausedSessionExercise(row({ pausedBy: [] }))).toBe(false);
    expect(isInactiveSessionExercise(row({ pausedBy: ['Beispiel A'] }))).toBe(true);
    expect(isInactiveSessionExercise(row({ wasSkipped: true }))).toBe(true);
    expect(
      isInactiveSessionExercise(row({ pausedBy: ['Beispiel A'], pauseOverriddenAt: STAMP })),
    ).toBe(false);
  });
});
