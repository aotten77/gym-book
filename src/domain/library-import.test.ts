import { describe, expect, it } from 'vitest';

import {
  hashImportPayload,
  parseLibraryImportPayload,
  planLibraryImport,
  type LibraryImportPayload,
  type LibraryImportState,
} from '@/domain/library-import';
import type { BandLevel, Exercise, WorkoutTemplate, WorkoutTemplateExercise } from '@/domain/models';

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
    ...overrides,
  };
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

  for (const entry of plan.assignments) {
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

  return { exercises, templates, templateExercises, bandLevels };
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
    });
    expect(second.templateOrder).toHaveLength(0);
    expect(second.bandOrder).toBeNull();
    expect(afterFirst.exercises).toHaveLength(3);
    expect(afterFirst.templateExercises).toHaveLength(3);
    expect(afterFirst.bandLevels).toHaveLength(2);
  });
});
