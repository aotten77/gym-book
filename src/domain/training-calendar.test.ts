import { describe, expect, it } from 'vitest';
import { deriveProgramWeek } from '@/domain/program';
import type { ProgramWeek, WorkoutTemplate } from '@/domain/models';
import {
  buildTrainingCalendar,
  countWeekProgress,
  isoWeekday,
  normalizeScheduledWeekdays,
  programWeekStart,
  templatesOnWeekday,
  templatesWithoutSchedule,
} from '@/domain/training-calendar';

function template(name: string, scheduledWeekdays?: number[]): WorkoutTemplate {
  return {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    scheduledWeekdays,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

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

describe('templatesOnWeekday / templatesWithoutSchedule', () => {
  const templates = [
    template('Einheit B', [4]),
    template('Einheit A', [1, 4]),
    template('Kraftausdauer'),
    template('Mobilität', []),
  ];

  it('gibt die Workouts eines Tages in Namensreihenfolge', () => {
    expect(templatesOnWeekday(templates, 4).map((entry) => entry.name)).toEqual([
      'Einheit A',
      'Einheit B',
    ]);
    expect(templatesOnWeekday(templates, 3)).toEqual([]);
  });

  it('zählt eine leere Liste wie "kein fester Tag"', () => {
    expect(templatesWithoutSchedule(templates).map((entry) => entry.name)).toEqual([
      'Kraftausdauer',
      'Mobilität',
    ]);
  });
});

describe('buildTrainingCalendar', () => {
  const templates = [template('Einheit A', [1, 4]), template('Mobilität', [6])];
  const startedOn = '2026-08-31'; // Montag

  function build(overrides: Partial<Parameters<typeof buildTrainingCalendar>[0]> = {}) {
    return buildTrainingCalendar({
      weeks: [week(1), week(2), week(3, 'test')],
      templates,
      startedOn,
      effectiveWeek: 2,
      completedSessions: [],
      testDates: [],
      // Mittwoch der zweiten Woche.
      now: new Date(2026, 8, 9, 12),
      ...overrides,
    });
  }

  it('legt jede Woche auf ihren Montag und gibt sieben Tage aus', () => {
    const [first] = build();

    expect(first.days).toHaveLength(7);
    expect(first.start?.getDate()).toBe(31);
    expect(first.end?.getDate()).toBe(6);
    expect(first.days[0].date?.getDate()).toBe(31);
    expect(first.days[6].date?.getDate()).toBe(6);
  });

  it('markiert die wirksame Woche und den heutigen Tag', () => {
    const rows = build();

    expect(rows.map((row) => row.isEffective)).toEqual([false, true, false]);

    const today = rows[1].days.find((day) => day.isToday);

    expect(today?.isoWeekday).toBe(3);
    // Am Mittwoch steht nichts an - "heute" ist trotzdem heute.
    expect(today?.state).toBe('leer');
  });

  it('nennt vergangene geplante Tage ohne Einheit verpasst, künftige geplant', () => {
    const rows = build();

    // Woche 1, Montag: geplant und vorbei.
    expect(rows[0].days[0].state).toBe('verpasst');
    // Woche 2, Donnerstag: geplant und noch vor uns.
    expect(rows[1].days[3].state).toBe('geplant');
    // Mittwoch ist in keiner Woche geplant.
    expect(rows[0].days[2].state).toBe('leer');
  });

  it('färbt abgeschlossene Einheiten erledigt und teilweise erledigte teilweise', () => {
    const rows = build({
      templates: [template('Einheit A', [1]), template('Mobilität', [1])],
      completedSessions: [
        { templateId: 'einheit-a', templateName: 'Einheit A', completedAt: localAt(2026, 8, 31) },
        { templateId: 'einheit-a', templateName: 'Einheit A', completedAt: localAt(2026, 9, 7) },
        { templateId: 'mobilität', templateName: 'Mobilität', completedAt: localAt(2026, 9, 7) },
      ],
    });

    expect(rows[0].days[0].state).toBe('teilweise');
    expect(rows[1].days[0].state).toBe('erledigt');
    expect(countWeekProgress(rows[0])).toEqual({ planned: 2, done: 1 });
    expect(countWeekProgress(rows[1])).toEqual({ planned: 2, done: 2 });
  });

  it('zeigt auch eine Einheit, die an einem ungeplanten Tag lief', () => {
    const rows = build({
      completedSessions: [
        // Dienstag der ersten Woche - dort steht nichts im Plan.
        { templateId: 'einheit-a', templateName: 'Einheit A', completedAt: localAt(2026, 9, 1) },
      ],
    });

    expect(rows[0].days[1].state).toBe('erledigt');
    expect(rows[0].days[1].done.map((entry) => entry.name)).toEqual(['Einheit A']);
    // Der geplante Montag bleibt davon unberührt.
    expect(rows[0].days[0].state).toBe('verpasst');
  });

  it('kennt ohne Startdatum weder Termine noch Zustände', () => {
    const rows = build({
      startedOn: undefined,
      completedSessions: [
        { templateId: 'einheit-a', templateName: 'Einheit A', completedAt: localAt(2026, 8, 31) },
      ],
    });

    expect(rows[0].start).toBeUndefined();
    expect(rows[0].days[0].date).toBeUndefined();
    expect(rows[0].days[0].state).toBe('geplant');
    expect(rows[0].days.some((day) => day.isToday)).toBe(false);
    expect(rows[0].days.flatMap((day) => day.done)).toEqual([]);
  });

  it('meldet den Seitenvergleich nur in der Testwoche und nur mit Messung darin', () => {
    const withoutTest = build();

    expect(withoutTest.map((row) => row.hasTestAppointment)).toEqual([false, false, true]);
    expect(withoutTest[2].testDone).toBe(false);

    // Woche 3 läuft vom 14.09. bis zum 20.09.
    const measuredInside = build({ testDates: [localAt(2026, 9, 20, 23)] });
    const measuredOutside = build({ testDates: [localAt(2026, 9, 21, 1)] });

    expect(measuredInside[2].testDone).toBe(true);
    expect(measuredOutside[2].testDone).toBe(false);
  });

  it('sortiert die Wochen nach ihrer Nummer, egal wie sie hereinkommen', () => {
    const rows = build({ weeks: [week(3), week(1), week(2)] });

    expect(rows.map((row) => row.weekNumber)).toEqual([1, 2, 3]);
  });
});
