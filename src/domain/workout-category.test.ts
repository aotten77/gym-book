import { describe, expect, it } from 'vitest';
import {
  describeWorkoutCategory,
  normalizeWorkoutCategory,
  resolveWorkoutCategory,
} from '@/domain/workout-category';

describe('Art des Workouts', () => {
  it('schreibt Kraft nie, nur Mobility', () => {
    expect(normalizeWorkoutCategory('strength')).toBeUndefined();
    expect(normalizeWorkoutCategory('mobility')).toBe('mobility');
    expect(normalizeWorkoutCategory(null)).toBeUndefined();
    expect(normalizeWorkoutCategory(undefined)).toBeUndefined();
  });

  it('liest ein fehlendes Feld als Kraft', () => {
    expect(resolveWorkoutCategory(undefined)).toBe('strength');
    expect(resolveWorkoutCategory('mobility')).toBe('mobility');
  });

  it('beschreibt die Art für die Anzeige', () => {
    expect(describeWorkoutCategory('mobility')).toBe('Mobility');
    expect(describeWorkoutCategory(undefined)).toBe('Kraft');
    expect(describeWorkoutCategory('strength')).toBe('Kraft');
  });
});
