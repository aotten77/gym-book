import { describe, expect, it } from 'vitest';
import {
  buildAnalysisExport,
  buildAnalysisPasteText,
  type AnalysisExportInput,
} from '@/domain/analysis-export';
import type {
  ExerciseTest,
  Side,
  TrackingMode,
  WorkoutSession,
  WorkoutSessionExercise,
  WorkoutSetLog,
} from '@/domain/models';
import type { WeekControl } from '@/domain/program';

const weekControl: WeekControl = { effectiveWeek: 1, maxWeek: 4, mode: 'derived', derivedWeek: 1 };

function session(overrides: Partial<WorkoutSession> & { id: string }): WorkoutSession {
  return {
    templateId: 'template-a',
    templateNameSnapshot: 'Einheit A',
    resolvedProgramWeek: 1,
    startedAt: '2026-08-25T17:00:00.000Z',
    completedAt: '2026-08-25T18:00:00.000Z',
    status: 'completed',
    ...overrides,
  };
}

function sessionExercise(
  overrides: Partial<WorkoutSessionExercise> & { id: string; sessionId: string },
): WorkoutSessionExercise {
  return {
    exerciseId: 'exercise-1',
    exerciseNameSnapshot: 'Front Squat LH',
    trackingMode: 'reps_weight' as TrackingMode,
    unilateral: false,
    orderIndex: 1,
    wasSkipped: false,
    addedInSession: false,
    workSetCount: 3,
    ...overrides,
  };
}

function setLog(
  overrides: Partial<WorkoutSetLog> & { id: string; sessionExerciseId: string },
): WorkoutSetLog {
  return {
    setKind: 'work',
    side: 'both' as Side,
    setNumber: 1,
    completed: true,
    ...overrides,
  };
}

function exerciseTest(overrides: Partial<ExerciseTest> & { id: string }): ExerciseTest {
  return {
    exerciseId: 'exercise-9',
    exerciseNameSnapshot: 'Hüft-Innenrotation (Grad)',
    recordedAt: '2026-08-25T09:00:00',
    leftValue: 10,
    rightValue: 12,
    asymmetryPercent: 16.7,
    ...overrides,
  };
}

function build(input: Partial<AnalysisExportInput>) {
  return buildAnalysisExport({
    exportedAt: new Date('2026-08-26T09:00:00'),
    sessions: [],
    sessionExercises: [],
    setLogs: [],
    bandLevels: [],
    tests: [],
    weekControl,
    ...input,
  });
}

function parseCsv(csv: string) {
  const [header, ...rows] = csv.trimEnd().split('\n');

  return {
    columns: header.split(','),
    rows: rows.map((row) => row.split(',')),
  };
}

