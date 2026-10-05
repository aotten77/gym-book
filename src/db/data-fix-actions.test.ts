import { describe, expect, it } from 'vitest';
import { db } from '@/db/appDb';
import {
  applyNordicCurlTrackingFix,
  applyProgramWeekFix,
  applyWeekdaysToPlanMigration,
  applyWorkoutCategoryBackfill,
  previewWeekdaysToPlanMigration,
  describeDataFixes,
} from '@/db/data-fix-actions';
import { createProgram } from '@/db/program-actions';
import { startSessionFromTemplate } from '@/db/session-actions';
import { setActiveProgram, setWeekOverride } from '@/db/settings-actions';
import { saveTemplateExercise, createTemplate } from '@/db/template-actions';
import { createExercise } from '@/db/exercise-actions';
import { toDateInputValue } from '@/domain/program';
import { startOfCalendarWeek } from '@/domain/calendar-week';

/** Nordic Curl auf Zeit, mit einer abgeschlossenen Einheit voller Sekunden. */
async function seedNordicCurlOnTime() {
  const now = '2026-02-01T09:00:00.000Z';

  await db.exercises.add({
    id: 'e-nordic',
    name: 'Nordic Curl',
    trackingMode: 'time',
    unilateral: false,
    createdAt: now,
    updatedAt: now,
  });

  await db.workoutSessions.add({
    id: 's1',
    templateId: 't1',
    templateNameSnapshot: 'Einheit B',
    resolvedProgramWeek: 1,
    startedAt: now,
    completedAt: '2026-02-01T10:00:00.000Z',
    status: 'completed',
  });

  await db.workoutSessionExercises.add({
    id: 'se1',
    sessionId: 's1',
    exerciseId: 'e-nordic',
    exerciseNameSnapshot: 'Nordic Curl',
    trackingMode: 'time',
    unilateral: false,
    orderIndex: 1,
    wasSkipped: false,
    addedInSession: false,
    workSetCount: 3,
  });

  await db.workoutSetLogs.add({
    id: 'log1',
    sessionExerciseId: 'se1',
    setKind: 'work',
    side: 'both',
    setNumber: 1,
    seconds: 42,
    completed: true,
    completedAt: '2026-02-01T09:30:00.000Z',
  });
}

describe('Nordic-Curl-Korrektur', () => {
  it('stellt auf Wiederholungen um und lässt die Sekunden stehen', async () => {
    await seedNordicCurlOnTime();

    expect(await applyNordicCurlTrackingFix()).toBe(1);

    expect((await db.exercises.get('e-nordic'))?.trackingMode).toBe('reps_weight');
    // Vergangene Einheit und ihre Sekunden bleiben, wie sie gemessen wurden.
    expect((await db.workoutSetLogs.get('log1'))?.seconds).toBe(42);
    expect((await db.workoutSessionExercises.get('se1'))?.trackingMode).toBe('time');
  });

  it('ist beim zweiten Aufruf ein Leerlauf', async () => {
    await seedNordicCurlOnTime();

    await applyNordicCurlTrackingFix();

    expect(await applyNordicCurlTrackingFix()).toBe(0);
  });

  it('sagt es, wenn es die Übung gar nicht gibt', async () => {
    await expect(applyNordicCurlTrackingFix()).rejects.toThrow(/Nordic Curl/);
  });

  it('meldet im Status, was noch zu tun ist', async () => {
    await seedNordicCurlOnTime();

    const before = await describeDataFixes();

    expect(before.nordicCurlOnTime).toBe(1);
    expect(before.nordicCurlSecondsLogs).toBe(1);

    await applyNordicCurlTrackingFix();

    const after = await describeDataFixes();

    expect(after.nordicCurlOnTime).toBe(0);
    // Die Altdaten bleiben zählbar - sie sind der Grund für die Markierung
    // in der Übungsansicht.
    expect(after.nordicCurlSecondsLogs).toBe(1);
  });
});

