import { describe, expect, it } from 'vitest';

import {
  hashImportPayload,
  parseLibraryImportPayload,
  planHasChanges,
  planLibraryImport,
  type LibraryImportPayload,
  type LibraryImportState,
} from '@/domain/library-import';
import type {
  BandLevel,
  Exercise,
  ProgressionRule,
  WorkoutTemplate,
  WorkoutTemplateExercise,
} from '@/domain/models';

function buildExercise(overrides: Partial<Exercise> & { id: string; name: string }): Exercise {
  return {
    trackingMode: 'reps_weight',
    unilateral: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildTemplate(id: string, name: string): WorkoutTemplate {
  return {
    id,
    name,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function buildAssignment(
  overrides: Partial<WorkoutTemplateExercise> & {
    id: string;
    templateId: string;
    exerciseId: string;
    orderIndex: number;
  },
): WorkoutTemplateExercise {
  return {
    workSetCount: 3,
    ...overrides,
  };
}

function buildBand(id: string, name: string, orderIndex: number): BandLevel {
  return {
    id,
    name,
    orderIndex,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function emptyState(overrides: Partial<LibraryImportState> = {}): LibraryImportState {
  return {
    exercises: [],
    templates: [],
    templateExercises: [],
    bandLevels: [],
    progressionRules: [],
    ...overrides,
  };
}

function buildRule(id: string, templateExerciseId: string): ProgressionRule {
  return { id, templateExerciseId, programWeekId: 'w1', targetReps: 6 };
}

function buildPayload(overrides: Partial<LibraryImportPayload> = {}): LibraryImportPayload {
  return {
    schemaVersion: 1,
    exercises: [],
    templates: [],
    templateAssignments: [],
    bandLevels: [],
    ...overrides,
  };
}

/**
 * Wendet einen Plan auf einen Zustand an - nur so weit, wie die Tests es
 * brauchen, aber nach denselben Regeln wie `applyLibraryImport`. Damit lässt
 * sich Idempotenz prüfen, ohne eine Datenbank anzufassen.
 */
function applyPlan(
  state: LibraryImportState,
  plan: ReturnType<typeof planLibraryImport>,
): LibraryImportState {
  const exercises = [...state.exercises];
  const templates = [...state.templates];
  const templateExercises = [...state.templateExercises];
  const bandLevels = [...state.bandLevels];

  for (const entry of plan.exercises) {
    if (entry.record) {
      exercises.push(buildExercise({ id: entry.id, ...entry.record }));
      continue;
    }

    const index = exercises.findIndex((item) => item.id === entry.id);
    exercises[index] = { ...exercises[index], ...entry.values };
  }

  for (const entry of plan.templates) {
    if (entry.record) {
      templates.push({ ...buildTemplate(entry.id, entry.record.name), ...entry.record });
      continue;
    }

    const index = templates.findIndex((item) => item.id === entry.id);
    templates[index] = { ...templates[index], ...entry.values };
  }

  const removedIds = new Set(
    plan.assignments.filter((entry) => entry.kind === 'removed').map((entry) => entry.id),
  );

  for (const entry of plan.assignments) {
    if (entry.kind === 'removed') {
      continue;
    }

    if (entry.record) {
      templateExercises.push({ id: entry.id, orderIndex: 0, ...entry.record });
      continue;
    }

    const index = templateExercises.findIndex((item) => item.id === entry.id);
    templateExercises[index] = { ...templateExercises[index], ...entry.values };
  }

  for (const order of plan.templateOrder) {
    order.orderedIds.forEach((id, index) => {
      const position = templateExercises.findIndex((item) => item.id === id);
      templateExercises[position] = { ...templateExercises[position], orderIndex: index + 1 };
    });
  }

  for (const entry of plan.bandLevels) {
    if (entry.record) {
      bandLevels.push(buildBand(entry.id, entry.record.name, entry.record.orderIndex));
      continue;
    }

    const index = bandLevels.findIndex((item) => item.id === entry.id);
    bandLevels[index] = { ...bandLevels[index], ...entry.values };
  }

  for (const [index, id] of (plan.bandOrder ?? []).entries()) {
    const position = bandLevels.findIndex((item) => item.id === id);
    bandLevels[position] = { ...bandLevels[position], orderIndex: index + 1 };
  }

  return {
    exercises,
    templates,
    templateExercises: templateExercises.filter((item) => !removedIds.has(item.id)),
    bandLevels,
    progressionRules: state.progressionRules.filter((rule) => !removedIds.has(rule.templateExerciseId)),
  };
}

describe('parseLibraryImportPayload', () => {
  it('nennt Block und Position statt eines zod-Pfads', () => {
    const json = JSON.stringify({
      schemaVersion: 1,
      exercises: [
        { name: 'Gut', trackingMode: 'reps_weight', unilateral: false },
        { name: 'Kaputt', trackingMode: 'zeit', unilateral: false },
      ],
    });

    expect(() => parseLibraryImportPayload(json)).toThrow(/Übung 2, Feld "trackingMode"/);
  });

  it('lehnt eine fehlende Seitigkeit als Pflichtfeld ab', () => {
    const json = JSON.stringify({
      schemaVersion: 1,
      exercises: [{ name: 'Ohne Seiten', trackingMode: 'time' }],
    });

    expect(() => parseLibraryImportPayload(json)).toThrow(/Übung 1, Feld "unilateral"/);
  });

  it('weist eine fremde Formatversion mit ihrer Nummer ab', () => {
    expect(() => parseLibraryImportPayload(JSON.stringify({ schemaVersion: 2 }))).toThrow(
      /Import-Format 2/,
    );
  });

  it('füllt fehlende Blöcke mit leeren Listen', () => {
    const payload = parseLibraryImportPayload(JSON.stringify({ schemaVersion: 1 }));

    expect(payload.exercises).toEqual([]);
    expect(payload.templateAssignments).toEqual([]);
  });
  it('akzeptiert replaceAssignments, superset und null', () => {
    const payload = parseLibraryImportPayload(
      JSON.stringify({
        schemaVersion: 1,
        templates: [{ name: 'Einheit A', replaceAssignments: true }],
        templateAssignments: [
          {
            template: 'Einheit A',
            exercise: 'Squat',
            orderIndex: 1,
            workSetCount: 3,
            superset: 'Block 1',
            targetRepsMax: 10,
            targetWeight: null,
            notes: null,
          },
        ],
      }),
    );

    expect(payload.templates[0].replaceAssignments).toBe(true);
    expect(payload.templateAssignments[0]).toMatchObject({
      superset: 'Block 1',
      targetRepsMax: 10,
      targetWeight: null,
      notes: null,
    });
  });
});

describe('hashImportPayload', () => {
  it('ist unabhängig von Feldreihenfolge und Formatierung', () => {
    const first = parseLibraryImportPayload(
      '{"schemaVersion":1,"exercises":[{"name":"A","trackingMode":"time","unilateral":true}]}',
    );
    const second = parseLibraryImportPayload(
      '{\n  "exercises": [\n    { "unilateral": true, "trackingMode": "time", "name": "A" }\n  ],\n  "schemaVersion": 1\n}',
    );

    expect(hashImportPayload(first)).toBe(hashImportPayload(second));
  });

  it('ändert sich mit dem Inhalt', () => {
    const first = buildPayload({
      exercises: [{ name: 'A', trackingMode: 'time', unilateral: true }],
    });
    const second = buildPayload({
      exercises: [{ name: 'B', trackingMode: 'time', unilateral: true }],
    });

    expect(hashImportPayload(first)).not.toBe(hashImportPayload(second));
  });
});

describe('planLibraryImport - Übungen', () => {
  it('legt unbekannte Übungen an und meldet sie als neu', () => {
    const plan = planLibraryImport(
      buildPayload({
        exercises: [
          {
            name: 'Einbeiniges RDL',
            trackingMode: 'reps_weight',
            unilateral: true,
            instructions: '4 s absenken',
          },
        ],
      }),
      emptyState(),
    );

    expect(plan.exercises).toHaveLength(1);
    expect(plan.exercises[0].kind).toBe('new');
    expect(plan.exercises[0].record).toMatchObject({
      name: 'Einbeiniges RDL',
      unilateral: true,
      instructions: '4 s absenken',
    });
    expect(plan.summary.createdExercises).toBe(1);
  });

  it('trifft eine bestehende Übung unabhängig von Groß- und Kleinschreibung', () => {
    const state = emptyState({
      exercises: [buildExercise({ id: 'e1', name: 'Nordic Curl', trackingMode: 'time' })],
    });

    const plan = planLibraryImport(
      buildPayload({
        exercises: [{ name: '  nordic curl ', trackingMode: 'reps_weight', unilateral: false }],
      }),
      state,
    );

    expect(plan.exercises[0].id).toBe('e1');
    expect(plan.exercises[0].kind).toBe('update');
    expect(plan.exercises[0].changes).toEqual(
      expect.arrayContaining([
        { field: 'Erfassung', from: 'Zeit', to: 'Wiederholungen + Gewicht' },
      ]),
    );
    expect(plan.exercises[0].values).toEqual({
      name: 'nordic curl',
      trackingMode: 'reps_weight',
    });
  });

  it('lässt nicht genannte Felder unangetastet', () => {
    const state = emptyState({
      exercises: [
        buildExercise({
          id: 'e1',
          name: 'Hip Thrust',
          instructions: 'Alte Anleitung',
          tempo: '3-1-1',
        }),
      ],
    });

    const plan = planLibraryImport(
      buildPayload({
        exercises: [{ name: 'Hip Thrust', trackingMode: 'reps_weight', unilateral: false }],
      }),
      state,
    );

    expect(plan.exercises[0].kind).toBe('unchanged');
    expect(plan.exercises[0].values).toEqual({});
  });

  it('bricht bei einem doppelten Namen in derselben Datei ab', () => {
    expect(() =>
      planLibraryImport(
        buildPayload({
          exercises: [
            { name: 'Pallof Press', trackingMode: 'reps_weight', unilateral: true },
            { name: 'pallof press', trackingMode: 'reps_weight', unilateral: true },
          ],
        }),
        emptyState(),
      ),
    ).toThrow(/mehrfach in dieser Datei/);
  });
});

describe('planLibraryImport - Zuordnungen', () => {
  const baseState = () =>
    emptyState({
      exercises: [
        buildExercise({ id: 'e1', name: 'Hip Thrust' }),
        buildExercise({ id: 'e2', name: 'Nordic Curl' }),
      ],
      templates: [buildTemplate('t1', 'Einheit B')],
      templateExercises: [
        buildAssignment({ id: 'te1', templateId: 't1', exerciseId: 'e1', orderIndex: 1 }),
        buildAssignment({ id: 'te2', templateId: 't1', exerciseId: 'e2', orderIndex: 2 }),
      ],
    });

  it('bricht ab, wenn das Workout weder existiert noch angelegt wird', () => {
    expect(() =>
      planLibraryImport(
        buildPayload({
          templateAssignments: [
            { template: 'Einheit C', exercise: 'Hip Thrust', orderIndex: 1, workSetCount: 3 },
          ],
        }),
        baseState(),
      ),
    ).toThrow(/Zuordnung 1: Workout "Einheit C"/);
  });

  it('bricht ab, wenn die Übung weder existiert noch angelegt wird', () => {
    expect(() =>
      planLibraryImport(
        buildPayload({
          templateAssignments: [
            {
              template: 'Einheit B',
              exercise: 'TEST Knie-zur-Wand',
              orderIndex: 1,
              workSetCount: 1,
            },
          ],
        }),
        baseState(),
      ),
    ).toThrow(/Zuordnung 1: Übung "TEST Knie-zur-Wand"/);
  });

  it('nimmt Workout und Übung an, die erst in derselben Datei entstehen', () => {
    const plan = planLibraryImport(
      buildPayload({
        exercises: [{ name: 'Standwaage', trackingMode: 'time', unilateral: true }],
        templates: [{ name: 'Mobility (Mi, 25 min)' }],
        templateAssignments: [
          {
            template: 'Mobility (Mi, 25 min)',
            exercise: 'Standwaage',
            orderIndex: 1,
            workSetCount: 1,
            includeWarmup: false,
          },
        ],
      }),
      emptyState(),
    );

    expect(plan.assignments[0].kind).toBe('new');
    expect(plan.assignments[0].record).toMatchObject({
      templateId: plan.templates[0].id,
      exerciseId: plan.exercises[0].id,
      workSetCount: 1,
      includeWarmup: false,
    });
    expect(plan.templateOrder[0].orderedIds).toEqual([plan.assignments[0].id]);
  });

  it('schiebt bestehende Zuordnungen nach hinten statt sie zu überschreiben', () => {
    const state = baseState();
    const plan = planLibraryImport(
      buildPayload({
        exercises: [{ name: 'Einbeiniges RDL', trackingMode: 'reps_weight', unilateral: true }],
        templateAssignments: [
          {
            template: 'Einheit B',
            exercise: 'Einbeiniges RDL',
            orderIndex: 2,
            workSetCount: 3,
          },
        ],
      }),
      state,
    );

    const newId = plan.assignments[0].id;

    expect(plan.templateOrder[0].orderedIds).toEqual(['te1', newId, 'te2']);
    expect(plan.assignments[0].note).toContain('Position 2');
    expect(plan.assignments[0].note).toContain('rückt nach hinten');
  });

  it('hängt hinten an, wenn der Wunschindex über die Liste hinausgeht', () => {
    const plan = planLibraryImport(
      buildPayload({
        exercises: [{ name: 'Pallof Press', trackingMode: 'reps_weight', unilateral: true }],
        templateAssignments: [
          { template: 'Einheit B', exercise: 'Pallof Press', orderIndex: 12, workSetCount: 3 },
        ],
      }),
      baseState(),
    );

    expect(plan.templateOrder[0].orderedIds).toEqual(['te1', 'te2', plan.assignments[0].id]);
  });

  it('setzt eine Einfügung mitten im Supersatz hinter den Block', () => {
    const state = emptyState({
      exercises: [
        buildExercise({ id: 'e1', name: 'Front Squat' }),
        buildExercise({ id: 'e2', name: 'Bulgarian Split Squat' }),
        buildExercise({ id: 'e3', name: 'Plank' }),
      ],
      templates: [buildTemplate('t1', 'Einheit A')],
      templateExercises: [
        buildAssignment({
          id: 'te1',
          templateId: 't1',
          exerciseId: 'e1',
          orderIndex: 1,
          supersetGroupId: 'g1',
        }),
        buildAssignment({
          id: 'te2',
          templateId: 't1',
          exerciseId: 'e2',
          orderIndex: 2,
          supersetGroupId: 'g1',
        }),
        buildAssignment({ id: 'te3', templateId: 't1', exerciseId: 'e3', orderIndex: 3 }),
      ],
    });

    const plan = planLibraryImport(
      buildPayload({
        exercises: [{ name: 'Pallof Press', trackingMode: 'reps_weight', unilateral: true }],
        templateAssignments: [
          { template: 'Einheit A', exercise: 'Pallof Press', orderIndex: 2, workSetCount: 3 },
        ],
      }),
      state,
    );

    const newId = plan.assignments[0].id;

    expect(plan.templateOrder[0].orderedIds).toEqual(['te1', 'te2', newId, 'te3']);
    expect(plan.assignments[0].note).toContain('Supersatz');
  });

  it('lässt die Position einer bestehenden Zuordnung stehen und sagt das', () => {
    const plan = planLibraryImport(
      buildPayload({
        templateAssignments: [
          { template: 'Einheit B', exercise: 'Nordic Curl', orderIndex: 7, workSetCount: 4 },
        ],
      }),
      baseState(),
    );

    expect(plan.assignments[0].kind).toBe('update');
    expect(plan.assignments[0].values).toEqual({ workSetCount: 4 });
    expect(plan.assignments[0].note).toBe('Position 2 bleibt (Datei nennt 7)');
    expect(plan.templateOrder).toHaveLength(0);
  });
});

describe('planLibraryImport - Felder leeren und Spannen', () => {
  const stateWith = (overrides: Partial<WorkoutTemplateExercise> = {}) =>
    emptyState({
      exercises: [buildExercise({ id: 'e1', name: 'Hip Thrust' })],
      templates: [buildTemplate('t1', 'Einheit B')],
      templateExercises: [
        buildAssignment({ id: 'te1', templateId: 't1', exerciseId: 'e1', orderIndex: 1, ...overrides }),
      ],
    });

  it('übernimmt targetRepsMax bei neuer und bestehender Zuordnung', () => {
    const created = planLibraryImport(
      buildPayload({
        templates: [{ name: 'Einheit C' }],
        templateAssignments: [
          { template: 'Einheit C', exercise: 'Hip Thrust', orderIndex: 1, workSetCount: 3, targetRepsMax: 10 },
        ],
      }),
      stateWith(),
    );

    expect(created.assignments[0].record?.targetRepsMax).toBe(10);

    const updated = planLibraryImport(
      buildPayload({
        templateAssignments: [
          { template: 'Einheit B', exercise: 'Hip Thrust', orderIndex: 1, workSetCount: 3, targetRepsMax: 10 },
        ],
      }),
      stateWith({ targetRepsMax: 8 }),
    );

    expect(updated.assignments[0].changes).toContainEqual({
      field: 'Ziel-Wdh. max.',
      from: '8',
      to: '10',
    });
    expect(updated.assignments[0].values.targetRepsMax).toBe(10);
  });

  it('leert ein Feld bei null und zeigt einen Strich', () => {
    const plan = planLibraryImport(
      buildPayload({
        templateAssignments: [
          { template: 'Einheit B', exercise: 'Hip Thrust', orderIndex: 1, workSetCount: 3, targetWeight: null },
        ],
      }),
      stateWith({ targetWeight: 82.5 }),
    );
    const [entry] = plan.assignments;

    expect(entry.kind).toBe('update');
    expect(entry.changes).toContainEqual({ field: 'Ziel-Gewicht', from: '82,5', to: '—' });
    expect('targetWeight' in entry.values).toBe(true);
    expect(entry.values.targetWeight).toBeUndefined();
  });

  it('null auf ein leeres Feld ist keine Änderung', () => {
    const plan = planLibraryImport(
      buildPayload({
        templateAssignments: [
          { template: 'Einheit B', exercise: 'Hip Thrust', orderIndex: 1, workSetCount: 3, targetWeight: null },
        ],
      }),
      stateWith(),
    );

    expect(plan.assignments[0].kind).toBe('unchanged');
    expect('targetWeight' in plan.assignments[0].values).toBe(false);
  });

  it('null bei einer neuen Zuordnung lässt das Feld weg', () => {
    const plan = planLibraryImport(
      buildPayload({
        templates: [{ name: 'Einheit C' }],
        templateAssignments: [
          { template: 'Einheit C', exercise: 'Hip Thrust', orderIndex: 1, workSetCount: 3, targetWeight: null },
        ],
      }),
      stateWith(),
    );
    const [entry] = plan.assignments;

    expect(entry.record?.targetWeight).toBeUndefined();
    expect(entry.changes.map((change) => change.field)).not.toContain('Ziel-Gewicht');
  });

  it('leert eine Notiz bei null', () => {
    const plan = planLibraryImport(
      buildPayload({
        templateAssignments: [
          { template: 'Einheit B', exercise: 'Hip Thrust', orderIndex: 1, workSetCount: 3, notes: null },
        ],
      }),
      stateWith({ notes: 'alt' }),
    );

    expect(plan.assignments[0].changes).toContainEqual({ field: 'Notiz', from: 'alt', to: '—' });
    expect('notes' in plan.assignments[0].values).toBe(true);
  });
});

describe('planLibraryImport - Workout ersetzen', () => {
  const baseState = () =>
    emptyState({
      exercises: [
        buildExercise({ id: 'e1', name: 'Squat' }),
        buildExercise({ id: 'e2', name: 'Beinstrecker' }),
        buildExercise({ id: 'e3', name: 'Klimmzug' }),
      ],
      templates: [buildTemplate('t1', 'Einheit A')],
      templateExercises: [
        buildAssignment({ id: 'te1', templateId: 't1', exerciseId: 'e1', orderIndex: 1 }),
        buildAssignment({ id: 'te2', templateId: 't1', exerciseId: 'e2', orderIndex: 2 }),
        buildAssignment({ id: 'te3', templateId: 't1', exerciseId: 'e3', orderIndex: 3 }),
      ],
      progressionRules: [buildRule('r1', 'te1'), buildRule('r2', 'te2')],
    });

  const replacePayload = (replaceAssignments = true) =>
    buildPayload({
      templates: [{ name: 'Einheit A', replaceAssignments }],
      templateAssignments: [
        { template: 'Einheit A', exercise: 'Klimmzug', orderIndex: 1, workSetCount: 3 },
        { template: 'Einheit A', exercise: 'Squat', orderIndex: 2, workSetCount: 3 },
      ],
    });

  it('entfernt Zuordnungen, die die Datei nicht nennt, und nennt ihre Wochenregeln', () => {
    const plan = planLibraryImport(replacePayload(), baseState());
    const removed = plan.assignments.filter((entry) => entry.kind === 'removed');

    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({
      id: 'te2',
      label: 'Beinstrecker',
      templateName: 'Einheit A',
      note: '1 Wochenregel geht mit',
      record: null,
    });
    expect(plan.summary.removedAssignments).toBe(1);
  });

  it('behält die Id bleibender Zuordnungen und übernimmt die Reihenfolge', () => {
    const plan = planLibraryImport(replacePayload(), baseState());
    const pullUp = plan.assignments.find((entry) => entry.id === 'te3');

    expect(plan.templateOrder).toEqual([
      { templateId: 't1', templateName: 'Einheit A', orderedIds: ['te3', 'te1'] },
    ]);
    expect(pullUp?.kind).toBe('update');
    expect(pullUp?.changes).toContainEqual({ field: 'Position', from: '3', to: '1' });
    expect(pullUp?.note).toBeUndefined();
  });

  it('nummeriert Lücken im orderIndex dicht', () => {
    const plan = planLibraryImport(
      buildPayload({
        templates: [{ name: 'Einheit A', replaceAssignments: true }],
        templateAssignments: [
          { template: 'Einheit A', exercise: 'Squat', orderIndex: 10, workSetCount: 3 },
          { template: 'Einheit A', exercise: 'Klimmzug', orderIndex: 5, workSetCount: 3 },
        ],
      }),
      baseState(),
    );
    const squat = plan.assignments.find((entry) => entry.id === 'te1');

    expect(plan.templateOrder[0].orderedIds).toEqual(['te3', 'te1']);
    expect(squat?.changes).toContainEqual({ field: 'Position', from: '1', to: '2' });
  });

  it('bricht ab, wenn ein ersetztes Workout keine Zuordnung in der Datei hat', () => {
    expect(() =>
      planLibraryImport(
        buildPayload({ templates: [{ name: 'Einheit A', replaceAssignments: true }] }),
        baseState(),
      ),
    ).toThrow('Workout "Einheit A" soll ersetzt werden, die Datei nennt aber keine Übung dafür.');
  });

  it('bricht bei doppeltem orderIndex in einem ersetzten Workout ab', () => {
    expect(() =>
      planLibraryImport(
        buildPayload({
          templates: [{ name: 'Einheit A', replaceAssignments: true }],
          templateAssignments: [
            { template: 'Einheit A', exercise: 'Squat', orderIndex: 2, workSetCount: 3 },
            { template: 'Einheit A', exercise: 'Klimmzug', orderIndex: 2, workSetCount: 3 },
          ],
        }),
        baseState(),
      ),
    ).toThrow(/orderIndex 2 steht für "Einheit A" mehrfach/);
  });

  it('bricht bei unbekanntem Workoutnamen ab, statt etwas zu entfernen', () => {
    expect(() =>
      planLibraryImport(
        buildPayload({
          templates: [{ name: 'Einheit A', replaceAssignments: true }],
          templateAssignments: [
            { template: 'Einheit A', exercise: 'Squat', orderIndex: 1, workSetCount: 3 },
            { template: 'Einheit Ä', exercise: 'Klimmzug', orderIndex: 2, workSetCount: 3 },
          ],
        }),
        baseState(),
      ),
    ).toThrow(/Workout "Einheit Ä" gibt es nicht/);
  });

  it('lässt Workouts ohne Flag additiv', () => {
    const plan = planLibraryImport(replacePayload(false), baseState());

    expect(plan.assignments.some((entry) => entry.kind === 'removed')).toBe(false);
    expect(plan.assignments.find((entry) => entry.id === 'te3')?.note).toBe(
      'Position 3 bleibt (Datei nennt 1)',
    );
    expect(plan.templateOrder).toHaveLength(0);
  });

  it('ersetzt ein Workout, das in derselben Datei entsteht', () => {
    const plan = planLibraryImport(
      buildPayload({
        templates: [{ name: 'Einheit Neu', replaceAssignments: true }],
        templateAssignments: [
          { template: 'Einheit Neu', exercise: 'Klimmzug', orderIndex: 2, workSetCount: 3 },
          { template: 'Einheit Neu', exercise: 'Squat', orderIndex: 1, workSetCount: 3 },
        ],
      }),
      baseState(),
    );
    const created = plan.assignments.filter((entry) => entry.templateName === 'Einheit Neu');

    expect(created.map((entry) => entry.kind)).toEqual(['new', 'new']);
    expect(plan.summary.removedAssignments).toBe(0);
    expect(plan.templateOrder[0].orderedIds).toEqual([created[1].id, created[0].id]);
  });

  it('ändert beim zweiten Lauf nichts mehr', () => {
    const payload = buildPayload({
      exercises: [{ name: 'Ruderzug', trackingMode: 'reps_weight', unilateral: false }],
      templates: [{ name: 'Einheit A', replaceAssignments: true }],
      templateAssignments: [
        { template: 'Einheit A', exercise: 'Ruderzug', orderIndex: 1, workSetCount: 3 },
        { template: 'Einheit A', exercise: 'Klimmzug', orderIndex: 2, workSetCount: 3 },
        { template: 'Einheit A', exercise: 'Squat', orderIndex: 3, workSetCount: 3 },
      ],
    });
    const first = planLibraryImport(payload, baseState());
    const afterFirst = applyPlan(baseState(), first);
    const second = planLibraryImport(payload, afterFirst);

    expect(afterFirst.templateExercises).toHaveLength(3);
    expect(afterFirst.progressionRules.map((rule) => rule.id)).toEqual(['r1']);
    expect(second.assignments.every((entry) => entry.kind === 'unchanged')).toBe(true);
    expect(second.summary.removedAssignments).toBe(0);
    expect(second.templateOrder).toHaveLength(0);
    expect(planHasChanges(second)).toBe(false);
  });

  it('bricht ab, wenn das ersetzte Workout dieselbe Übung doppelt enthält', () => {
    const state = baseState();
    state.templateExercises.push(
      buildAssignment({ id: 'te4', templateId: 't1', exerciseId: 'e1', orderIndex: 4 }),
    );

    // Die Datei kann eine Übung nur einmal nennen - welche der beiden Zeilen
    // bleiben soll, darf nicht die Sortierung der Ids entscheiden.
    expect(() => planLibraryImport(replacePayload(), state)).toThrow(
      'Workout "Einheit A" enthält "Squat" doppelt – bitte erst in der App bereinigen, dann ersetzen.',
    );
  });

  it('planHasChanges zählt eine reine Entfernung', () => {
    const plan = planLibraryImport(
      buildPayload({
        templates: [{ name: 'Einheit A', replaceAssignments: true }],
        templateAssignments: [
          { template: 'Einheit A', exercise: 'Squat', orderIndex: 1, workSetCount: 3 },
          { template: 'Einheit A', exercise: 'Beinstrecker', orderIndex: 2, workSetCount: 3 },
        ],
      }),
      baseState(),
    );

    expect(plan.assignments.filter((entry) => entry.kind !== 'removed').map((entry) => entry.kind)).toEqual([
      'unchanged',
      'unchanged',
    ]);
    expect(planHasChanges(plan)).toBe(true);
  });
});

describe('planLibraryImport - Supersätze', () => {
  const baseState = (groups: Record<string, string> = {}) =>
    emptyState({
      exercises: [
        buildExercise({ id: 'e1', name: 'Squat' }),
        buildExercise({ id: 'e2', name: 'Beinstrecker' }),
        buildExercise({ id: 'e3', name: 'Klimmzug' }),
      ],
      templates: [buildTemplate('t1', 'Einheit A')],
      templateExercises: [
        buildAssignment({ id: 'te1', templateId: 't1', exerciseId: 'e1', orderIndex: 1, supersetGroupId: groups.te1 }),
        buildAssignment({ id: 'te2', templateId: 't1', exerciseId: 'e2', orderIndex: 2, supersetGroupId: groups.te2 }),
        buildAssignment({ id: 'te3', templateId: 't1', exerciseId: 'e3', orderIndex: 3, supersetGroupId: groups.te3 }),
      ],
      progressionRules: [buildRule('r1', 'te3')],
    });

  const row = (exercise: string, orderIndex: number, superset?: string) => ({
    template: 'Einheit A',
    exercise,
    orderIndex,
    workSetCount: 3,
    ...(superset ? { superset } : {}),
  });

  const replace = (...rows: ReturnType<typeof row>[]) =>
    buildPayload({
      templates: [{ name: 'Einheit A', replaceAssignments: true }],
      templateAssignments: rows,
    });

  const byId = (plan: ReturnType<typeof planLibraryImport>, id: string) =>
    plan.assignments.find((entry) => entry.id === id);

  it('bildet eine Gruppe aus dem Gruppennamen', () => {
    const plan = planLibraryImport(
      replace(row('Squat', 1, 'Block 1'), row('Klimmzug', 2, 'Block 1'), row('Beinstrecker', 3)),
      baseState(),
    );
    const squat = byId(plan, 'te1');
    const pullUp = byId(plan, 'te3');

    expect(squat?.values.supersetGroupId).toBeTruthy();
    expect(pullUp?.values.supersetGroupId).toBe(squat?.values.supersetGroupId);
    expect(squat?.changes).toContainEqual({ field: 'Supersatz', from: 'allein', to: 'mit Klimmzug' });
    expect(byId(plan, 'te2')?.kind).toBe('update');
  });

  it('behält die Gruppen-Id bei gleichen Mitgliedern', () => {
    const plan = planLibraryImport(
      replace(row('Squat', 1, 'block 1'), row('Beinstrecker', 2, 'Block 1 '), row('Klimmzug', 3)),
      baseState({ te1: 'g1', te2: 'g1' }),
    );

    expect(plan.assignments.map((entry) => entry.kind)).toEqual(['unchanged', 'unchanged', 'unchanged']);
    expect('supersetGroupId' in (byId(plan, 'te1')?.values ?? {})).toBe(false);
  });

  it('vergibt eine neue Id, wenn ein Fremder die alte Id behält', () => {
    const plan = planLibraryImport(
      replace(row('Squat', 1, 'A'), row('Klimmzug', 2, 'A'), row('Beinstrecker', 3)),
      baseState({ te1: 'g1', te2: 'g1', te3: 'g1' }),
    );
    const groupId = byId(plan, 'te1')?.values.supersetGroupId;

    expect(groupId).toBeTruthy();
    expect(groupId).not.toBe('g1');
    expect(byId(plan, 'te3')?.values.supersetGroupId).toBe(groupId);
    expect('supersetGroupId' in (byId(plan, 'te2')?.values ?? {})).toBe(true);
    expect(byId(plan, 'te2')?.values.supersetGroupId).toBeUndefined();
  });

  it('löst eine Gruppe auf, wenn die Datei keinen Gruppennamen nennt', () => {
    const plan = planLibraryImport(
      replace(row('Squat', 1), row('Beinstrecker', 2), row('Klimmzug', 3)),
      baseState({ te1: 'g1', te2: 'g1' }),
    );
    const squat = byId(plan, 'te1');

    expect('supersetGroupId' in (squat?.values ?? {})).toBe(true);
    expect(squat?.values.supersetGroupId).toBeUndefined();
    expect(squat?.changes).toContainEqual({ field: 'Supersatz', from: 'mit Beinstrecker', to: 'allein' });
  });

  it('wechselt die Gruppe, ohne die Id der Zuordnung zu ändern', () => {
    const plan = planLibraryImport(
      replace(row('Beinstrecker', 1, 'Neu'), row('Klimmzug', 2, 'Neu'), row('Squat', 3)),
      baseState({ te1: 'g1', te3: 'g1' }),
    );
    const pullUp = byId(plan, 'te3');

    expect(pullUp?.kind).toBe('update');
    expect(pullUp?.changes).toContainEqual({ field: 'Supersatz', from: 'mit Squat', to: 'mit Beinstrecker' });
    expect(plan.summary.removedAssignments).toBe(0);
  });

  it('bricht bei nicht zusammenhängender Gruppe ab', () => {
    expect(() =>
      planLibraryImport(
        replace(row('Squat', 1, 'Block 1'), row('Beinstrecker', 2), row('Klimmzug', 3, 'Block 1')),
        baseState(),
      ),
    ).toThrow(/Supersatz "Block 1" in "Einheit A" ist nicht zusammenhängend/);
  });

  it('bricht bei einer Gruppe mit nur einem Mitglied ab', () => {
    expect(() =>
      planLibraryImport(replace(row('Squat', 1, 'Block 1'), row('Klimmzug', 2)), baseState()),
    ).toThrow(/Supersatz "Block 1" in "Einheit A" hat nur eine Übung/);
  });

  it('bricht bei superset in einem nicht ersetzten Workout ab', () => {
    expect(() =>
      planLibraryImport(
        buildPayload({ templateAssignments: [row('Squat', 1, 'Block 1')] }),
        baseState(),
      ),
    ).toThrow(/Zuordnung 1: "superset" geht nur bei einem Workout mit "replaceAssignments": true/);
  });

  it('bildet Gruppen in einem neu angelegten Workout', () => {
    const plan = planLibraryImport(
      buildPayload({
        templates: [{ name: 'Einheit Neu', replaceAssignments: true }],
        templateAssignments: [
          { ...row('Squat', 1, 'X'), template: 'Einheit Neu' },
          { ...row('Klimmzug', 2, 'X'), template: 'Einheit Neu' },
        ],
      }),
      baseState(),
    );
    const [first, second] = plan.assignments;

    expect(first.record?.supersetGroupId).toBeTruthy();
    expect(second.record?.supersetGroupId).toBe(first.record?.supersetGroupId);
  });

  it('ändert beim zweiten Lauf auch mit Gruppen nichts mehr', () => {
    const payload = replace(row('Klimmzug', 1, 'B1'), row('Squat', 2, 'B1'), row('Beinstrecker', 3));
    const first = planLibraryImport(payload, baseState({ te2: 'g9' }));
    const afterFirst = applyPlan(baseState({ te2: 'g9' }), first);
    const second = planLibraryImport(payload, afterFirst);

    expect(second.assignments.every((entry) => entry.kind === 'unchanged')).toBe(true);
    expect(second.templateOrder).toHaveLength(0);
    expect(afterFirst.templateExercises.find((item) => item.id === 'te2')?.supersetGroupId).toBeUndefined();
  });
});

describe('planLibraryImport - Bänder', () => {
  it('hängt neue Stufen an ihrer Position ein und verschiebt den Rest', () => {
    const state = emptyState({ bandLevels: [buildBand('b1', 'Lila', 1)] });
    const plan = planLibraryImport(
      buildPayload({
        bandLevels: [
          { name: 'Schwarz', orderIndex: 2 },
          { name: 'Grün', orderIndex: 3 },
        ],
      }),
      state,
    );

    expect(plan.bandOrder).toEqual(['b1', plan.bandLevels[0].id, plan.bandLevels[1].id]);
    expect(plan.summary.createdBandLevels).toBe(2);
  });

  it('lässt die Stufe eines bestehenden Bands unangetastet', () => {
    const state = emptyState({
      bandLevels: [buildBand('b1', 'Lila', 1), buildBand('b2', 'Rot', 2)],
    });
    const plan = planLibraryImport(
      buildPayload({ bandLevels: [{ name: 'rot', orderIndex: 9 }] }),
      state,
    );

    expect(plan.bandLevels[0].id).toBe('b2');
    expect(plan.bandLevels[0].kind).toBe('update');
    expect(plan.bandLevels[0].values).toEqual({ name: 'rot' });
    expect(plan.bandOrder).toEqual(['b1', 'b2']);
  });
});

describe('planLibraryImport - Idempotenz', () => {
  it('meldet beim zweiten Lauf nichts mehr zu tun', () => {
    const payload = buildPayload({
      exercises: [
        { name: 'Einbeiniges RDL', trackingMode: 'reps_weight', unilateral: true },
        { name: 'Standwaage', trackingMode: 'time', unilateral: true },
      ],
      templates: [{ name: 'Mobility (Mi, 25 min)' }],
      templateAssignments: [
        {
          template: 'Mobility (Mi, 25 min)',
          exercise: 'Standwaage',
          orderIndex: 1,
          workSetCount: 1,
          includeWarmup: false,
        },
        {
          template: 'Einheit B',
          exercise: 'Einbeiniges RDL',
          orderIndex: 2,
          workSetCount: 3,
          includeWarmup: false,
        },
      ],
      bandLevels: [{ name: 'Schwarz', orderIndex: 2 }],
    });

    const initial = emptyState({
      exercises: [buildExercise({ id: 'e1', name: 'Hip Thrust' })],
      templates: [buildTemplate('t1', 'Einheit B')],
      templateExercises: [
        buildAssignment({ id: 'te1', templateId: 't1', exerciseId: 'e1', orderIndex: 1 }),
      ],
      bandLevels: [buildBand('b1', 'Lila', 1)],
    });

    const first = planLibraryImport(payload, initial);
    const afterFirst = applyPlan(initial, first);
    const second = planLibraryImport(payload, afterFirst);

    expect(second.summary).toEqual({
      createdExercises: 0,
      updatedExercises: 0,
      createdTemplates: 0,
      updatedTemplates: 0,
      createdAssignments: 0,
      updatedAssignments: 0,
      createdBandLevels: 0,
      updatedBandLevels: 0,
      removedAssignments: 0,
    });
    expect(second.templateOrder).toHaveLength(0);
    expect(second.bandOrder).toBeNull();
    expect(afterFirst.exercises).toHaveLength(3);
    expect(afterFirst.templateExercises).toHaveLength(3);
    expect(afterFirst.bandLevels).toHaveLength(2);
  });
});
