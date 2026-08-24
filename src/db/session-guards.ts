import { db } from '@/db/appDb';

/*
 * Der eine Guard, hinter dem jede Mutation an einer Session steht.
 *
 * Abgeschlossene Sessions sind unveränderlich - sonst schriebe ein alter
 * Reiter im App-Switcher noch Werte in ein Training von vorletzter Woche. Die
 * beiden Prüfungen stehen in einer eigenen Datei, weil sie von zwei
 * Aktionsmodulen gebraucht werden und keines davon dem anderen gehört.
 */

export async function isSessionExerciseEditable(sessionExerciseId: string) {
  const sessionExercise = await db.workoutSessionExercises.get(sessionExerciseId);

  if (!sessionExercise) {
    return false;
  }

  const session = await db.workoutSessions.get(sessionExercise.sessionId);
  return session?.status === 'active';
}

export async function isSetLogEditable(setLogId: string) {
  const setLog = await db.workoutSetLogs.get(setLogId);

  if (!setLog) {
    return false;
  }

  return isSessionExerciseEditable(setLog.sessionExerciseId);
}
