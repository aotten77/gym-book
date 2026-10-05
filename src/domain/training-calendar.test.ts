import { describe, expect, it } from 'vitest';
import { deriveProgramWeek } from '@/domain/program';
import type { PlanEntry, ProgramWeek } from '@/domain/models';
import { buildPlanLinks } from '@/domain/plan';
import {
  buildTrainingCalendar,
  countWeekProgress,
  isoWeekday,
  normalizeScheduledWeekdays,
  programWeekStart,
} from '@/domain/training-calendar';

function week(weekNumber: number, kind?: ProgramWeek['kind']): ProgramWeek {
  return { id: `w${weekNumber}`, programId: 'p1', weekNumber, kind };
}

/** Ein lokaler Zeitstempel - der Kalender rechnet in Ortszeit, nicht in UTC. */
function localAt(year: number, month: number, day: number, hour = 18): string {
  return new Date(year, month - 1, day, hour).toISOString();
}

describe('isoWeekday', () => {
  it('macht aus dem Sonntag der 7. und aus dem Montag den 1. Tag', () => {
    // 2026-08-31 ist ein Montag, 2026-09-06 ein Sonntag.
    expect(isoWeekday(new Date(2026, 7, 31))).toBe(1);
    expect(isoWeekday(new Date(2026, 8, 6))).toBe(7);
  });
});

describe('normalizeScheduledWeekdays', () => {
  it('sortiert, entdoppelt und wirft Ungültiges weg', () => {
    expect(normalizeScheduledWeekdays([4, 1, 4, 9, 0, -2])).toEqual([1, 4]);
  });

  it('macht aus "nichts übrig" ein undefined - eine Schreibweise für keinen Tag', () => {
    expect(normalizeScheduledWeekdays([])).toBeUndefined();
    expect(normalizeScheduledWeekdays([0, 8])).toBeUndefined();
    expect(normalizeScheduledWeekdays(undefined)).toBeUndefined();
    expect(normalizeScheduledWeekdays(null)).toBeUndefined();
  });
});

describe('programWeekStart', () => {
  it('liefert den Montag der Woche, auch wenn das Startdatum mitten in ihr liegt', () => {
    // Mittwoch, 2026-09-02 -> Woche 1 beginnt am Montag, 2026-08-31.
    const start = programWeekStart('2026-09-02', 1);

    expect(start?.getFullYear()).toBe(2026);
    expect(start?.getMonth()).toBe(7);
    expect(start?.getDate()).toBe(31);
    expect(start?.getHours()).toBe(0);
  });

  it('bleibt über die Zeitumstellung hinweg auf dem Montag', () => {
    // Die Umstellung liegt am 2026-10-25; Woche 9 liegt dahinter.
    const start = programWeekStart('2026-08-31', 9);

    expect(start && isoWeekday(start)).toBe(1);
    expect(start?.getHours()).toBe(0);
    expect(start?.getDate()).toBe(26);
    expect(start?.getMonth()).toBe(9);
  });

  it('ist die Umkehrung von deriveProgramWeek', () => {
    const startedOn = '2026-08-31';

    for (const weekNumber of [1, 2, 5, 9, 12]) {
      const start = programWeekStart(startedOn, weekNumber)!;

      // Mitten in der Woche gefragt, damit nicht nur die Grenze stimmt.
      const midweek = new Date(start.getTime());
      midweek.setDate(midweek.getDate() + 3);

      expect(deriveProgramWeek(startedOn, midweek, 12)).toBe(weekNumber);
    }
  });

  it('gibt ohne brauchbares Datum nichts zurück', () => {
    expect(programWeekStart('kein datum', 1)).toBeUndefined();
    expect(programWeekStart('2026-08-31', 0)).toBeUndefined();
  });
});

