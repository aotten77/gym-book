import { describe, expect, it } from 'vitest';
import { db } from '@/db/appDb';
import { bootstrapAppData, seedSampleData } from '@/db/bootstrap';

/** Alle Tabellen außer den Einstellungen - der erste Start darf keine davon füllen. */
const DOMAIN_TABLES = db.tables.filter((table) => table.name !== 'appSettings');

describe('bootstrapAppData', () => {
  it('legt nur die Einstellungszeile an, keinen erfundenen Trainingsverlauf', async () => {
    await bootstrapAppData();

    expect(await db.appSettings.get('app-settings')).toMatchObject({
      id: 'app-settings',
      exportSchemaVersion: 1,
    });

    const filled = await Promise.all(
      DOMAIN_TABLES.map(async (table) => [table.name, await table.count()] as const),
    );

    expect(filled.filter(([, count]) => count > 0)).toEqual([]);
  });

  it('rührt eine bestehende Zeile nicht an', async () => {
    await db.appSettings.add({
      id: 'app-settings',
      activeProgramId: 'programm-des-nutzers',
      weekOverride: 4,
      exportSchemaVersion: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    await bootstrapAppData();

    expect(await db.appSettings.get('app-settings')).toMatchObject({
      activeProgramId: 'programm-des-nutzers',
      weekOverride: 4,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(await db.appSettings.count()).toBe(1);
  });
});

describe('seedSampleData', () => {
  it('materialisiert das Beispielprogramm vollständig', async () => {
    await seedSampleData();

    const program = await db.programs.toCollection().first();
    expect(program).toMatchObject({ name: 'Unterkörper Aufbau' });
    // Die aktive Woche folgt der Kalenderwoche, bleibt aber im Programm.
    expect(program!.activeWeek).toBeGreaterThanOrEqual(1);
    expect(program!.activeWeek).toBeLessThanOrEqual(8);

    // Das Beispielprogramm ist danach auch das aktive.
    expect((await db.appSettings.get('app-settings'))?.activeProgramId).toBe(program!.id);

    const weeks = await db.programWeeks.orderBy('weekNumber').toArray();
    expect(weeks.map((week) => [week.weekNumber, week.label])).toEqual([
      [1, 'Woche 1'],
      [2, 'Woche 2'],
      [3, 'Woche 3'],
      [4, 'Woche 4'],
      [5, 'Woche 5'],
      [6, 'Woche 6'],
      [7, 'Woche 7'],
      [8, 'Woche 8'],
    ]);
    expect(weeks.every((week) => week.programId === program!.id)).toBe(true);

    const template = await db.workoutTemplates.toCollection().first();
    expect(template).toMatchObject({ name: 'Einheit A' });

    // Reihenfolge und Modi tragen die e2e-Suite - sie öffnet die Übungen
    // namentlich und erwartet die einbeinige an zweiter Stelle.
    const templateExercises = await db.workoutTemplateExercises
      .where('templateId')
      .equals(template!.id)
      .sortBy('orderIndex');
    const exercisesById = Object.fromEntries(
      (await db.exercises.toArray()).map((exercise) => [exercise.id, exercise]),
    );

    expect(
      templateExercises.map((templateExercise) => {
        const exercise = exercisesById[templateExercise.exerciseId];

        return [
          exercise.name,
          exercise.trackingMode,
          exercise.unilateral === true,
          templateExercise.workSetCount,
        ];
      }),
    ).toEqual([
      ['Front Squat', 'reps_weight', false, 3],
      ['Bulgarian Split Squat', 'reps_weight', true, 2],
      ['Nordic Curl Iso', 'time_weight', false, 3],
    ]);

    expect(templateExercises[0]).toMatchObject({ targetReps: 5, targetWeight: 82.5, restSeconds: 150 });

    // Acht Progressionsregeln, alle an der Nordic-Übung, eine je Woche.
    const rules = await db.progressionRules.toArray();
    expect(rules).toHaveLength(8);
    expect(new Set(rules.map((rule) => rule.templateExerciseId))).toEqual(
      new Set([templateExercises[2].id]),
    );
    expect(new Set(rules.map((rule) => rule.programWeekId))).toEqual(
      new Set(weeks.map((week) => week.id)),
    );
    expect(
      weeks.map(
        (week) => rules.find((rule) => rule.programWeekId === week.id)?.targetSeconds,
      ),
    ).toEqual([10, 12, 14, 16, 18, 20, 22, 24]);
  });

  it('legt genau eine abgeschlossene Session mit lückenlos ausgefüllten Sätzen an', async () => {
    await seedSampleData();

    const sessions = await db.workoutSessions.toArray();
    expect(sessions).toHaveLength(1);

    const [session] = sessions;
    expect(session.status).toBe('completed');
    expect(session.completedAt).toBeTruthy();
    expect(session.templateNameSnapshot).toBe('Einheit A');

    const program = await db.programs.toCollection().first();
    // Die Beispielsession liegt eine Woche hinter der aktiven - nie unter 1.
    expect(session.resolvedProgramWeek).toBe(Math.max(1, program!.activeWeek - 1));

    const sessionExercises = await db.workoutSessionExercises
      .where('sessionId')
      .equals(session.id)
      .sortBy('orderIndex');
    expect(sessionExercises.map((item) => item.exerciseNameSnapshot)).toEqual([
      'Front Squat',
      'Bulgarian Split Squat',
      'Nordic Curl Iso',
    ]);

    const setLogs = await db.workoutSetLogs.toArray();
    // Aufwärmrunde plus Arbeitssätze, bei der einbeinigen Übung je zwei
    // Zeilen: (1+3) + 2*(1+2) + (1+3).
    expect(setLogs).toHaveLength(14);
    expect(setLogs.every((log) => log.completed && log.completedAt)).toBe(true);

    const splitSquatLogs = setLogs.filter(
      (log) => log.sessionExerciseId === sessionExercises[1].id && log.setKind === 'work',
    );
    // Die rechte Seite trägt bewusst ein Kilo mehr und eine Wiederholung
    // weniger - daraus lebt die Asymmetrie-Anzeige in der Historie.
    expect(
      splitSquatLogs
        .filter((log) => log.side === 'left')
        .map((log) => [log.reps, log.weight]),
    ).toEqual([
      [8, 22.5],
      [8, 22.5],
    ]);
    expect(
      splitSquatLogs
        .filter((log) => log.side === 'right')
        .map((log) => [log.reps, log.weight]),
    ).toEqual([
      [7, 23.75],
      [7, 23.75],
    ]);
  });

  it('nagelt den Asymmetriewert des Beispieltests auf 8,3 % fest', async () => {
    await seedSampleData();

    const tests = await db.exerciseTests.toArray();
    expect(tests).toHaveLength(1);

    // CLAUDE.md warnt e2e-Autoren vor genau dieser Zahl: wer eine eigene
    // Asymmetrie prüfen will, muss andere Werte wählen. Ohne diese Zusicherung
    // verschiebt eine Änderung hier stumm die Zeile, gegen die dort geprüft wird.
    expect(tests[0]).toMatchObject({
      exerciseNameSnapshot: 'Bulgarian Split Squat',
      leftValue: 22,
      rightValue: 24,
      asymmetryPercent: 8.3,
    });
  });

  it('lehnt das Laden in eine gefüllte Bibliothek ab', async () => {
    await seedSampleData();

    await expect(seedSampleData()).rejects.toThrow(/leere Bibliothek/);

    // Der zweite Versuch darf nichts angefasst haben.
    expect(await db.programs.count()).toBe(1);
    expect(await db.exercises.count()).toBe(3);
  });
});
