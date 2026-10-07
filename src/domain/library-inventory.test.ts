import { describe, expect, it } from 'vitest';
import {
  parseLibraryImportPayload,
  planHasChanges,
  planLibraryImport,
  type LibraryImportState,
} from '@/domain/library-import';
import { buildLibraryInventory, type LibraryInventoryInput } from '@/domain/library-inventory';
import type {
  BandLevel,
  Exercise,
  Program,
  ProgramWeek,
  ProgressionRule,
  WorkoutTemplate,
  WorkoutTemplateExercise,
} from '@/domain/models';

const stamp = '2026-10-01T10:00:00.000Z';

function exercise(overrides: Partial<Exercise> & { id: string; name: string }): Exercise {
  return { trackingMode: 'reps_weight', unilateral: false, createdAt: stamp, updatedAt: stamp, ...overrides };
}

function template(overrides: Partial<WorkoutTemplate> & { id: string; name: string }): WorkoutTemplate {
  return { createdAt: stamp, updatedAt: stamp, ...overrides };
}

function assignment(
  overrides: Partial<WorkoutTemplateExercise> & { id: string; templateId: string; exerciseId: string; orderIndex: number },
): WorkoutTemplateExercise {
  return { workSetCount: 3, ...overrides };
}

const bands: BandLevel[] = [
  { id: 'band-rot', name: 'rot', orderIndex: 2, createdAt: stamp, updatedAt: stamp },
  { id: 'band-gelb', name: 'gelb', orderIndex: 1, createdAt: stamp, updatedAt: stamp },
];

const exercises: Exercise[] = [
  exercise({ id: 'ex-squat', name: 'Front Squat', instructions: '- Ellbogen hoch', tempo: '3-1-1-0' }),
  exercise({ id: 'ex-pull', name: 'Klimmzug' }),
  exercise({ id: 'ex-step', name: 'Step-down', unilateral: true, tracksHeight: true }),
  exercise({ id: 'ex-band', name: 'Pallof Press', loadKind: 'band', unilateral: true }),
  exercise({ id: 'ex-plank', name: 'Seitstütz', trackingMode: 'time', unilateral: true }),
  exercise({ id: 'ex-curl', name: 'Beinbeuger' }),
];

const templates: WorkoutTemplate[] = [
  template({ id: 'tpl-b', name: 'Einheit B' }),
  template({ id: 'tpl-a', name: 'Einheit A', notes: 'Montag' }),
  template({ id: 'tpl-mob', name: 'Mobility', category: 'mobility' }),
];

const templateExercises: WorkoutTemplateExercise[] = [
  // Absichtlich ungeordnet und mit Lücke im orderIndex.
  assignment({ id: 'a-curl', templateId: 'tpl-a', exerciseId: 'ex-curl', orderIndex: 7, restSeconds: 90 }),
  assignment({
    id: 'a-squat',
    templateId: 'tpl-a',
    exerciseId: 'ex-squat',
    orderIndex: 2,
    workSetCount: 4,
    targetReps: 5,
    targetWeight: 62.5,
    supersetGroupId: 'grp-1',
  }),
  assignment({
    id: 'a-pull',
    templateId: 'tpl-a',
    exerciseId: 'ex-pull',
    orderIndex: 3,
    targetReps: 6,
    targetRepsMax: 8,
    supersetGroupId: 'grp-1',
    notes: 'Mit Gummiband',
  }),
  assignment({
    id: 'a-step',
    templateId: 'tpl-b',
    exerciseId: 'ex-step',
    orderIndex: 1,
    includeWarmup: false,
    targetReps: 8,
    targetHeightCm: 20,
    supersetGroupId: 'grp-9',
  }),
  assignment({
    id: 'a-band',
    templateId: 'tpl-b',
    exerciseId: 'ex-band',
    orderIndex: 2,
    targetReps: 10,
    targetBandId: 'band-rot',
    supersetGroupId: 'grp-9',
  }),
  assignment({ id: 'a-plank', templateId: 'tpl-mob', exerciseId: 'ex-plank', orderIndex: 1, targetSeconds: 30 }),
];

const program: Program = {
  id: 'prog-1',
  name: 'Herbstplan',
  activeWeek: 1,
  startedOn: '2026-09-28',
  createdAt: stamp,
  updatedAt: stamp,
};

const programWeeks: ProgramWeek[] = [
  { id: 'w2', programId: 'prog-1', weekNumber: 2, label: 'Woche 2' },
  { id: 'w1', programId: 'prog-1', weekNumber: 1, label: 'Woche 1' },
  { id: 'w3', programId: 'prog-1', weekNumber: 3, label: 'Deload', kind: 'deload' },
  { id: 'other', programId: 'prog-2', weekNumber: 1, label: 'Fremd' },
];

const progressionRules: ProgressionRule[] = [
  { id: 'r1', templateExerciseId: 'a-squat', programWeekId: 'w2', targetWeight: 65 },
  { id: 'r2', templateExerciseId: 'a-band', programWeekId: 'w2', targetBandId: 'band-rot', notes: 'langsam' },
  { id: 'r3', templateExerciseId: 'a-squat', programWeekId: 'w3', workSetCount: 2 },
  { id: 'r4', templateExerciseId: 'a-curl', programWeekId: 'other', targetWeight: 99 },
];

