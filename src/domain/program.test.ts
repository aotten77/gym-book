import { describe, expect, it } from 'vitest';
import { resolveWeekControl } from '@/domain/program';
import type { Program, ProgramWeek } from '@/domain/models';

const program: Program = {
  id: 'program-1',
  name: 'Hypertrophie',
  activeWeek: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const programWeeks: ProgramWeek[] = [
  { id: 'week-1', programId: program.id, weekNumber: 1 },
  { id: 'week-2', programId: program.id, weekNumber: 2 },
  { id: 'week-3', programId: program.id, weekNumber: 3 },
];

describe('resolveWeekControl', () => {
  it('falls back to the program week when no override is set', () => {
    expect(resolveWeekControl(undefined, program, programWeeks)).toEqual({
      effectiveWeek: 2,
      maxWeek: 3,
      mode: 'program',
    });
  });

  it('prefers the override over the program week', () => {
    expect(resolveWeekControl(1, program, programWeeks)).toEqual({
      effectiveWeek: 1,
      maxWeek: 3,
      mode: 'override',
    });
  });

  it('extends maxWeek when the override is above the highest program week', () => {
    expect(resolveWeekControl(5, program, programWeeks)).toEqual({
      effectiveWeek: 5,
      maxWeek: 5,
      mode: 'override',
    });
  });

  it('reports no program without an active program', () => {
    expect(resolveWeekControl(undefined, undefined, [])).toEqual({
      effectiveWeek: 1,
      maxWeek: 1,
      mode: 'none',
    });
  });
});
