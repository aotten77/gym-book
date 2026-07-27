import { db } from '@/db/appDb';

export async function exportDatabaseSnapshot() {
  const snapshot = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    exercises: await db.exercises.toArray(),
    workoutTemplates: await db.workoutTemplates.toArray(),
    workoutTemplateExercises: await db.workoutTemplateExercises.toArray(),
    workoutSessions: await db.workoutSessions.toArray(),
    workoutSessionExercises: await db.workoutSessionExercises.toArray(),
    workoutSetLogs: await db.workoutSetLogs.toArray(),
    exerciseTests: await db.exerciseTests.toArray(),
    programs: await db.programs.toArray(),
    programWeeks: await db.programWeeks.toArray(),
    progressionRules: await db.progressionRules.toArray(),
    mediaAssets: await db.mediaAssets.toArray(),
    appSettings: await db.appSettings.toArray(),
  };

  const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `gym-book-export-${snapshot.exportedAt.slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
