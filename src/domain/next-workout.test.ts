import { describe, expect, it } from 'vitest';
import { pickNextTemplate } from '@/domain/next-workout';

const templates = [
  { id: 'a', name: 'Einheit A' },
  { id: 'b', name: 'Einheit B' },
  { id: 'c', name: 'Einheit C' },
];

describe('pickNextTemplate', () => {
  it('picks the workout whose last completion is furthest back', () => {
    const next = pickNextTemplate(templates, {
      a: '2026-08-01T10:00:00.000Z',
      b: '2026-07-20T10:00:00.000Z',
      c: '2026-07-28T10:00:00.000Z',
    });

    expect(next?.id).toBe('b');
  });

  it('prefers a workout that was never trained', () => {
    // Was noch nie dran war, ist am längsten überfällig - auch gegenüber einem
    // Abschluss, der lange zurückliegt.
    const next = pickNextTemplate(templates, {
      a: '2020-01-01T10:00:00.000Z',
      c: '2026-08-01T10:00:00.000Z',
    });

    expect(next?.id).toBe('b');
  });

  it('breaks ties by name so the choice never wobbles', () => {
    const untouched = pickNextTemplate(templates, {});
    expect(untouched?.id).toBe('a');

    const sameDay = pickNextTemplate([...templates].reverse(), {
      a: '2026-08-01T10:00:00.000Z',
      b: '2026-08-01T10:00:00.000Z',
      c: '2026-08-01T10:00:00.000Z',
    });
    expect(sameDay?.id).toBe('a');
  });

  it('returns undefined when there is nothing to pick', () => {
    expect(pickNextTemplate([], {})).toBeUndefined();
  });

  it('leaves the given list untouched', () => {
    const input = [...templates];
    pickNextTemplate(input, { a: '2026-08-01T10:00:00.000Z' });
    expect(input.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('ignores recency entries for workouts that no longer exist', () => {
    const next = pickNextTemplate([{ id: 'a', name: 'Einheit A' }], {
      a: '2026-08-01T10:00:00.000Z',
      gelöscht: '2019-01-01T10:00:00.000Z',
    });

    expect(next?.id).toBe('a');
  });
});
