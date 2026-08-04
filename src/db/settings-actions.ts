import { db } from '@/db/appDb';
import type { AppSettings } from '@/domain/models';

const SETTINGS_ID: AppSettings['id'] = 'app-settings';

async function ensureSettings() {
  const existing = await db.appSettings.get(SETTINGS_ID);

  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  const created: AppSettings = {
    id: SETTINGS_ID,
    exportSchemaVersion: 1,
    updatedAt: now,
  };

  await db.appSettings.add(created);
  return created;
}

export async function setActiveProgram(programId: string) {
  const program = await db.programs.get(programId);

  if (!program) {
    throw new Error('Programm nicht gefunden');
  }

  const current = await ensureSettings();
  const now = new Date().toISOString();

  await db.appSettings.put({
    ...current,
    id: SETTINGS_ID,
    activeProgramId: programId,
    weekOverride: undefined,
    updatedAt: now,
  });
}

export async function setWeekOverride(weekOverride?: number) {
  const current = await ensureSettings();
  const now = new Date().toISOString();

  await db.appSettings.put({
    ...current,
    id: SETTINGS_ID,
    weekOverride: typeof weekOverride === 'number' ? Math.max(1, Math.floor(weekOverride)) : undefined,
    updatedAt: now,
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
  const current = await ensureSettings();

  await db.appSettings.put({
    ...current,
    id: SETTINGS_ID,
    timerSoundEnabled: enabled,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Schaltet das Wachhalten des Bildschirms während einer laufenden Einheit.
 *
 * Wie beim Signalton gilt `undefined` als eingeschaltet, deshalb wird auch
 * hier immer explizit geschrieben.
 */
export async function setKeepScreenAwakeEnabled(enabled: boolean) {
  const current = await ensureSettings();

  await db.appSettings.put({
    ...current,
    id: SETTINGS_ID,
    keepScreenAwakeEnabled: enabled,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Merkt sich, dass eine Sicherung geschrieben wurde.
 *
 * Die Erinnerung auf der Startseite zählt abgeschlossene Trainings, die
 * jünger sind als dieser Zeitpunkt.
 */
export async function markBackupCreated(backupAt = new Date().toISOString()) {
  const current = await ensureSettings();

  await db.appSettings.put({
    ...current,
    id: SETTINGS_ID,
    lastBackupAt: backupAt,
    updatedAt: new Date().toISOString(),
  });
}
