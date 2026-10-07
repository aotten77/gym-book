import { describe, expect, it } from 'vitest';
import { deriveProgramWeek } from '@/domain/program';
import type { PlanEntry, ProgramWeek } from '@/domain/models';
import { buildPlanLinks } from '@/domain/plan';
import {
  buildCalendarWeeks,
  cellMarks,
  countWeekProgress,
  defaultFirstMonday,
  describeCalendarUnitDetail,
  describeWeekRange,
  isoWeekday,
  keepSelectionInWindow,
  normalizeScheduledWeekdays,
  programWeekStart,
  shiftWindow,
  type BuildCalendarWeeksInput,
  type CalendarSession,
  type CalendarUnit,
} from '@/domain/training-calendar';

function week(weekNumber: number, kind?: ProgramWeek['kind']): ProgramWeek {
  return { id: `w${weekNumber}`, programId: 'p1', weekNumber, kind };
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

describe('buildCalendarWeeks', () => {
  const today = new Date(2026, 9, 7, 12); // Mittwoch
  const firstMonday = defaultFirstMonday(today);

  function build(
    overrides: Partial<BuildCalendarWeeksInput> = {},
    sessions: Parameters<typeof buildPlanLinks>[0] = [],
    linkedRuns: Parameters<typeof buildPlanLinks>[1] = [],
  ) {
    return buildCalendarWeeks({
      firstMonday,
      weeks: 6,
      today,
      programWeeks: [],
      planEntries: [],
      planLinks: buildPlanLinks(sessions, linkedRuns),
      templates: [{ id: 'einheit-a', name: 'Einheit A' }],
      completedSessions: [],
      runs: [],
      testDates: [],
      ...overrides,
    });
  }

  function session(overrides: Partial<CalendarSession> = {}): CalendarSession {
    return {
      id: 's1',
      templateId: 'einheit-a',
      templateName: 'Einheit A',
      startedAt: new Date(2026, 9, 6, 17).toISOString(),
      completedAt: new Date(2026, 9, 6, 18).toISOString(),
      ...overrides,
    };
  }

  function dayOf(rows: ReturnType<typeof build>, key: string) {
    return rows.flatMap((row) => row.days).find((day) => day.key === key)!;
  }

  it('legt sechs Wochen ab dem Montag der Vorwoche an', () => {
    const rows = build();

    expect(rows).toHaveLength(6);
    expect(rows[0].key).toBe('2026-09-28');
    expect(rows[5].key).toBe('2026-11-02');
    expect(rows[1].isCurrent).toBe(true);
    expect(rows.filter((row) => row.isCurrent)).toHaveLength(1);

    const todays = rows.flatMap((row) => row.days).filter((day) => day.isToday);

    expect(todays.map((day) => day.key)).toEqual(['2026-10-07']);
  });

  it('bleibt über die Zeitumstellung auf Montag 00:00', () => {
    const row = build().find((candidate) => candidate.key === '2026-10-26')!;

    expect(row.start.getHours()).toBe(0);
    expect(isoWeekday(row.start)).toBe(1);
    expect(row.days[6].key).toBe('2026-11-01');
  });

  it('vergangener offener Termin verschwindet, heutiger und künftiger bleiben', () => {
    const rows = build({
      planEntries: [
        entry('mo', '2026-10-05'),
        entry('mi', '2026-10-07'),
        entry('fr', '2026-10-09'),
      ],
    });

    expect(dayOf(rows, '2026-10-05').units).toEqual([]);
    expect(dayOf(rows, '2026-10-05').state).toBe('leer');

    for (const key of ['2026-10-07', '2026-10-09']) {
      const day = dayOf(rows, key);

      expect(day.units).toHaveLength(1);
      expect(day.units[0].state).toBe('geplant');
      expect(day.units[0].ref.type).toBe('entry');
    }
  });

  it('ein erledigter Termin erscheint einmal', () => {
    const done = session({ planEntryId: 'di', completedAt: new Date(2026, 9, 6, 18).toISOString() });
    const rows = build(
      { planEntries: [entry('di', '2026-10-06')], completedSessions: [done] },
      [{ id: 's1', planEntryId: 'di', status: 'completed', completedAt: done.completedAt, templateNameSnapshot: 'Einheit A' }],
    );
    const day = dayOf(rows, '2026-10-06');

    expect(day.units).toHaveLength(1);
    expect(day.units[0].state).toBe('erledigt');
    expect(day.units[0].ref.type).toBe('session');
    expect(day.units[0].planEntryId).toBe('di');
    expect(day.state).toBe('erledigt');
    expect(countWeekProgress(rows[1])).toEqual({ planned: 1, done: 1 });
  });

  it('Lauf am Mittwoch erfüllt den Donnerstags-Termin', () => {
    const rows = build(
      {
        planEntries: [entry('lauf', '2026-10-08', 'run')],
        runs: [
          {
            id: 'r1',
            date: '2026-10-07',
            distanceKm: 8,
            durationSeconds: 2400,
            planEntryId: 'lauf',
          },
        ],
      },
      [],
      [{ id: 'r1', planEntryId: 'lauf', date: '2026-10-07' }],
    );
    const wed = dayOf(rows, '2026-10-07');

    expect(wed.units).toHaveLength(1);
    expect(wed.units[0].kind).toBe('run');
    expect(wed.units[0].state).toBe('erledigt');
    expect(dayOf(rows, '2026-10-08').units).toEqual([]);
    expect(countWeekProgress(rows[1])).toEqual({ planned: 1, done: 1 });
  });

  it('ungeplante Session und ungeplanter Lauf erscheinen ohne planEntryId', () => {
    const rows = build({
      completedSessions: [session()],
      runs: [{ id: 'r1', date: '2026-10-06', distanceKm: 5, durationSeconds: 1500 }],
    });
    const [sessionUnit, runUnit] = dayOf(rows, '2026-10-06').units;

    expect(sessionUnit.planEntryId).toBeUndefined();
    expect(runUnit.planEntryId).toBeUndefined();
    expect(runUnit.name).toBe('Lauf');
    expect(describeCalendarUnitDetail(sessionUnit, {}).endsWith('nicht geplant')).toBe(true);
  });

  it('über Mitternacht abgeschlossen zählt am Tag des Abschlusses', () => {
    const rows = build({
      completedSessions: [
        session({
          startedAt: new Date(2026, 9, 6, 23, 50).toISOString(),
          completedAt: new Date(2026, 9, 7, 0, 20).toISOString(),
        }),
      ],
    });

    expect(dayOf(rows, '2026-10-06').units).toEqual([]);

    const units = dayOf(rows, '2026-10-07').units;

    expect(units).toHaveLength(1);
    expect(units[0].durationSeconds).toBe(1800);
  });

  it('abgebrochene Session lässt den Termin geplant', () => {
    const rows = build({ planEntries: [entry('heute', '2026-10-07')] }, [
      { id: 's1', planEntryId: 'heute', status: 'aborted', completedAt: new Date(2026, 9, 7, 9).toISOString(), templateNameSnapshot: 'Einheit A' },
    ]);
    const units = dayOf(rows, '2026-10-07').units;

    expect(units).toHaveLength(1);
    expect(units[0].state).toBe('geplant');
    expect(units[0].ref.type).toBe('entry');
    expect(units.some((unit) => unit.state === 'erledigt')).toBe(false);
  });

  it('laufende Session führt zur Session', () => {
    const rows = build({ planEntries: [entry('heute', '2026-10-07')] }, [
      { id: 'live', planEntryId: 'heute', status: 'active', templateNameSnapshot: 'Einheit A' },
    ]);
    const [unit] = dayOf(rows, '2026-10-07').units;

    expect(unit.state).toBe('geplant');
    expect(unit.ref).toEqual({ type: 'active-session', sessionId: 'live' });
  });

  it('vergangener Termin mit laufender Session bleibt stehen', () => {
    const rows = build({ planEntries: [entry('mo', '2026-10-05')] }, [
      { id: 'live', planEntryId: 'mo', status: 'active', templateNameSnapshot: 'Einheit A' },
    ]);
    const day = dayOf(rows, '2026-10-05');

    expect(day.units).toHaveLength(1);
    expect(day.units[0].state).toBe('geplant');
    expect(day.units[0].ref).toEqual({ type: 'active-session', sessionId: 'live' });
    expect(day.state).toBe('geplant');
  });

  it('Art einer Einheit', () => {
    const rows = build({
      templates: [
        { id: 'einheit-a', name: 'Einheit A' },
        { id: 'mob', name: 'Mobility', category: 'mobility' },
      ],
      planEntries: [
        { ...entry('m', '2026-10-08'), templateId: 'mob' },
        { ...entry('u', '2026-10-09'), templateId: 'weg' },
        entry('l', '2026-10-10', 'run'),
      ],
      completedSessions: [
        session({ id: 's-mob', templateCategorySnapshot: 'mobility' }),
        session({ id: 's-old', completedAt: new Date(2026, 9, 5, 18).toISOString() }),
      ],
    });

    expect(dayOf(rows, '2026-10-06').units[0].kind).toBe('mobility');
    expect(dayOf(rows, '2026-10-05').units[0].kind).toBe('strength');
    expect(dayOf(rows, '2026-10-08').units[0].kind).toBe('mobility');
    expect(dayOf(rows, '2026-10-09').units[0].kind).toBe('strength');
    expect(dayOf(rows, '2026-10-10').units[0].kind).toBe('run');
  });

  it('Reihenfolge: erledigte vor geplanten, geplante nach orderInDay', () => {
    const rows = build({
      templates: [
        { id: 'einheit-a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      planEntries: [
        { ...entry('eb', '2026-10-07', 'workout', 2), templateId: 'b' },
        entry('ea', '2026-10-07', 'workout', 1),
      ],
      completedSessions: [
        session({
          templateName: 'Session',
          completedAt: new Date(2026, 9, 7, 8).toISOString(),
        }),
      ],
    });

    expect(dayOf(rows, '2026-10-07').units.map((unit) => unit.name)).toEqual(['Session', 'A', 'B']);
  });

  it('Programmwoche nur mit Startdatum und nur innerhalb der Spanne', () => {
    const programWeeks = [week(1), week(2), week(3, 'deload')];
    const rows = build({
      program: { startedOn: '2026-10-05' },
      programWeeks,
      planEntries: [entry('mi', '2026-10-07')],
    });
    const byKey = (key: string) => rows.find((row) => row.key === key)!;

    expect(byKey('2026-09-28').programWeek).toBeUndefined();
    expect(byKey('2026-10-05').programWeek?.number).toBe(1);
    expect(byKey('2026-10-19').programWeek).toMatchObject({ number: 3, kind: 'deload' });
    expect(byKey('2026-10-26').programWeek).toBeUndefined();

    const without = build({ programWeeks, planEntries: [entry('mi', '2026-10-07')] });

    expect(without.every((row) => row.programWeek === undefined)).toBe(true);
    expect(dayOf(without, '2026-10-07').units).toHaveLength(1);
  });

  it('Testtermin nur in der Testwoche und nur mit Messung darin', () => {
    const base = {
      program: { startedOn: '2026-10-05' },
      programWeeks: [week(1), week(2, 'test'), week(3)],
    };
    const rows = build(base);

    expect(rows.filter((row) => row.hasTestAppointment).map((row) => row.key)).toEqual(['2026-10-12']);

    const inside = build({ ...base, testDates: [new Date(2026, 9, 18, 23).toISOString()] });
    const outside = build({ ...base, testDates: [new Date(2026, 9, 19, 1).toISOString()] });

    expect(inside.find((row) => row.key === '2026-10-12')!.testDone).toBe(true);
    expect(outside.find((row) => row.key === '2026-10-12')!.testDone).toBe(false);
  });
});

describe('cellMarks', () => {
  const unit = (name: string): CalendarUnit => ({
    kind: 'strength',
    state: 'geplant',
    name,
    ref: { type: 'session', sessionId: name },
  });

  it('zeigt bis zwei Einheiten einzeln und ab drei eine und "mehr"', () => {
    expect(cellMarks([])).toEqual([]);
    expect(cellMarks([unit('a')])).toEqual([{ type: 'unit', unit: unit('a') }]);
    expect(cellMarks([unit('a'), unit('b')]).map((mark) => mark.type)).toEqual(['unit', 'unit']);
    expect(cellMarks([unit('a'), unit('b'), unit('c')])).toEqual([
      { type: 'unit', unit: unit('a') },
      { type: 'more', count: 2 },
    ]);
  });
});

describe('Fenster', () => {
  it('defaultFirstMonday ist der Montag der Vorwoche', () => {
    expect(toKey(defaultFirstMonday(new Date(2026, 9, 7, 12)))).toBe('2026-09-28');
    expect(toKey(defaultFirstMonday(new Date(2026, 9, 5, 0, 30)))).toBe('2026-09-28');
  });

  it('shiftWindow rechnet über setDate und bleibt über die Zeitumstellung auf 00:00', () => {
    const forward = shiftWindow(new Date(2026, 9, 19), 4);

    expect(toKey(forward)).toBe('2026-11-16');
    expect(forward.getHours()).toBe(0);
    expect(toKey(shiftWindow(new Date(2026, 10, 16), -4))).toBe('2026-10-19');
  });

  it('keepSelectionInWindow behält die Auswahl im Fenster, sonst der erste Montag', () => {
    expect(keepSelectionInWindow('2026-10-05', new Date(2026, 8, 28), 6)).toBe('2026-10-05');
    expect(keepSelectionInWindow('2026-10-05', new Date(2026, 9, 26), 6)).toBe('2026-10-26');
    expect(keepSelectionInWindow('2026-11-30', new Date(2026, 9, 26), 6)).toBe('2026-11-30');
  });
});

function toKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

describe('describeWeekRange', () => {
  it('kürzt im selben Monat und schreibt bei Monats- und Jahreswechsel beide Seiten', () => {
    expect(describeWeekRange(new Date(2026, 9, 5), new Date(2026, 9, 11))).toBe('05.–11.10.');
    expect(describeWeekRange(new Date(2026, 8, 28), new Date(2026, 9, 4))).toBe('28.09.–04.10.');
    expect(describeWeekRange(new Date(2026, 11, 28), new Date(2027, 0, 3))).toBe('28.12.–03.01.');
  });
});

describe('describeCalendarUnitDetail', () => {
  const done = (overrides: Partial<CalendarUnit>): CalendarUnit => ({
    kind: 'strength',
    state: 'erledigt',
    name: 'x',
    ref: { type: 'session', sessionId: 's' },
    planEntryId: 'p',
    ...overrides,
  });

  it('erledigt: Kraft mit Volumen und Dauer, Mobility nur Dauer, Lauf mit Pace', () => {
    expect(describeCalendarUnitDetail(done({ durationSeconds: 3120 }), { volumeKg: 4210.4 })).toBe(
      '4.210 kg · 0:52 h',
    );
    expect(describeCalendarUnitDetail(done({ kind: 'mobility', durationSeconds: 1200 }), {})).toBe('0:20 h');
    expect(
      describeCalendarUnitDetail(
        done({ kind: 'run', ref: { type: 'run', runId: 'r' }, distanceKm: 7, durationSeconds: 2520 }),
        {},
      ),
    ).toBe('7 km · 42:00 · 6:00 /km');
  });

  it('geplant: Workout mit Art und Übungszahl, Lauf mit Vorgaben oder Notiz', () => {
    const planned = (kind: CalendarUnit['kind'], e: PlanEntry): CalendarUnit => ({
      kind,
      state: 'geplant',
      name: 'x',
      ref: { type: 'entry', entry: e },
      planEntryId: e.id,
    });

    expect(describeCalendarUnitDetail(planned('mobility', entry('m', '2026-10-08')), { exerciseCount: 1 })).toBe(
      'Mobility · 1 Übung',
    );
    expect(describeCalendarUnitDetail(planned('strength', entry('k', '2026-10-08')), { exerciseCount: 5 })).toBe(
      'Kraft · 5 Übungen',
    );
    expect(
      describeCalendarUnitDetail(planned('run', { ...entry('l', '2026-10-08', 'run'), notes: 'locker' }), {}),
    ).toBe('locker');
    expect(describeCalendarUnitDetail(planned('run', entry('l2', '2026-10-08', 'run')), {})).toBe('');
  });

  it('laufende Session heißt "Läuft gerade"', () => {
    expect(
      describeCalendarUnitDetail(
        { kind: 'strength', state: 'geplant', name: 'x', ref: { type: 'active-session', sessionId: 's' }, planEntryId: 'p' },
        {},
      ),
    ).toBe('Läuft gerade');
  });
});