describe('buildAnalysisExport', () => {
  it('schreibt eine Zeile je Session, Übung und Seite', () => {
    const files = build({
      sessions: [session({ id: 's1' })],
      sessionExercises: [
        sessionExercise({ id: 'e1', sessionId: 's1', orderIndex: 4 }),
        sessionExercise({
          id: 'e2',
          sessionId: 's1',
          orderIndex: 11,
          exerciseId: 'exercise-2',
          exerciseNameSnapshot: 'Step-Downs vom Kasten',
          unilateral: true,
        }),
      ],
      setLogs: [
        setLog({ id: 'l1', sessionExerciseId: 'e1', weight: 40, reps: 6 }),
        setLog({ id: 'l2', sessionExerciseId: 'e1', setNumber: 2, weight: 40, reps: 6 }),
        setLog({ id: 'l3', sessionExerciseId: 'e2', side: 'left', reps: 8 }),
        setLog({ id: 'l4', sessionExerciseId: 'e2', side: 'right', reps: 7 }),
      ],
    });
    const { columns, rows } = parseCsv(files.sessionsCsv);

    expect(columns.slice(0, 7)).toEqual([
      'datum',
      'wochentag',
      'einheit',
      'pos',
      'uebung',
      'seite',
      'arbeitssaetze',
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[0].slice(0, 6)).toEqual(['2026-08-25', 'Di', 'Einheit A', '4', 'Front Squat LH', 'beide']);
    expect(rows[1][5]).toBe('links');
    expect(rows[2][5]).toBe('rechts');
  });

  it('nimmt den schwersten Satz und summiert das Volumen über die Arbeitssätze', () => {
    const files = build({
      sessions: [session({ id: 's1' })],
      sessionExercises: [sessionExercise({ id: 'e1', sessionId: 's1' })],
      setLogs: [
        setLog({ id: 'w', sessionExerciseId: 'e1', setKind: 'warmup', setNumber: 0, weight: 20, reps: 10 }),
        setLog({ id: 'l1', sessionExerciseId: 'e1', weight: 30, reps: 10 }),
        setLog({ id: 'l2', sessionExerciseId: 'e1', setNumber: 2, weight: 40, reps: 6 }),
        setLog({ id: 'l3', sessionExerciseId: 'e1', setNumber: 3, weight: 40, reps: 5 }),
      ],
    });
    const { columns, rows } = parseCsv(files.sessionsCsv);
    const cell = (name: string) => rows[0][columns.indexOf(name)];

    // Der Aufwärmsatz zählt nicht als Arbeitssatz und nicht ins Volumen.
    expect(cell('arbeitssaetze')).toBe('3');
    expect(cell('aufwaermsaetze')).toBe('1');
    expect(cell('top_gewicht')).toBe('40');
    expect(cell('top_wdh')).toBe('6');
    expect(cell('volumen')).toBe(`${300 + 240 + 200}`);
  });

  it('lässt Sessions ohne abgeschlossenen Arbeitssatz fallen und begründet das', () => {
    const files = build({
      sessions: [
        session({ id: 's1', startedAt: '2026-08-02T21:39:00', completedAt: '2026-08-02T21:39:30', status: 'aborted' }),
        session({ id: 's2' }),
      ],
      sessionExercises: [
        sessionExercise({ id: 'e1', sessionId: 's1' }),
        sessionExercise({ id: 'e2', sessionId: 's2' }),
      ],
      setLogs: [
        setLog({ id: 'l1', sessionExerciseId: 'e1', completed: false, weight: 40, reps: 6 }),
        setLog({ id: 'l2', sessionExerciseId: 'e2', weight: 40, reps: 6 }),
      ],
    });
    const meta = JSON.parse(files.metaJson);

    expect(meta.sessions).toEqual({ gesamt: 2, exportiert: 1, verworfen: 1 });
    expect(meta.verworfeneSessions).toEqual([
      { datum: '2026-08-02T21:39', einheit: 'Einheit A', grund: 'keine abgeschlossenen Sätze' },
    ]);
    expect(parseCsv(files.sessionsCsv).rows).toHaveLength(1);
  });

  it('verwirft eine laufende Session, auch wenn sie schon Sätze hat', () => {
    const files = build({
      sessions: [session({ id: 's1', status: 'active', completedAt: undefined })],
      sessionExercises: [sessionExercise({ id: 'e1', sessionId: 's1' })],
      setLogs: [setLog({ id: 'l1', sessionExerciseId: 'e1', weight: 40, reps: 6 })],
    });
    const meta = JSON.parse(files.metaJson);

    expect(meta.verworfeneSessions[0].grund).toBe('läuft noch');
    expect(parseCsv(files.sessionsCsv).rows).toHaveLength(0);
  });

  it('markiert eine Session unter 20 % der geplanten Sätze als unvollständig', () => {
    const planned = Array.from({ length: 9 }, (_, index) =>
      setLog({
        id: `l${index}`,
        sessionExerciseId: 'e1',
        setNumber: index + 1,
        completed: index === 0,
        weight: 40,
        reps: 6,
      }),
    );
    const files = build({
      sessions: [session({ id: 's1' })],
      sessionExercises: [sessionExercise({ id: 'e1', sessionId: 's1', workSetCount: 9 })],
      setLogs: planned,
    });
    const { columns, rows } = parseCsv(files.sessionsCsv);

    expect(rows[0][columns.indexOf('unvollstaendig')]).toBe('ja');
  });

  it('zählt übersprungene Übungen nicht in die geplanten Sätze', () => {
    const files = build({
      sessions: [session({ id: 's1' })],
      sessionExercises: [
        sessionExercise({ id: 'e1', sessionId: 's1' }),
        sessionExercise({
          id: 'e2',
          sessionId: 's1',
          orderIndex: 2,
          exerciseNameSnapshot: 'Hip Thrust',
          wasSkipped: true,
          workSetCount: 20,
        }),
      ],
      setLogs: [
        setLog({ id: 'l1', sessionExerciseId: 'e1', weight: 40, reps: 6 }),
        ...Array.from({ length: 20 }, (_, index) =>
          setLog({
            id: `s${index}`,
            sessionExerciseId: 'e2',
            setNumber: index + 1,
            completed: false,
          }),
        ),
      ],
    });
    const { columns, rows } = parseCsv(files.sessionsCsv);

    expect(rows).toHaveLength(2);
    expect(rows[0][columns.indexOf('unvollstaendig')]).toBe('nein');
    // Die übersprungene Übung bekommt trotzdem ihre Zeile - das ist eine
    // Aussage über den Plan, kein fehlender Messwert.
    expect(rows[1][columns.indexOf('uebersprungen')]).toBe('ja');
    expect(rows[1][columns.indexOf('arbeitssaetze')]).toBe('0');
  });

  it('lässt Übungen weg, die weder ausgeführt noch übersprungen wurden', () => {
    const files = build({
      sessions: [session({ id: 's1' })],
      sessionExercises: [
        sessionExercise({ id: 'e1', sessionId: 's1' }),
        sessionExercise({ id: 'e2', sessionId: 's1', orderIndex: 2, exerciseNameSnapshot: 'Hip Thrust' }),
      ],
      setLogs: [
        setLog({ id: 'l1', sessionExerciseId: 'e1', weight: 40, reps: 6 }),
        setLog({ id: 'l2', sessionExerciseId: 'e2', completed: false }),
      ],
    });

    expect(parseCsv(files.sessionsCsv).rows).toHaveLength(1);
  });

  it('rechnet die Stunden seit der letzten Einheit und seit der letzten Einheit B', () => {
    const files = build({
      sessions: [
        session({
          id: 's1',
          templateNameSnapshot: 'Einheit B',
          startedAt: '2026-08-20T17:00:00',
          completedAt: '2026-08-20T18:00:00',
        }),
        session({
          id: 's2',
          templateNameSnapshot: 'Einheit A',
          startedAt: '2026-08-22T18:00:00',
          completedAt: '2026-08-22T19:00:00',
        }),
        session({
          id: 's3',
          templateNameSnapshot: 'Einheit A',
          startedAt: '2026-08-25T19:00:00',
          completedAt: '2026-08-25T20:00:00',
        }),
      ],
      sessionExercises: [
        sessionExercise({ id: 'e1', sessionId: 's1' }),
        sessionExercise({ id: 'e2', sessionId: 's2' }),
        sessionExercise({ id: 'e3', sessionId: 's3' }),
      ],
      setLogs: [
        setLog({ id: 'l1', sessionExerciseId: 'e1', weight: 40, reps: 6 }),
        setLog({ id: 'l2', sessionExerciseId: 'e2', weight: 40, reps: 6 }),
        setLog({ id: 'l3', sessionExerciseId: 'e3', weight: 40, reps: 6 }),
      ],
    });
    const { columns, rows } = parseCsv(files.sessionsCsv);
    const since = columns.indexOf('std_seit_letzter_einheit');
    const sinceB = columns.indexOf('std_seit_letzter_einheit_b');

    // Erste Einheit: kein Vorgänger, beide Spalten leer.
    expect([rows[0][since], rows[0][sinceB]]).toEqual(['', '']);
    // 20.08. 18:00 -> 22.08. 18:00 sind 48 Stunden, und es war eine Einheit B.
    expect([rows[1][since], rows[1][sinceB]]).toEqual(['48', '48']);
    // 22.08. 19:00 -> 25.08. 19:00 sind 72 Stunden, seit Einheit B aber 121.
    expect([rows[2][since], rows[2][sinceB]]).toEqual(['72', '121']);
  });

  it('lässt die Referenzspalte leer, wenn es das Workout nicht gibt', () => {
    const files = build({
      referenceTemplateName: 'Einheit Z',
      sessions: [session({ id: 's1' }), session({ id: 's2', startedAt: '2026-08-27T17:00:00' })],
      sessionExercises: [
        sessionExercise({ id: 'e1', sessionId: 's1' }),
        sessionExercise({ id: 'e2', sessionId: 's2' }),
      ],
      setLogs: [
        setLog({ id: 'l1', sessionExerciseId: 'e1', weight: 40, reps: 6 }),
        setLog({ id: 'l2', sessionExerciseId: 'e2', weight: 40, reps: 6 }),
      ],
    });
    const { columns, rows } = parseCsv(files.sessionsCsv);

    expect(rows.every((row) => row[columns.indexOf('std_seit_letzter_einheit_b')] === '')).toBe(true);
  });

  it('lässt das Volumen bei Zeit- und Körpergewichtsübungen leer', () => {
    const files = build({
      sessions: [session({ id: 's1' })],
      sessionExercises: [
        sessionExercise({
          id: 'e1',
          sessionId: 's1',
          exerciseNameSnapshot: 'Plank',
          trackingMode: 'time_weight',
        }),
        sessionExercise({
          id: 'e2',
          sessionId: 's1',
          orderIndex: 2,
          exerciseNameSnapshot: 'Liegestütz',
        }),
      ],
      setLogs: [
        setLog({ id: 'l1', sessionExerciseId: 'e1', seconds: 45, weight: 10 }),
        setLog({ id: 'l2', sessionExerciseId: 'e2', reps: 12 }),
      ],
    });
    const { columns, rows } = parseCsv(files.sessionsCsv);

    expect(rows[0][columns.indexOf('volumen')]).toBe('');
    expect(rows[0][columns.indexOf('top_sekunden')]).toBe('45');
    expect(rows[1][columns.indexOf('volumen')]).toBe('');
    expect(rows[1][columns.indexOf('top_wdh')]).toBe('12');
  });

  it('nennt Band und Höhe, statt sie wie Körpergewicht aussehen zu lassen', () => {
    const files = build({
      bandLevels: [
        { id: 'band-1', name: 'Gelb', orderIndex: 1, createdAt: '', updatedAt: '' },
        { id: 'band-2', name: 'Lila', orderIndex: 2, createdAt: '', updatedAt: '' },
      ],
      sessions: [session({ id: 's1' })],
      sessionExercises: [
        sessionExercise({
          id: 'e1',
          sessionId: 's1',
          exerciseNameSnapshot: 'Face Pull',
          loadKind: 'band',
        }),
        sessionExercise({
          id: 'e2',
          sessionId: 's1',
          orderIndex: 2,
          exerciseNameSnapshot: 'Step-Downs vom Kasten',
          tracksHeight: true,
        }),
      ],
      setLogs: [
        setLog({ id: 'l1', sessionExerciseId: 'e1', bandId: 'band-1', bandNameSnapshot: 'Gelb', reps: 12 }),
        setLog({
          id: 'l2',
          sessionExerciseId: 'e1',
          setNumber: 2,
          bandId: 'band-2',
          bandNameSnapshot: 'Lila',
          reps: 8,
        }),
        setLog({ id: 'l3', sessionExerciseId: 'e2', heightCm: 25, reps: 8 }),
      ],
    });
    const { columns, rows } = parseCsv(files.sessionsCsv);

    // Das stärkere Band gewinnt, obwohl es weniger Wiederholungen hat.
    expect(rows[0][columns.indexOf('top_band')]).toBe('Lila');
    expect(rows[0][columns.indexOf('top_wdh')]).toBe('8');
    expect(rows[1][columns.indexOf('top_hoehe_cm')]).toBe('25');
    expect(files.progressionCsv).toContain('Lila x8');
    expect(files.progressionCsv).toContain('25cm x8');
  });

  it('setzt Felder mit Komma in Anführungszeichen', () => {
    const files = build({
      sessions: [session({ id: 's1', templateNameSnapshot: 'Einheit A, kurz' })],
      sessionExercises: [
        sessionExercise({ id: 'e1', sessionId: 's1', exerciseNameSnapshot: 'Rudern, einarmig' }),
      ],
      setLogs: [setLog({ id: 'l1', sessionExerciseId: 'e1', weight: 22.5, reps: 8 })],
    });

    expect(files.sessionsCsv).toContain('"Einheit A, kurz"');
    expect(files.sessionsCsv).toContain('"Rudern, einarmig"');
    // Dezimalpunkt statt Komma: die Datei ist kommagetrennt.
    expect(files.sessionsCsv).toContain('22.5');
  });

  it('pivotiert den Verlauf je Übung und Seite über die Trainingstage', () => {
    const files = build({
      sessions: [
        session({ id: 's1', startedAt: '2026-07-30T17:00:00', completedAt: '2026-07-30T18:00:00' }),
        session({ id: 's2', startedAt: '2026-08-04T17:00:00', completedAt: '2026-08-04T18:00:00' }),
      ],
      sessionExercises: [
        sessionExercise({ id: 'e1', sessionId: 's1', exerciseNameSnapshot: 'Hip Thrust' }),
        sessionExercise({ id: 'e2', sessionId: 's2', exerciseNameSnapshot: 'Front Squat LH' }),
      ],
      setLogs: [
        setLog({ id: 'l1', sessionExerciseId: 'e1', weight: 25, reps: 7 }),
        setLog({ id: 'l2', sessionExerciseId: 'e2', weight: 35, reps: 6 }),
      ],
    });

    expect(files.progressionCsv).toBe(
      [
        'uebung,seite,2026-07-30,2026-08-04',
        'Front Squat LH,beide,,35x6',
        'Hip Thrust,beide,25x7,',
        '',
      ].join('\n'),
    );
  });

  it('beschreibt Zeitraum, Programm und trainierte Übungen in meta.json', () => {
    const files = build({
      program: {
        id: 'p1',
        name: 'Sommerplan',
        activeWeek: 1,
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
      },
      weekControl: { effectiveWeek: 1, maxWeek: 4, mode: 'override' },
      bandLevels: [{ id: 'band-2', name: 'Lila', orderIndex: 2, createdAt: '', updatedAt: '' }],
      sessions: [
        session({ id: 's1', startedAt: '2026-07-29T17:00:00', completedAt: '2026-07-29T18:00:00' }),
        session({ id: 's2', startedAt: '2026-08-25T17:00:00', completedAt: '2026-08-25T18:00:00' }),
      ],
      sessionExercises: [
        sessionExercise({ id: 'e1', sessionId: 's1' }),
        sessionExercise({ id: 'e2', sessionId: 's2' }),
      ],
      setLogs: [
        setLog({ id: 'l1', sessionExerciseId: 'e1', weight: 40, reps: 6 }),
        setLog({ id: 'l2', sessionExerciseId: 'e2', weight: 40, reps: 6 }),
      ],
    });
    const meta = JSON.parse(files.metaJson);

    expect(meta.exportiertAm).toMatch(/^2026-08-26T09:00:00[+-]\d{2}:\d{2}$/);
    expect(meta.zeitraum).toEqual({ von: '2026-07-29', bis: '2026-08-25' });
    expect(meta.programm).toBe('Sommerplan');
    expect(meta.aktiveWoche).toBe(1);
    expect(meta.weekOverrideAktiv).toBe(true);
    expect(meta.bandLevels).toEqual(['Lila']);
    expect(meta.uebungen).toEqual([
      { name: 'Front Squat LH', trackingMode: 'reps_weight', unilateral: false },
    ]);
  });

  it('schreibt die Tests zeitlich absteigend, den neuesten oben', () => {
    const files = build({
      tests: [
        exerciseTest({ id: 't1', recordedAt: '2026-07-01T09:00:00', leftValue: 8, rightValue: 11 }),
        exerciseTest({ id: 't3', recordedAt: '2026-08-25T09:00:00', leftValue: 10, rightValue: 12 }),
        exerciseTest({ id: 't2', recordedAt: '2026-08-02T09:00:00', leftValue: 9, rightValue: 12 }),
      ],
    });
    const { columns, rows } = parseCsv(files.testsCsv);

    expect(columns).toEqual(['datum', 'uebung', 'links', 'rechts', 'asymmetrie_prozent', 'notiz']);
    expect(rows.map((row) => row[0])).toEqual(['2026-08-25', '2026-08-02', '2026-07-01']);
    expect(rows[0].slice(1, 5)).toEqual(['Hüft-Innenrotation (Grad)', '10', '12', '16.7']);
  });

  it('nimmt einen Test auf, der zu keiner exportierten Session gehört', () => {
    /*
     * Tests werden unabhängig vom Training erhoben - am Sonntag auf dem
     * Wohnzimmerboden, ohne Einheit. Hingen sie an einer Session, verlöre man
     * ausgerechnet die Messreihe, an der der Fortschritt hängt.
     */
    const files = build({ tests: [exerciseTest({ id: 't1' })] });

    expect(files.sessionsCsv.trimEnd().split('\n')).toHaveLength(1);
    expect(parseCsv(files.testsCsv).rows).toHaveLength(1);
  });

  it('schreibt die Testzahlen mit Dezimalpunkt und den Snapshot-Namen', () => {
    const files = build({
      tests: [
        exerciseTest({
          id: 't1',
          exerciseId: 'gelöschte-übung',
          exerciseNameSnapshot: 'Knie-zur-Wand (cm)',
          leftValue: 10.5,
          rightValue: 12,
          asymmetryPercent: 13.043,
        }),
      ],
    });

    // Punkt, nicht Komma: in einer kommagetrennten Datei wäre das Komma ein
    // Trennzeichen - dieselbe Regel wie in sessions.csv.
    expect(parseCsv(files.testsCsv).rows[0]).toEqual([
      '2026-08-25',
      'Knie-zur-Wand (cm)',
      '10.5',
      '12',
      '13.043',
      '',
    ]);
  });

  it('setzt eine Notiz mit Komma in Anführungszeichen', () => {
    const files = build({
      tests: [exerciseTest({ id: 't1', notes: 'morgens, vor dem Lauf' })],
    });

    expect(files.testsCsv).toContain('"morgens, vor dem Lauf"');
  });

  it('bleibt ohne Daten eine gültige, leere Datei', () => {
    const files = build({});
    const meta = JSON.parse(files.metaJson);

    expect(files.sessionsCsv.trimEnd().split('\n')).toHaveLength(1);
    expect(files.progressionCsv.trimEnd()).toBe('uebung,seite');
    expect(files.testsCsv.trimEnd().split('\n')).toHaveLength(1);
    expect(meta.zeitraum).toEqual({ von: null, bis: null });
    expect(meta.programm).toBeNull();
  });

  it('enthält keine einzige Id', () => {
    const files = build({
      sessions: [session({ id: 'a4f0c2de-0000-4000-8000-000000000001' })],
      sessionExercises: [
        sessionExercise({ id: 'a4f0c2de-0000-4000-8000-000000000002', sessionId: 'a4f0c2de-0000-4000-8000-000000000001' }),
      ],
      setLogs: [
        setLog({
          id: 'a4f0c2de-0000-4000-8000-000000000003',
          sessionExerciseId: 'a4f0c2de-0000-4000-8000-000000000002',
          weight: 40,
          reps: 6,
        }),
      ],
      tests: [
        exerciseTest({
          id: 'a4f0c2de-0000-4000-8000-000000000004',
          exerciseId: 'a4f0c2de-0000-4000-8000-000000000005',
        }),
      ],
    });

    for (const content of [
      files.sessionsCsv,
      files.progressionCsv,
      files.testsCsv,
      files.metaJson,
    ]) {
      expect(content).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    }
  });
});

describe('buildAnalysisPasteText', () => {
  it('stellt meta.json vor die Zahlen', () => {
    const files = build({
      sessions: [session({ id: 's1' })],
      sessionExercises: [sessionExercise({ id: 'e1', sessionId: 's1' })],
      setLogs: [setLog({ id: 'l1', sessionExerciseId: 'e1', reps: 5, weight: 60 })],
    });
    const text = buildAnalysisPasteText(files, new Date('2026-08-28T09:00:00'));

    // Ohne trackingMode und weekOverrideAktiv liest man die Tabelle falsch -
    // deshalb steht meta.json oben, nicht als Anhang unten.
    expect(text.indexOf('## meta.json')).toBeLessThan(text.indexOf('## sessions.csv'));
    expect(text.indexOf('## sessions.csv')).toBeLessThan(text.indexOf('## progression.csv'));
    expect(text.indexOf('## progression.csv')).toBeLessThan(text.indexOf('## tests.csv'));
  });

  it('nennt das Exportdatum und rahmt jede Datei ein', () => {
    const text = buildAnalysisPasteText(build({}), new Date('2026-08-28T09:00:00'));

    expect(text.startsWith('# Gym Book Analyse-Export 2026-08-28')).toBe(true);
    expect(text).toContain('```json');
    // Dreimal csv-Rahmen: sessions, progression und tests.
    expect(text.match(/```csv/g)).toHaveLength(3);
  });

  it('trägt den Inhalt aller vier Dateien', () => {
    const files = build({
      sessions: [session({ id: 's1' })],
      sessionExercises: [sessionExercise({ id: 'e1', sessionId: 's1' })],
      setLogs: [setLog({ id: 'l1', sessionExerciseId: 'e1', reps: 5, weight: 60 })],
      tests: [exerciseTest({ id: 't1' })],
    });
    const text = buildAnalysisPasteText(files, new Date('2026-08-28T09:00:00'));

    for (const content of [files.sessionsCsv, files.progressionCsv, files.testsCsv, files.metaJson]) {
      expect(text).toContain(content.trimEnd());
    }
  });
});
