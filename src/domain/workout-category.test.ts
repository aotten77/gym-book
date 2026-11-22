import { describe, expect, it } from 'vitest';
import {
  describeWorkoutCategory,
  normalizeWorkoutCategory,
  resolveWorkoutCategory,
} from '@/domain/workout-category';

describe('Art des Workouts', () => {
  it('schreibt Kraft nie, nur Mobility, Yoga und Faszien', () => {
    expect(normalizeWorkoutCategory('strength')).toBeUndefined();
    expect(normalizeWorkoutCategory('mobility')).toBe('mobility');
    expect(normalizeWorkoutCategory('yoga')).toBe('yoga');
    expect(normalizeWorkoutCategory('faszien')).toBe('faszien');
    expect(normalizeWorkoutCategory(null)).toBeUndefined();
    expect(normalizeWorkoutCategory(undefined)).toBeUndefined();
  });

  it('liest ein fehlendes Feld als Kraft', () => {
    expect(resolveWorkoutCategory(undefined)).toBe('strength');
    expect(resolveWorkoutCategory('mobility')).toBe('mobility');
    expect(resolveWorkoutCategory('yoga')).toBe('yoga');
    expect(resolveWorkoutCategory('faszien')).toBe('faszien');
  });

  it('beschreibt die Art für die Anzeige', () => {
    expect(describeWorkoutCategory('mobility')).toBe('Mobility');
    expect(describeWorkoutCategory('yoga')).toBe('Yoga');
    expect(describeWorkoutCategory('faszien')).toBe('Faszien');
    expect(describeWorkoutCategory(undefined)).toBe('Kraft');
    expect(describeWorkoutCategory('strength')).toBe('Kraft');
  });
});
