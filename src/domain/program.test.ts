import { describe, expect, it } from 'vitest';
import { deriveProgramWeek, resolveWeekControl, suggestProgramStart } from '@/domain/program';
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

  it('leitet die Woche aus dem Startdatum ab, sobald es gesetzt ist', () => {
    const started = { ...program, startedOn: '2026-08-10' };

    expect(resolveWeekControl(undefined, started, programWeeks, new Date(2026, 7, 26))).toMatchObject(
      {
        // 10.08. ist ein Montag, der 26.08. liegt in der dritten Woche danach.
        effectiveWeek: 3,
        mode: 'derived',
        derivedWeek: 3,
      },
    );
  });

  it('lässt den Override auch über der abgeleiteten Woche stehen', () => {
    const started = { ...program, startedOn: '2026-08-10' };
    const control = resolveWeekControl(1, started, programWeeks, new Date(2026, 7, 26));

    expect(control.effectiveWeek).toBe(1);
    expect(control.mode).toBe('override');
    // Die Ableitung bleibt sichtbar - sonst ließe sich der Override nicht
    // beurteilen, den man gerade zurücknehmen will.
    expect(control.derivedWeek).toBe(3);
  });
});

describe('deriveProgramWeek', () => {
  it('zählt Kalenderwochen ab dem Montag des Startdatums', () => {
    // Startdatum mitten in der Woche: die angebrochene Woche ist Woche 1.
    expect(deriveProgramWeek('2026-08-12', new Date(2026, 7, 14), 8)).toBe(1);
    expect(deriveProgramWeek('2026-08-12', new Date(2026, 7, 17), 8)).toBe(2);
  });

  it('bleibt in der letzten Programmwoche stehen, statt umzulaufen', () => {
    expect(deriveProgramWeek('2026-01-05', new Date(2026, 7, 26), 8)).toBe(8);
  });

  it('gibt Woche 1 für einen Start in der Zukunft', () => {
    expect(deriveProgramWeek('2026-09-07', new Date(2026, 7, 26), 8)).toBe(1);
  });

  it('überlebt die Zeitumstellung', () => {
    // 22.03.2026 bis 05.04.2026 - dazwischen liegt die Umstellung auf
    // Sommerzeit, die eine Woche auf 167 Stunden verkürzt.
    expect(deriveProgramWeek('2026-03-23', new Date(2026, 3, 6), 12)).toBe(3);
  });

  it('meldet ein unlesbares Datum als unbestimmt', () => {
    expect(deriveProgramWeek('irgendwann', new Date(2026, 7, 26), 8)).toBeUndefined();
  });
});

describe('suggestProgramStart', () => {
  it('schlägt den Montag der Anlegewoche vor', () => {
    expect(suggestProgramStart({ ...program, createdAt: '2026-08-26T10:00:00.000Z' })).toBe(
      '2026-08-24',
    );
  });
});
