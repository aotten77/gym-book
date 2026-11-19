import { describe, expect, it } from 'vitest';
import { describeImportCounts } from '@/domain/library-import-summary';

const none = {
  createdExercises: 0,
  updatedExercises: 0,
  createdTemplates: 0,
  updatedTemplates: 0,
  createdAssignments: 0,
  updatedAssignments: 0,
  createdBandLevels: 0,
  updatedBandLevels: 0,
};

describe('describeImportCounts', () => {
  it('zählt neu und geändert je Art zusammen', () => {
    expect(
      describeImportCounts({
        ...none,
        createdTemplates: 1,
        updatedTemplates: 1,
        createdExercises: 1,
        updatedAssignments: 3,
        createdPlanEntries: 9,
      }),
    ).toBe('2 Workouts, 1 Übung, 3 Zuordnungen, 9 Termine');
  });

  it('nennt Bandstufen, auch wenn sie das Einzige sind', () => {
    expect(describeImportCounts({ ...none, createdBandLevels: 2, updatedBandLevels: 1 })).toBe(
      '3 Bandstufen',
    );
    expect(describeImportCounts({ ...none, createdBandLevels: 1 })).toBe('1 Bandstufe');
  });

  it('nennt Entfernungen, auch wenn sie das Einzige sind', () => {
    expect(describeImportCounts({ ...none, removedPlanEntries: 4 })).toBe('4 Termine entfernt');
    expect(describeImportCounts({ ...none, removedAssignments: 1 })).toBe('1 Zuordnung entfernt');
  });

  it('stellt Entfernungen hinter das Angelegte', () => {
    expect(
      describeImportCounts({
        ...none,
        updatedTemplates: 1,
        createdPlanEntries: 2,
        removedAssignments: 5,
        removedPlanEntries: 1,
      }),
    ).toBe('1 Workout, 2 Termine, 5 Zuordnungen entfernt, 1 Termin entfernt');
  });

  it('behandelt fehlende Felder älterer Zeilen als 0', () => {
    expect(describeImportCounts({ ...none, createdExercises: 2 })).toBe('2 Übungen');
  });

  it('sagt „keine Änderungen“ nur, wenn wirklich alles 0 ist', () => {
    expect(describeImportCounts(none)).toBe('keine Änderungen');
    expect(describeImportCounts({ ...none, removedPlanEntries: 0, createdPlanEntries: 0 })).toBe(
      'keine Änderungen',
    );
  });
});