const input: LibraryInventoryInput = {
  exercises,
  templates,
  templateExercises,
  bandLevels: bands,
  program,
  programWeeks,
  progressionRules,
};

const state: LibraryImportState = {
  exercises,
  templates,
  templateExercises,
  bandLevels: bands,
  progressionRules,
  planEntries: [],
  takenPlanEntryIds: new Set(),
};

describe('buildLibraryInventory', () => {
  it('lässt sich als Import ohne eine einzige Änderung wieder einlesen', () => {
    const inventory = buildLibraryInventory(input);
    const payload = {
      schemaVersion: 1,
      exercises: inventory.exercises,
      templates: inventory.templates.map((item) => ({ ...item, replaceAssignments: true })),
      templateAssignments: inventory.templateAssignments,
      bandLevels: inventory.bandLevels,
    };

    const plan = planLibraryImport(parseLibraryImportPayload(JSON.stringify(payload)), state);

    expect(plan.summary.removedAssignments).toBe(0);
    expect(planHasChanges(plan)).toBe(false);
  });

  it('wird von der App so, wie er ist, nicht als Import angenommen', () => {
    expect(() => parseLibraryImportPayload(JSON.stringify(buildLibraryInventory(input)))).toThrow();
  });

  it('enthält keine Ids', () => {
    const text = JSON.stringify(buildLibraryInventory(input));

    for (const id of ['ex-squat', 'tpl-a', 'a-squat', 'grp-1', 'band-rot', 'prog-1', 'w2', 'r1']) {
      expect(text).not.toContain(`"${id}"`);
    }
  });

  it('ordnet Zuordnungen nach Workout und Position, dicht ab 1, mit Supersatz-Namen je Workout', () => {
    const { templateAssignments } = buildLibraryInventory(input);

    expect(templateAssignments).toEqual([
      {
        template: 'Einheit A',
        exercise: 'Front Squat',
        orderIndex: 1,
        workSetCount: 4,
        targetReps: 5,
        targetWeight: 62.5,
        superset: 'S1',
      },
      {
        template: 'Einheit A',
        exercise: 'Klimmzug',
        orderIndex: 2,
        workSetCount: 3,
        targetReps: 6,
        targetRepsMax: 8,
        notes: 'Mit Gummiband',
        superset: 'S1',
      },
      { template: 'Einheit A', exercise: 'Beinbeuger', orderIndex: 3, workSetCount: 3, restSeconds: 90 },
      {
        template: 'Einheit B',
        exercise: 'Step-down',
        orderIndex: 1,
        workSetCount: 3,
        includeWarmup: false,
        targetReps: 8,
        targetHeightCm: 20,
        superset: 'S1',
      },
      {
        template: 'Einheit B',
        exercise: 'Pallof Press',
        orderIndex: 2,
        workSetCount: 3,
        targetReps: 10,
        targetBand: 'rot',
        superset: 'S1',
      },
      { template: 'Mobility', exercise: 'Seitstütz', orderIndex: 1, workSetCount: 3, targetSeconds: 30 },
    ]);
  });

  it('beschreibt Übungen, Workouts und Bänder in den Feldnamen des Imports', () => {
    const inventory = buildLibraryInventory(input);

    expect(inventory.exercises.map((item) => item.name)).toEqual([
      'Beinbeuger',
      'Front Squat',
      'Klimmzug',
      'Pallof Press',
      'Seitstütz',
      'Step-down',
    ]);
    expect(inventory.exercises[1]).toEqual({
      name: 'Front Squat',
      trackingMode: 'reps_weight',
      unilateral: false,
      instructions: '- Ellbogen hoch',
      tempo: '3-1-1-0',
    });
    expect(inventory.exercises[3]).toMatchObject({ loadKind: 'band', unilateral: true });
    expect(inventory.exercises[5]).toMatchObject({ tracksHeight: true });
    expect(inventory.templates).toEqual([
      { name: 'Einheit A', category: 'strength', notes: 'Montag' },
      { name: 'Einheit B', category: 'strength' },
      { name: 'Mobility', category: 'mobility' },
    ]);
    expect(inventory.bandLevels).toEqual([
      { name: 'gelb', orderIndex: 1 },
      { name: 'rot', orderIndex: 2 },
    ]);
  });

  it('nennt die Wochen des aktiven Programms samt Regeln, über Namen statt Ids', () => {
    const { programm } = buildLibraryInventory(input);

    expect(programm).toEqual({
      name: 'Herbstplan',
      startedOn: '2026-09-28',
      wochen: [
        { woche: 1, label: 'Woche 1', regeln: [] },
        {
          woche: 2,
          label: 'Woche 2',
          regeln: [
            { template: 'Einheit A', exercise: 'Front Squat', targetWeight: 65 },
            { template: 'Einheit B', exercise: 'Pallof Press', targetBand: 'rot', notes: 'langsam' },
          ],
        },
        {
          woche: 3,
          label: 'Deload',
          kind: 'deload',
          regeln: [{ template: 'Einheit A', exercise: 'Front Squat', workSetCount: 2 }],
        },
      ],
    });
  });

  it('hat ohne aktives Programm kein Programm', () => {
    expect(buildLibraryInventory({ ...input, program: undefined }).programm).toBeNull();
  });
});
