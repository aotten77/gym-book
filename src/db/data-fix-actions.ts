import { db } from '@/db/appDb';
import { ensureSettings, SETTINGS_ID } from '@/db/normalize';
import { normalizeImportKey } from '@/domain/library-import';

/*
 * Einmalige Korrekturen an Daten, die schon auf dem Gerät liegen.
 *
 * Beides sind keine Migrationen im Dexie-Sinn: das Schema bleibt, wie es ist,
 * und automatisch laufen darf hier nichts. Ein `upgrade()` würde ohne Rückfrage
 * Trainingsdaten umdeuten - deshalb steht jede dieser Aktionen hinter einem
 * Bestätigungsdialog in den Einstellungen.
 *
 * "Einmalig" wird abgeleitet, nicht gespeichert: `describeDataFixes` liest den
 * Bestand und sagt, ob noch etwas zu tun ist. Ein gespeichertes Häkchen "schon
 * gelaufen" würde nach dem Restore einer alten Sicherung lügen.
 */

export const NORDIC_CURL_NAME = 'Nordic Curl';

export interface DataFixStatus {
  /** Übungen namens "Nordic Curl", die noch auf Zeit erfasst werden. */
  nordicCurlOnTime: number;
  /** Sätze, die dabei Sekunden tragen und als Altdaten stehen bleiben. */
  nordicCurlSecondsLogs: number;
  /** Ob die Einstellungen eine Woche von Hand übersteuern. */
  hasWeekOverride: boolean;
  weekOverride?: number;
  activeProgramId?: string;
  activeProgramName?: string;
  activeProgramStartedOn?: string;
}

async function findNordicCurlExercises() {
  const key = normalizeImportKey(NORDIC_CURL_NAME);

  return db.exercises.filter((exercise) => normalizeImportKey(exercise.name) === key).toArray();
}

export async function describeDataFixes(): Promise<DataFixStatus> {
  const nordicCurls = await findNordicCurlExercises();
  const onTime = nordicCurls.filter((exercise) => exercise.trackingMode === 'time');
  const settings = await db.appSettings.get(SETTINGS_ID);
  const program = settings?.activeProgramId
    ? await db.programs.get(settings.activeProgramId)
    : undefined;

  const sessionExerciseIds = nordicCurls.length
    ? (
        await db.workoutSessionExercises
          .where('exerciseId')
          .anyOf(nordicCurls.map((exercise) => exercise.id))
          .toArray()
      ).map((item) => item.id)
    : [];

  const secondsLogs = sessionExerciseIds.length
    ? await db.workoutSetLogs
        .where('sessionExerciseId')
        .anyOf(sessionExerciseIds)
        .filter((log) => typeof log.seconds === 'number')
        .count()
    : 0;

  return {
    nordicCurlOnTime: onTime.length,
    nordicCurlSecondsLogs: secondsLogs,
    hasWeekOverride: typeof settings?.weekOverride === 'number',
    weekOverride: settings?.weekOverride,
    activeProgramId: program?.id,
    activeProgramName: program?.name,
    activeProgramStartedOn: program?.startedOn,
  };
}

/**
 * Stellt den Nordic Curl von Zeit auf Wiederholungen um.
 *
 * Die Sekundenerfassung belohnt statisches Halten - bei dieser Übung ist genau
 * das unerwünscht, gezählt werden soll die Zahl sauberer Wiederholungen.
 *
 * Bereits protokollierte Sekunden bleiben stehen und werden nicht umgerechnet:
 * eine Sekunde ist keine Wiederholung, und eine erfundene Zahl wäre schlimmer
 * als eine fremde Einheit. Vergangene Einheiten zeigen weiter, was sie gemessen
 * haben - sie tragen ihren eigenen `trackingMode`-Snapshot -, und die
 * Übungsansicht markiert sie als Altdaten, weil sie sonst stillschweigend aus
 * der Fortschrittskurve fielen.
 */
export async function applyNordicCurlTrackingFix() {
  let changed = 0;

  await db.transaction('rw', db.exercises, async () => {
    const nordicCurls = await findNordicCurlExercises();
    const onTime = nordicCurls.filter((exercise) => exercise.trackingMode === 'time');

    if (nordicCurls.length === 0) {
      throw new Error('Es gibt keine Übung namens "Nordic Curl".');
    }

    const now = new Date().toISOString();

    for (const exercise of onTime) {
      await db.exercises.update(exercise.id, {
        trackingMode: 'reps_weight',
        updatedAt: now,
      });
      changed += 1;
    }
  });

  return changed;
}

/**
 * Ersetzt die von Hand gesetzte Woche durch das Startdatum des Programms.
 *
 * Ein `weekOverride` gilt, bis er zurückgenommen wird - stand er auf 1, lief
 * jede Einheit als Woche 1, und die wochenabhängigen Vorgaben aus den
 * Progressionsregeln kamen nie zum Zug. Beides gehört in eine Transaktion:
 * ein gesetztes Startdatum, dessen Override noch steht, änderte gar nichts.
 */
export async function applyProgramWeekFix(programId: string, startedOn: string) {
  const trimmed = startedOn.trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error('Das Startdatum braucht die Form JJJJ-MM-TT.');
  }

  await db.transaction('rw', db.programs, db.appSettings, async () => {
    const program = await db.programs.get(programId);

    if (!program) {
      throw new Error('Programm nicht gefunden');
    }

    const settings = await ensureSettings();

    await db.programs.update(programId, {
      startedOn: trimmed,
      updatedAt: new Date().toISOString(),
    });

    await db.appSettings.put({
      ...settings,
      id: SETTINGS_ID,
      weekOverride: undefined,
      updatedAt: new Date().toISOString(),
    });
  });
}
