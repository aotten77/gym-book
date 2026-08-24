import { db } from '@/db/appDb';
import { ensureSettings, SETTINGS_ID } from '@/db/normalize';
import type { AppSettings } from '@/domain/models';

/**
 * Read-Modify-Write auf die eine Einstellungszeile, geklammert.
 *
 * Alle Setter hier lesen die Zeile, legen ihre Änderung darüber und schreiben
 * sie ganz zurück. Ungeklammert sehen zwei nebenläufige Setter denselben
 * Ausgangsstand, und der zweite `put` überschreibt die Änderung des ersten -
 * auf einer Seite, die den Signalton und das Wachhalten direkt untereinander
 * anbietet, ist das kein theoretischer Fall. Zum Vergleich: `program-actions.ts`
 * schreibt dieselbe Tabelle längst innerhalb von Transaktionen.
 *
 * `ensureSettings` gehört mit hinein, weil es die Zeile notfalls selbst anlegt
 * und damit ebenfalls schreibt.
 */
async function updateSettings(changes: Partial<AppSettings>) {
  await db.transaction('rw', db.appSettings, async () => {
    const current = await ensureSettings();

    await db.appSettings.put({
      ...current,
      ...changes,
      id: SETTINGS_ID,
      updatedAt: new Date().toISOString(),
    });
  });
}

export async function setActiveProgram(programId: string) {
  // Eigene Klammer statt `updateSettings`: die Prüfung auf das Programm gehört
  // mit hinein, sonst zeigt die Einstellung auf ein Programm, das zwischen
  // Prüfen und Schreiben gelöscht wurde.
  await db.transaction('rw', db.appSettings, db.programs, async () => {
    const program = await db.programs.get(programId);

    if (!program) {
      throw new Error('Programm nicht gefunden');
    }

    const current = await ensureSettings();

    await db.appSettings.put({
      ...current,
      id: SETTINGS_ID,
      activeProgramId: programId,
      // Ein Programmwechsel hebt die von Hand gesetzte Woche auf - sie gehörte
      // zum vorigen Programm.
      weekOverride: undefined,
      updatedAt: new Date().toISOString(),
    });
  });
}

export async function setWeekOverride(weekOverride?: number) {
  await updateSettings({
    weekOverride:
      typeof weekOverride === 'number' ? Math.max(1, Math.floor(weekOverride)) : undefined,
  });
}

export async function clearWeekOverride() {
  await setWeekOverride(undefined);
}

/**
 * Schaltet den Signalton beim Ablauf der Timer.
 *
 * Wird immer explizit geschrieben, nie gelöscht: `undefined` bedeutet "nie
 * entschieden" und zählt als eingeschaltet - ein bewusstes Aus muss davon
 * unterscheidbar bleiben.
 */
export async function setTimerSoundEnabled(enabled: boolean) {
  await updateSettings({ timerSoundEnabled: enabled });
}

/**
 * Schaltet das Wachhalten des Bildschirms während einer laufenden Einheit.
 *
 * Wie beim Signalton gilt `undefined` als eingeschaltet, deshalb wird auch
 * hier immer explizit geschrieben.
 */
export async function setKeepScreenAwakeEnabled(enabled: boolean) {
  await updateSettings({ keepScreenAwakeEnabled: enabled });
}

/**
 * Merkt sich, dass eine Sicherung geschrieben wurde.
 *
 * Die Erinnerung auf der Startseite zählt abgeschlossene Trainings, die
 * jünger sind als dieser Zeitpunkt.
 */
export async function markBackupCreated(backupAt = new Date().toISOString()) {
  await updateSettings({ lastBackupAt: backupAt });
}
