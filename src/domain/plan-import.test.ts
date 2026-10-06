import { describe, expect, it } from 'vitest';

import {
  parseLibraryImportPayload,
  planLibraryImport,
  type LibraryImportState,
} from '@/domain/library-import';
import type { PlanEntry, WorkoutTemplate } from '@/domain/models';
import {
  importPlanEntrySchema,
  orderPlanDay,
  planPlanEntries,
  type ImportPlanEntryInput,
  type PlanEntryPlanEntry,
} from '@/domain/plan-import';

const STAMP = '2026-01-01T00:00:00.000Z';

function buildEntry(overrides: Partial<PlanEntry> & { id: string; date: string }): PlanEntry {
  return {
    orderInDay: 1,
    kind: 'workout',
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

function buildTemplate(id: string, name: string): WorkoutTemplate {
  return { id, name, createdAt: STAMP, updatedAt: STAMP };
}

function parseEntries(entries: unknown[]): ImportPlanEntryInput[] {
  return entries.map((entry) => importPlanEntrySchema.parse(entry));
}

function plan(input: {
  entries: unknown[];
  existing?: PlanEntry[];
  takenIds?: string[];
  range?: { from: string; to: string };
  templates?: Record<string, string>;
}) {
  const problems: string[] = [];
  const templates = input.templates ?? { 'einheit a': 'tA', 'einheit b': 'tB' };
  const result = planPlanEntries({
    range: input.range,
    entries: parseEntries(input.entries),
    existing: input.existing ?? [],
    takenIds: new Set(input.takenIds ?? []),
    templateIdByKey: new Map(Object.entries(templates)),
    templateNames: { tA: 'Einheit A', tB: 'Einheit B' },
    problems,
  });

  return { entries: result, problems };
}

/** Wendet einen Plan wie `applyLibraryImport` auf einen Bestand an - ohne Datenbank. */
function applyPlan(
  existing: PlanEntry[],
  entries: PlanEntryPlanEntry[],
  takenIds: ReadonlySet<string> = new Set(),
): PlanEntry[] {
  const removed = new Set(entries.filter((e) => e.kind === 'removed').map((e) => e.id));
  const byId = new Map(existing.filter((e) => !removed.has(e.id)).map((e) => [e.id, e]));

  for (const entry of entries) {
    if (entry.kind === 'removed' || entry.taken || !entry.values) {
      continue;
    }

    const values = entry.values;
    const record: PlanEntry = {
      id: entry.id,
      date: values.date,
      kind: values.kind,
      orderInDay: entry.orderInDay,
      createdAt: STAMP,
      updatedAt: STAMP,
      ...(values.templateId ? { templateId: values.templateId } : {}),
      ...(values.title ? { title: values.title } : {}),
      ...(values.targetDistanceKm !== null ? { targetDistanceKm: values.targetDistanceKm } : {}),
      ...(values.targetPaceSecondsPerKm !== null
        ? { targetPaceSecondsPerKm: values.targetPaceSecondsPerKm }
        : {}),
      ...(values.instructions ? { instructions: values.instructions } : {}),
      ...(values.notes ? { notes: values.notes } : {}),
    };

    byId.set(entry.id, record);
  }

  const days = new Set([...byId.values()].map((e) => e.date));

  for (const day of days) {
    // Wie `applyLibraryImport`: die Zielreihenfolge kommt aus dem Bestand *vor* dem Schreiben.
    const ordered = orderPlanDay(day, existing, entries, takenIds);

    ordered.forEach((id, index) => {
      const item = byId.get(id);

      if (item) {
        byId.set(id, { ...item, orderInDay: index + 1 });
      }
    });
  }

  return [...byId.values()];
}

const FILE = [
  { date: '2026-10-05', workout: 'Einheit A' },
  {
    date: '2026-10-06',
    run: {
      title: 'Intervalle 6×400',
      targetDistanceKm: 7,
      targetPaceSecondsPerKm: 300,
      instructions: '- 2 km einlaufen\n- 6×400 m, 90 s Trabpause',
    },
    notes: 'Bahn',
  },
];

describe('planPlanEntries', () => {
  it('legt neue Termine an, mit Datum und Namen im Label', () => {
    const { entries, problems } = plan({ entries: FILE });

    expect(problems).toEqual([]);
    expect(entries.map((entry) => entry.kind)).toEqual(['new', 'new']);
    expect(entries[0].values?.templateId).toBe('tA');
    expect(entries[0].label).toContain('Einheit A');
    expect(entries[1].label).toContain('Intervalle 6×400');
    expect(entries[1].label).toContain('06.10.');
    expect(entries[1].values).toMatchObject({
      kind: 'run',
      title: 'Intervalle 6×400',
      targetDistanceKm: 7,
      targetPaceSecondsPerKm: 300,
      notes: 'Bahn',
    });
    expect(entries.every((entry) => entry.orderInDay === 1)).toBe(true);
  });

  it('aktualisiert einen bestehenden Termin und nennt die Änderung', () => {
    const existing = [
      buildEntry({
        id: 'r1',
        date: '2026-10-06',
        kind: 'run',
        title: 'Intervalle 6×400',
        targetDistanceKm: 7,
        targetPaceSecondsPerKm: 300,
        instructions: '- 2 km einlaufen\n- 6×400 m, 90 s Trabpause',
        notes: 'Bahn',
      }),
    ];
    const { entries } = plan({
      entries: [
        {
          date: '2026-10-06',
          run: { title: 'Intervalle 6×400', targetDistanceKm: 8 },
        },
      ],
      existing,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: 'r1', kind: 'update', taken: false });
    expect(entries[0].changes).toEqual([{ field: 'Strecke (km)', from: '7', to: '8' }]);
    // Fehlende Schlüssel lassen stehen.
    expect(entries[0].values).toMatchObject({
      targetDistanceKm: 8,
      targetPaceSecondsPerKm: 300,
      notes: 'Bahn',
    });
  });

  it('leert ein Feld mit null', () => {
    const existing = [buildEntry({ id: 'a1', date: '2026-10-05', templateId: 'tA', notes: 'früh' })];
    const { entries } = plan({
      entries: [{ date: '2026-10-05', workout: 'Einheit A', notes: null }],
      existing,
    });

    expect(entries[0].kind).toBe('update');
    expect(entries[0].values?.notes).toBeNull();
    expect(entries[0].changes).toEqual([{ field: 'Notiz', from: 'früh', to: '—' }]);
  });

  it('bleibt unverändert, wenn dieselbe Datei zweimal läuft', () => {
    const first = plan({ entries: FILE, range: { from: '2026-10-05', to: '2026-10-11' } });
    const state = applyPlan([], first.entries);
    const second = plan({
      entries: FILE,
      existing: state,
      range: { from: '2026-10-05', to: '2026-10-11' },
    });

    expect(second.problems).toEqual([]);
    expect(second.entries.map((entry) => entry.kind)).toEqual(['unchanged', 'unchanged']);
  });

  it('setzt die Dateireihenfolge am Tag hinter die nicht genannten Termine', () => {
    const existing = [
      buildEntry({ id: 'x', date: '2026-10-05', kind: 'run', title: 'Locker', orderInDay: 1 }),
      buildEntry({ id: 'b', date: '2026-10-05', templateId: 'tB', orderInDay: 2 }),
    ];
    const { entries } = plan({
      entries: [
        { date: '2026-10-05', workout: 'Einheit A' },
        { date: '2026-10-05', workout: 'Einheit B' },
      ],
      existing,
    });

    const state = applyPlan(existing, entries);
    const day = [...state].sort((left, right) => left.orderInDay - right.orderInDay);

    expect(day.map((entry) => entry.title ?? entry.templateId)).toEqual(['Locker', 'tA', 'tB']);
    // B rückt hinter A - das ist eine Änderung der Position.
    expect(entries[1]).toMatchObject({ id: 'b', kind: 'update' });
    expect(entries[1].changes).toEqual([{ field: 'Position', from: '2', to: '3' }]);

    const second = plan({
      entries: [
        { date: '2026-10-05', workout: 'Einheit A' },
        { date: '2026-10-05', workout: 'Einheit B' },
      ],
      existing: state,
    });

    expect(second.entries.map((entry) => entry.kind)).toEqual(['unchanged', 'unchanged']);
  });

  /*
   * Die realistischste Wiederholung: dieselbe Wochendatei, nachdem am Montag
   * trainiert wurde. Der erledigte Termin darf weder wandern noch einen
   * offenen Termin des Tages verschieben.
   */
  it('lässt einen erledigten Termin beim zweiten Lauf an seinem Platz', () => {
    const file = [
      { date: '2026-10-05', run: { title: 'Lauf' } },
      { date: '2026-10-05', workout: 'Einheit A' },
    ];
    const first = plan({ entries: file });
    const afterFirst = applyPlan([], first.entries);
    const done = afterFirst.find((entry) => entry.templateId === 'tA');

    expect(done?.orderInDay).toBe(2);

    const second = plan({ entries: file, existing: afterFirst, takenIds: [done?.id ?? ''] });

    expect(second.problems).toEqual([]);
    expect(second.entries.map((entry) => [entry.kind, entry.changes])).toEqual([
      ['unchanged', []],
      ['unchanged', []],
    ]);
    expect(second.entries[1]).toMatchObject({ id: done?.id, taken: true, orderInDay: 2 });

    const afterSecond = applyPlan(afterFirst, second.entries, new Set([done?.id ?? '']));

    expect(afterSecond.find((entry) => entry.id === done?.id)?.orderInDay).toBe(2);
    expect(afterSecond.find((entry) => entry.title === 'Lauf')?.orderInDay).toBe(1);
  });

  it('hält belegte Termine an ihrem Platz, auch gegen die Dateireihenfolge', () => {
    const existing = [
      buildEntry({ id: 'done', date: '2026-10-05', templateId: 'tA', orderInDay: 1 }),
      buildEntry({ id: 'run', date: '2026-10-05', kind: 'run', title: 'Lauf', orderInDay: 2 }),
    ];
    const { entries } = plan({
      entries: [
        { date: '2026-10-05', run: { title: 'Lauf' } },
        { date: '2026-10-05', workout: 'Einheit A' },
        { date: '2026-10-05', workout: 'Einheit B' },
      ],
      existing,
      takenIds: ['done'],
    });

    expect(entries.map((entry) => [entry.id === 'done' || entry.id === 'run' ? entry.id : 'neu', entry.kind, entry.orderInDay])).toEqual([
      ['run', 'unchanged', 2],
      ['done', 'unchanged', 1],
      ['neu', 'new', 3],
    ]);
  });

  it('verschiebt einen nicht genannten belegten Termin nicht', () => {
    const existing = [
      buildEntry({ id: 'run', date: '2026-10-05', kind: 'run', title: 'Lauf', orderInDay: 1 }),
      buildEntry({ id: 'done', date: '2026-10-05', templateId: 'tA', orderInDay: 2 }),
    ];
    const { entries } = plan({
      entries: [
        { date: '2026-10-05', run: { title: 'Lauf' } },
        { date: '2026-10-05', workout: 'Einheit B' },
      ],
      existing,
      takenIds: ['done'],
    });
    const after = applyPlan(existing, entries, new Set(['done']));

    expect(entries[0]).toMatchObject({ id: 'run', kind: 'unchanged' });
    expect(
      [...after].sort((left, right) => left.orderInDay - right.orderInDay).map((entry) => entry.id === 'run' || entry.id === 'done' ? entry.id : 'neu'),
    ).toEqual(['run', 'done', 'neu']);
  });

  it('entfernt mit planRange offene fehlende Termine, belässt belegte und die außerhalb', () => {
    const existing = [
      buildEntry({ id: 'open', date: '2026-10-07', templateId: 'tB' }),
      buildEntry({ id: 'taken', date: '2026-10-08', templateId: 'tB' }),
      buildEntry({ id: 'outside', date: '2026-10-20', templateId: 'tB' }),
      buildEntry({ id: 'before', date: '2026-10-04', templateId: 'tB' }),
    ];
    const { entries, problems } = plan({
      entries: FILE,
      existing,
      takenIds: ['taken'],
      range: { from: '2026-10-05', to: '2026-10-11' },
    });

    expect(problems).toEqual([]);
    expect(entries.find((entry) => entry.id === 'open')?.kind).toBe('removed');
    expect(entries.find((entry) => entry.id === 'taken')).toMatchObject({
      kind: 'unchanged',
      taken: true,
    });
    expect(entries.find((entry) => entry.id === 'open')?.label).toContain('Einheit B');
    expect(entries.some((entry) => entry.id === 'outside')).toBe(false);
    expect(entries.some((entry) => entry.id === 'before')).toBe(false);
  });

  it('entfernt ohne planRange nichts', () => {
    const existing = [buildEntry({ id: 'open', date: '2026-10-07', templateId: 'tB' })];
    const { entries } = plan({ entries: FILE, existing });

    expect(entries.some((entry) => entry.kind === 'removed')).toBe(false);
  });

  it('ändert einen belegten Termin nicht, auch wenn die Datei andere Werte nennt', () => {
    const existing = [
      buildEntry({
        id: 'r1',
        date: '2026-10-06',
        kind: 'run',
        title: 'Intervalle 6×400',
        targetDistanceKm: 7,
      }),
    ];
    const { entries } = plan({
      entries: [{ date: '2026-10-06', run: { title: 'Intervalle 6×400', targetDistanceKm: 9 } }],
      existing,
      takenIds: ['r1'],
    });

    expect(entries[0]).toMatchObject({ id: 'r1', kind: 'unchanged', taken: true, changes: [] });
  });

  it('akzeptiert ein Workout, das dieselbe Datei anlegt', () => {
    const payload = parseLibraryImportPayload(
      JSON.stringify({
        schemaVersion: 1,
        templates: [{ name: 'Einheit C' }],
        planEntries: [{ date: '2026-10-05', workout: 'einheit c' }],
      }),
    );
    const result = planLibraryImport(payload, {
      exercises: [],
      templates: [buildTemplate('tA', 'Einheit A')],
      templateExercises: [],
      bandLevels: [],
      progressionRules: [],
      planEntries: [],
      takenPlanEntryIds: new Set(),
    });

    expect(result.planEntries).toHaveLength(1);
    expect(result.planEntries[0].values?.templateId).toBe(result.templates[0].id);
    expect(result.summary.createdPlanEntries).toBe(1);
  });

  describe('bricht mit benannter Zeile ab', () => {
    it('bei einem unbekannten Workout', () => {
      const { problems } = plan({ entries: [{ date: '2026-10-05', workout: 'Einheit Z' }] });

      expect(problems).toEqual([
        'Termin 1: Workout "Einheit Z" gibt es nicht und es wird auch in dieser Datei nicht angelegt.',
      ]);
    });

    it('bei einem ungültigen Datum', () => {
      const { problems } = plan({ entries: [{ date: '2026-02-30', workout: 'Einheit A' }] });

      expect(problems).toEqual(['Termin 1: "2026-02-30" ist kein gültiges Datum (JJJJ-MM-TT).']);
    });

    it('bei einem doppelten Schlüssel', () => {
      const { problems } = plan({
        entries: [
          { date: '2026-10-06', run: { title: 'Intervalle' } },
          { date: '2026-10-06', run: { title: ' intervalle ' } },
        ],
      });

      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(/^Termin 2: "intervalle" steht am .*06\.10\. mehrfach in dieser Datei\.$/);
    });

    it('bei einem Termin außerhalb von planRange', () => {
      const { problems } = plan({
        entries: [{ date: '2026-10-12', workout: 'Einheit A' }],
        range: { from: '2026-10-05', to: '2026-10-11' },
      });

      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(/^Termin 1: .*12\.10\. liegt außerhalb von planRange/);
    });

    it('wenn from nach to liegt', () => {
      const { problems } = plan({
        entries: [{ date: '2026-10-05', workout: 'Einheit A' }],
        range: { from: '2026-10-11', to: '2026-10-05' },
      });

      expect(problems).toEqual(['planRange: "from" (2026-10-11) liegt nach "to" (2026-10-05).']);
    });

    it('bei weder workout noch run', () => {
      const { problems } = plan({ entries: [{ date: '2026-10-05' }] });

      expect(problems).toEqual(['Termin 1: braucht genau eines von "workout" oder "run".']);
    });

    it('bei workout und run zugleich', () => {
      const { problems } = plan({
        entries: [{ date: '2026-10-05', workout: 'Einheit A', run: { title: 'Locker' } }],
      });

      expect(problems).toEqual(['Termin 1: braucht genau eines von "workout" oder "run".']);
    });

    it('bei planRange ohne planEntries', () => {
      const { problems } = plan({ entries: [], range: { from: '2026-10-05', to: '2026-10-11' } });

      expect(problems).toEqual([
        'planRange braucht "planEntries" – ohne sie würde der Import alle offenen Termine im Zeitraum entfernen.',
      ]);
    });

    it('bei einer ungültigen Vorgabe', () => {
      const { problems } = plan({
        entries: [{ date: '2026-10-06', run: { title: 'Locker', targetDistanceKm: 0 } }],
      });

      expect(problems).toEqual(['Termin 1: Strecke bitte über 0 km.']);
    });
  });
});

describe('planLibraryImport mit Terminen', () => {
  it('bricht über den Gesamtplan ab und zählt Termine im Summary', () => {
    const payload = parseLibraryImportPayload(
      JSON.stringify({
        schemaVersion: 1,
        planRange: { from: '2026-10-05', to: '2026-10-11' },
        planEntries: FILE,
      }),
    );
    const state: LibraryImportState = {
      exercises: [],
      templates: [buildTemplate('tA', 'Einheit A'), buildTemplate('tB', 'Einheit B')],
      templateExercises: [],
      bandLevels: [],
      progressionRules: [],
      planEntries: [buildEntry({ id: 'open', date: '2026-10-07', templateId: 'tB' })],
      takenPlanEntryIds: new Set<string>(),
    };
    const result = planLibraryImport(payload, state);

    expect(result.summary).toMatchObject({
      createdPlanEntries: 2,
      updatedPlanEntries: 0,
      removedPlanEntries: 1,
    });

    expect(() =>
      planLibraryImport(
        parseLibraryImportPayload(
          JSON.stringify({ schemaVersion: 1, planEntries: [{ date: '2026-10-05', workout: 'Z' }] }),
        ),
        state,
      ),
    ).toThrow('Termin 1');
  });

  it('lässt den Hash einer Datei ohne Termine unverändert', () => {
    const payload = parseLibraryImportPayload(JSON.stringify({ schemaVersion: 1 }));

    expect('planEntries' in payload).toBe(false);
  });
});