describe('Programmwochen-Korrektur', () => {
  it('setzt das Startdatum und nimmt den Override zurück', async () => {
    const programId = await createProgram({ name: 'Rehab', weekCount: 8 });
    await setActiveProgram(programId);
    await setWeekOverride(1);

    expect((await describeDataFixes()).hasWeekOverride).toBe(true);

    await applyProgramWeekFix(programId, '2026-08-10');

    expect((await db.programs.get(programId))?.startedOn).toBe('2026-08-10');
    expect((await db.appSettings.get('app-settings'))?.weekOverride).toBeUndefined();
    expect((await describeDataFixes()).hasWeekOverride).toBe(false);
  });

  it('lehnt ein Datum in fremder Form ab', async () => {
    const programId = await createProgram({ name: 'Rehab', weekCount: 8 });

    await expect(applyProgramWeekFix(programId, '10.08.2026')).rejects.toThrow(/JJJJ-MM-TT/);
  });

  it('friert eine neue Einheit nicht mehr auf Woche 1 ein', async () => {
    const programId = await createProgram({ name: 'Rehab', weekCount: 8 });
    await setActiveProgram(programId);
    await setWeekOverride(1);

    const exerciseId = await createExercise({
      name: 'Hip Thrust',
      trackingMode: 'reps_weight',
      unilateral: false,
    });
    const templateId = await createTemplate({ name: 'Einheit A' });
    await saveTemplateExercise({
      templateId,
      exerciseId,
      orderIndex: 1,
      workSetCount: 3,
    });

    // Startdatum zwei Kalenderwochen zurück: die laufende Woche ist die dritte.
    const monday = startOfCalendarWeek(new Date());
    monday.setDate(monday.getDate() - 14);

    await applyProgramWeekFix(programId, toDateInputValue(monday));

    const sessionId = await startSessionFromTemplate(templateId);
    const session = await db.workoutSessions.get(sessionId);

    expect(session?.resolvedProgramWeek).toBe(3);
    expect(session?.usedWeekOverride).toBeFalsy();
    expect(session?.programWeekLabelSnapshot).toBe('Woche 3');
  });
});

describe('Art auf frühere Sessions übertragen', () => {
  const now = '2026-02-01T09:00:00.000Z';

  async function seedCategories() {
    await db.workoutTemplates.bulkAdd([
      { id: 't-mob', name: 'Mobility Flow', category: 'mobility', createdAt: now, updatedAt: now },
      { id: 't-str', name: 'Kraft A', createdAt: now, updatedAt: now },
    ]);

    const base = {
      resolvedProgramWeek: 1,
      startedAt: now,
      completedAt: '2026-02-01T10:00:00.000Z',
      status: 'completed' as const,
    };

    await db.workoutSessions.bulkAdd([
      { ...base, id: 's1', templateId: 't-mob', templateNameSnapshot: 'Mobility Flow' },
      { ...base, id: 's2', templateId: 't-mob', templateNameSnapshot: 'Mobility Flow' },
      {
        ...base,
        id: 's3',
        templateId: 't-mob',
        templateNameSnapshot: 'Mobility Flow',
        templateCategorySnapshot: 'mobility',
      },
      { ...base, id: 's4', templateId: 't-str', templateNameSnapshot: 'Kraft A' },
    ]);
  }

  it('zählt Sessions von Mobility-Workouts ohne Snapshot', async () => {
    await seedCategories();

    expect((await describeDataFixes()).sessionsWithoutCategory).toBe(2);
  });

  it('überträgt die Art und meldet danach nichts mehr', async () => {
    await seedCategories();

    expect(await applyWorkoutCategoryBackfill()).toBe(2);
    expect((await db.workoutSessions.get('s1'))?.templateCategorySnapshot).toBe('mobility');
    expect((await db.workoutSessions.get('s2'))?.templateCategorySnapshot).toBe('mobility');
    expect((await db.workoutSessions.get('s4'))?.templateCategorySnapshot).toBeUndefined();
    expect((await describeDataFixes()).sessionsWithoutCategory).toBe(0);
    expect(await applyWorkoutCategoryBackfill()).toBe(0);
  });

  it('lässt Sessions mit Snapshot "strength" eines inzwischen umgestellten Workouts in Ruhe', async () => {
    await seedCategories();
    await db.workoutSessions.add({
      id: 's5',
      templateId: 't-mob',
      templateNameSnapshot: 'Mobility Flow',
      templateCategorySnapshot: 'strength',
      resolvedProgramWeek: 1,
      startedAt: now,
      completedAt: '2026-02-01T10:00:00.000Z',
      status: 'completed',
    });

    expect((await describeDataFixes()).sessionsWithoutCategory).toBe(2);
    expect(await applyWorkoutCategoryBackfill()).toBe(2);
    expect((await db.workoutSessions.get('s5'))?.templateCategorySnapshot).toBe('strength');
  });

  it('fasst sonst nichts an', async () => {
    await seedCategories();
    await db.workoutSetLogs.add({
      id: 'l1',
      sessionExerciseId: 'se-x',
      setNumber: 1,
      setKind: 'work',
      side: 'both',
      completed: true,
      reps: 8,
    } as never);
    const before = await db.workoutSessions.get('s1');
    const logsBefore = await db.workoutSetLogs.toArray();

    await applyWorkoutCategoryBackfill();

    const after = await db.workoutSessions.get('s1');
    expect(after?.status).toBe(before?.status);
    expect(after?.completedAt).toBe(before?.completedAt);
    expect(await db.workoutSetLogs.toArray()).toEqual(logsBefore);
  });
});

