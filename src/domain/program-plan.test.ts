import { describe, expect, it } from 'vitest';
import type {
  Exercise,
  ProgressionRule,
  WorkoutTemplate,
  WorkoutTemplateExercise,
} from '@/domain/models';
import type { FoldableTargetField, FoldedTargets } from '@/domain/progression-fold';
import {
  buildWeekPlan,
  describeWeekPrescription,
  UNKNOWN_EXERCISE_NAME,
} from '@/domain/program-plan';

const timestamps = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };

const templates: WorkoutTemplate[] = [
  { id: 'template-b', name: 'Einheit B', ...timestamps },
  { id: 'template-a', name: 'Einheit A', ...timestamps },
];

const exercises: Exercise[] = [
  { id: 'ex-squat', name: 'Front Squat', trackingMode: 'reps_weight', unilateral: false, ...timestamps },
  { id: 'ex-split', name: 'Split Squat', trackingMode: 'reps_weight', unilateral: true, ...timestamps },
  { id: 'ex-nordic', name: 'Nordic Curl', trackingMode: 'time_weight', unilateral: false, ...timestamps },
];

function templateExercise(overrides: Partial<WorkoutTemplateExercise>): WorkoutTemplateExercise {
  return {
    id: 'te-1',
    templateId: 'template-a',
    exerciseId: 'ex-squat',
    orderIndex: 1,
    workSetCount: 3,
    ...overrides,
  };
}

const templateExercises: WorkoutTemplateExercise[] = [
  templateExercise({ id: 'te-2', orderIndex: 2, exerciseId: 'ex-split', supersetGroupId: 'group-1' }),
  templateExercise({ id: 'te-1', orderIndex: 1, targetReps: 8, targetRepsMax: 10, targetWeight: 80 }),
  templateExercise({ id: 'te-3', orderIndex: 3, exerciseId: 'ex-nordic', supersetGroupId: 'group-1' }),
  templateExercise({ id: 'te-4', templateId: 'template-b', orderIndex: 1, exerciseId: 'ex-squat' }),
];

const progressionRules: ProgressionRule[] = [
  { id: 'rule-w2', templateExerciseId: 'te-1', programWeekId: 'week-2', targetWeight: 85 },
  { id: 'rule-w3', templateExerciseId: 'te-1', programWeekId: 'week-3', targetReps: 5, targetWeight: 90 },
];

describe('buildWeekPlan', () => {
  it('gruppiert nach Workout, sortiert nach Namen und hält die Reihenfolge der Übungen', () => {
    const blocks = buildWeekPlan({
      templates,
      templateExercises,
      exercises,
      progressionRules,
      programWeekId: 'week-1',
    });

    expect(blocks.map((block) => block.templateName)).toEqual(['Einheit A', 'Einheit B']);
    expect(blocks[0].entries.map((entry) => entry.templateExerciseId)).toEqual([
      'te-1',
      'te-2',
      'te-3',
    ]);
    // Der Supersatz bleibt zusammenhängend, weil `orderIndex` ihn so hält.
    expect(blocks[0].entries.map((entry) => entry.supersetGroupId)).toEqual([
      undefined,
      'group-1',
      'group-1',
    ]);
  });

  it('zeigt in einer Woche ohne Regel die Basiswerte, unmarkiert', () => {
    const [blockA] = buildWeekPlan({
      templates,
      templateExercises,
      exercises,
      progressionRules,
      programWeekId: 'week-1',
    });

    expect(blockA.entries[0].effective).toMatchObject({ targetWeight: 80, targetReps: 8 });
    expect(blockA.entries[0].overriddenFields).toEqual([]);
  });

  it('faltet die Regel der gewählten Woche darüber und meldet die Felder', () => {
    const [blockA] = buildWeekPlan({
      templates,
      templateExercises,
      exercises,
      progressionRules,
      programWeekId: 'week-3',
    });

    expect(blockA.entries[0].effective).toMatchObject({
      targetReps: 5,
      targetWeight: 90,
      // Die Decke steht weiter im Workout - die Regel setzt sie nicht.
      targetRepsMax: 10,
    });
    expect(blockA.entries[0].overriddenFields).toEqual(['targetReps', 'targetWeight']);
  });

  it('lässt ohne gewählte Woche jede Regel außen vor', () => {
    const [blockA] = buildWeekPlan({
      templates,
      templateExercises,
      exercises,
      progressionRules,
    });

    expect(blockA.entries[0].effective.targetWeight).toBe(80);
    expect(blockA.entries[0].overriddenFields).toEqual([]);
  });

  it('stürzt bei einer gelöschten Übung nicht ab', () => {
    /*
     * Der Unterschied zu `materializeSession`, die hier bewusst wirft: eine
     * Planungsübersicht muss auch dann etwas zeigen, wenn eine Übung aus der
     * Bibliothek verschwunden ist.
     */
    const blocks = buildWeekPlan({
      templates,
      templateExercises: [templateExercise({ id: 'te-weg', exerciseId: 'gibt-es-nicht' })],
      exercises,
      progressionRules,
      programWeekId: 'week-1',
    });

    expect(blocks[0].entries[0].exerciseName).toBe(UNKNOWN_EXERCISE_NAME);
    expect(blocks[0].entries[0].trackingMode).toBeUndefined();
  });

  it('führt ein Workout ohne Übungen als leeren Block', () => {
    const blocks = buildWeekPlan({
      templates,
      templateExercises: [],
      exercises,
      progressionRules,
      programWeekId: 'week-1',
    });

    expect(blocks).toHaveLength(2);
    expect(blocks[0].entries).toEqual([]);
  });
});

