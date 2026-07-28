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