function entry(id: string, date: string, kind: 'workout' | 'run' = 'workout', orderInDay = 1): PlanEntry {
  return {
    id,
    date,
    orderInDay,
    kind,
    ...(kind === 'workout' ? { templateId: 'einheit-a' } : { title: 'Dauerlauf' }),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('buildTrainingCalendar', () => {
  const startedOn = '2026-10-05'; // Montag

  function build(
    overrides: Partial<Parameters<typeof buildTrainingCalendar>[0]> = {},
    sessions: Parameters<typeof buildPlanLinks>[0] = [],
    linkedRuns: Parameters<typeof buildPlanLinks>[1] = [],
  ) {
    return buildTrainingCalendar({
      weeks: [week(1), week(2), week(3, 'test')],
      planEntries: [],
      planLinks: buildPlanLinks(sessions, linkedRuns),
      templateNames: { 'einheit-a': 'Einheit A' },
      runs: [],
      startedOn,
      effectiveWeek: 1,
      completedSessions: [],
      testDates: [],
      // Mittwoch der ersten Woche.
      now: new Date(2026, 9, 7, 12),
      ...overrides,
    });
  }

  function completedSession(planEntryId: string, day: number) {
    return {
      id: `s-${planEntryId}`,
      planEntryId,
      status: 'completed' as const,
      completedAt: localAt(2026, 10, day),
      templateNameSnapshot: 'Einheit A',
    };
  }

  function doneRef(day: number) {
    return {
      id: 'einheit-a',
      templateName: 'Einheit A',
      templateId: 'einheit-a',
      completedAt: localAt(2026, 10, day),
    };
  }

  it('legt jede Woche auf ihren Montag und gibt sieben Tage aus', () => {
    const [first] = build();

    expect(first.days).toHaveLength(7);
    expect(first.start?.getDate()).toBe(5);
    expect(first.end?.getDate()).toBe(11);
    expect(first.days[6].date?.getDate()).toBe(11);
  });

  it('markiert die wirksame Woche und den heutigen Tag', () => {
    const rows = build();

    expect(rows.map((row) => row.isEffective)).toEqual([true, false, false]);
    expect(rows[0].days.find((day) => day.isToday)?.isoWeekday).toBe(3);
  });

  it('nennt einen vergangenen offenen Termin verpasst, den Tag ohne Termin leer', () => {
    const rows = build({ planEntries: [entry('e1', '2026-10-05')] });

    expect(rows[0].days[0].state).toBe('verpasst');
    expect(rows[0].days[0].planned.map((unit) => unit.name)).toEqual(['Einheit A']);
    expect(rows[0].days[1].state).toBe('leer');
  });

  it('nennt einen künftigen offenen Termin geplant', () => {
    const rows = build({ planEntries: [entry('e1', '2026-10-09')] });

    expect(rows[0].days[4].state).toBe('geplant');
  });

  it('zeigt einen Lauf ohne Termin als erledigten Tag', () => {
    const rows = build({ runs: [{ id: 'r1', date: '2026-10-06' }] });

    expect(rows[0].days[1].state).toBe('erledigt');
    expect(rows[0].days[1].done[0].kind).toBe('run');
  });

  it('lässt einen Termin, der an anderem Tag erledigt wurde, an seinem Tag leer', () => {
    const rows = build(
      {
        planEntries: [entry('e1', '2026-10-05')],
        completedSessions: [doneRef(6)],
      },
      [completedSession('e1', 6)],
    );

    expect(rows[0].days[0].state).toBe('leer');
    expect(rows[0].days[0].planned).toEqual([]);
    expect(rows[0].days[1].state).toBe('erledigt');
    expect(rows[0].days[1].planned).toEqual([]);
    expect(rows[0].days[1].done).toHaveLength(1);
  });

  it('nennt einen Tag mit zwei Terminen, von denen einer erledigt ist, teilweise', () => {
    const rows = build(
      {
        planEntries: [entry('e1', '2026-10-08'), entry('e2', '2026-10-08', 'run', 2)],
        completedSessions: [doneRef(8)],
      },
      [completedSession('e1', 8)],
    );

    expect(rows[0].days[3].state).toBe('teilweise');
    expect(countWeekProgress(rows[0])).toEqual({ planned: 2, done: 1 });
  });

  it('färbt einen Tag erledigt, wenn alle Termine erledigt sind', () => {
    const rows = build(
      {
        planEntries: [entry('e1', '2026-10-05')],
        completedSessions: [doneRef(5)],
      },
      [completedSession('e1', 5)],
    );

    expect(rows[0].days[0].state).toBe('erledigt');
    expect(countWeekProgress(rows[0])).toEqual({ planned: 1, done: 1 });
  });

  it('kennt ohne Startdatum weder Termine noch Zustände', () => {
    const rows = build({
      startedOn: undefined,
      planEntries: [entry('e1', '2026-10-05')],
      runs: [{ id: 'r1', date: '2026-10-06' }],
    });

    expect(rows[0].start).toBeUndefined();
    expect(rows[0].days.every((day) => day.date === undefined && day.state === 'leer')).toBe(true);
    expect(rows[0].days.some((day) => day.isToday)).toBe(false);
  });

  it('meldet den Seitenvergleich nur in der Testwoche und nur mit Messung darin', () => {
    const withoutTest = build();

    expect(withoutTest.map((row) => row.hasTestAppointment)).toEqual([false, false, true]);

    // Woche 3 läuft vom 19.10. bis zum 25.10.
    const measuredInside = build({ testDates: [localAt(2026, 10, 25, 23)] });
    const measuredOutside = build({ testDates: [localAt(2026, 10, 26, 1)] });

    expect(measuredInside[2].testDone).toBe(true);
    expect(measuredOutside[2].testDone).toBe(false);
  });

  it('sortiert die Wochen nach ihrer Nummer, egal wie sie hereinkommen', () => {
    const rows = build({ weeks: [week(3), week(1), week(2)] });

    expect(rows.map((row) => row.weekNumber)).toEqual([1, 2, 3]);
  });
});