describe('Wochentage in Termine umwandeln', () => {
  async function seedWeekdays() {
    const stamp = '2026-01-01T00:00:00.000Z';

    await db.programs.add({
      id: 'p1',
      name: 'Aufbau',
      activeWeek: 1,
      startedOn: '2026-10-05',
      createdAt: stamp,
      updatedAt: stamp,
    });
    await db.programWeeks.bulkAdd(
      Array.from({ length: 8 }, (_, index) => ({
        id: `w${index + 1}`,
        programId: 'p1',
        weekNumber: index + 1,
      })),
    );
    await db.appSettings.put({
      id: 'app-settings',
      activeProgramId: 'p1',
      exportSchemaVersion: 1,
      updatedAt: stamp,
    });
    await db.workoutTemplates.bulkAdd([
      { id: 'ta', name: 'Einheit A', scheduledWeekdays: [1, 4], createdAt: stamp, updatedAt: stamp },
      { id: 'tb', name: 'Einheit B', scheduledWeekdays: [4], createdAt: stamp, updatedAt: stamp },
      { id: 'tc', name: 'Einheit C', createdAt: stamp, updatedAt: stamp },
    ]);
  }

  const now = new Date(2026, 9, 21, 12, 0);

  it('wandelt um und entfernt das Feld', async () => {
    await seedWeekdays();

    expect((await describeDataFixes()).templatesWithWeekdays).toBe(2);

    const preview = await previewWeekdaysToPlanMigration(undefined, now);

    expect(preview.to).toBe('2026-11-29');

    const result = await applyWeekdaysToPlanMigration(undefined, now);
    const entries = await db.planEntries.toArray();

    expect(result.created).toBe(preview.count);
    expect(entries).toHaveLength(preview.count);

    const day = entries.filter((entry) => entry.date === '2026-10-22');

    expect(day.map((entry) => [entry.templateId, entry.orderInDay]).sort()).toEqual([
      ['ta', 1],
      ['tb', 2],
    ]);

    const templates = await db.workoutTemplates.toArray();

    expect(templates.every((template) => !('scheduledWeekdays' in template))).toBe(true);
    expect((await describeDataFixes()).templatesWithWeekdays).toBe(0);
  });

  it('zweiter Lauf legt nichts doppelt an', async () => {
    await seedWeekdays();
    await applyWeekdaysToPlanMigration(undefined, now);

    const count = await db.planEntries.count();

    // Das Feld ist weg - ein zweiter Lauf hat nichts mehr zu tun.
    expect(await applyWeekdaysToPlanMigration(undefined, now)).toEqual({ created: 0, skipped: 0 });
    expect(await db.planEntries.count()).toBe(count);
  });

  it('überspringt Termine, die schon im Plan stehen', async () => {
    await seedWeekdays();
    await db.planEntries.add({
      id: 'x',
      date: '2026-10-22',
      kind: 'workout',
      templateId: 'ta',
      orderInDay: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await applyWeekdaysToPlanMigration(undefined, now);

    expect(result.skipped).toBe(1);
    expect(await db.planEntries.where('date').equals('2026-10-22').count()).toBe(2);
  });
});