describe('describeWeekPrescription', () => {
  function entry(
    effective: FoldedTargets,
    overriddenFields: FoldableTargetField[] = [],
    workSetCount = 3,
  ) {
    return { workSetCount, effective, overriddenFields };
  }

  it('schreibt die Spanne als Bereich und das Gewicht daneben', () => {
    expect(
      describeWeekPrescription(entry({ targetReps: 8, targetRepsMax: 10, targetWeight: 85 })),
    ).toEqual([
      { text: '3 × 8–10 Wdh', overridden: false },
      { text: '85 kg', overridden: false },
    ]);
  });

  it('markiert genau das Feld, das aus der Woche kommt', () => {
    expect(
      describeWeekPrescription(
        entry({ targetReps: 8, targetRepsMax: 10, targetWeight: 85 }, ['targetWeight']),
      ),
    ).toEqual([
      { text: '3 × 8–10 Wdh', overridden: false },
      { text: '85 kg', overridden: true },
    ]);
  });

  it('lässt den Bandnamen die Kilos schlagen', () => {
    expect(
      describeWeekPrescription(entry({ targetReps: 12, targetBandId: 'band-1', targetWeight: 10 }), {
        'band-1': 'grün',
      }),
    ).toEqual([
      { text: '3 × 12 Wdh', overridden: false },
      { text: 'grün', overridden: false },
    ]);
  });

  it('nennt ein Band, das der Katalog nicht mehr kennt, neutral', () => {
    expect(
      describeWeekPrescription(entry({ targetBandId: 'band-weg' }), {})[1],
    ).toEqual({ text: 'Band', overridden: false });
  });

  it('setzt die Höhe an die Stelle der Last, wenn es keine gibt', () => {
    expect(describeWeekPrescription(entry({ targetReps: 8, targetHeightCm: 25 }))).toEqual([
      { text: '3 × 8 Wdh', overridden: false },
      { text: '25 cm', overridden: false },
    ]);
  });

  it('stellt die Höhe voran, wenn daneben Kilos stehen', () => {
    expect(
      describeWeekPrescription(entry({ targetReps: 8, targetHeightCm: 25, targetWeight: 12.5 })),
    ).toEqual([
      { text: '3 × 8 Wdh', overridden: false },
      { text: '25 cm', overridden: false },
      { text: '12,5 kg', overridden: false },
    ]);
  });

  it('schreibt Sekunden und deutsche Zahlen', () => {
    expect(describeWeekPrescription(entry({ targetSeconds: 16, targetWeight: 7.5 }))).toEqual([
      { text: '3 × 16 s', overridden: false },
      { text: '7,5 kg', overridden: false },
    ]);
  });

  it('nennt die Sätze auch ohne jede Zielzahl', () => {
    expect(describeWeekPrescription(entry({}))).toEqual([{ text: '3 Sätze', overridden: false }]);
  });
});
