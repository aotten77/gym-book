import { describe, expect, it } from 'vitest';
import { db } from '@/db/appDb';
import {
  applyNordicCurlTrackingFix,
  applyProgramWeekFix,
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
