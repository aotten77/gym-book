import { describe, expect, it } from 'vitest';
import { db } from '@/db/appDb';
import { ensureSettings, SETTINGS_ID } from '@/db/normalize';
import { markAnalysisCopied, markBackupCreated } from '@/db/settings-actions';

describe('settings-actions', () => {
  it('markAnalysisCopied setzt lastAnalysisCopiedAt und lässt lastBackupAt unverändert', async () => {
    await ensureSettings();
    await markBackupCreated('2026-11-01T08:00:00.000Z');

    await markAnalysisCopied('2026-11-17T09:30:00.000Z');

    const settings = await db.appSettings.get(SETTINGS_ID);
    expect(settings?.lastAnalysisCopiedAt).toBe('2026-11-17T09:30:00.000Z');
    expect(settings?.lastBackupAt).toBe('2026-11-01T08:00:00.000Z');
  });

  it('markBackupCreated fasst lastAnalysisCopiedAt nicht an', async () => {
    await markAnalysisCopied('2026-11-17T09:30:00.000Z');
    await markBackupCreated('2026-11-18T08:00:00.000Z');

    const settings = await db.appSettings.get(SETTINGS_ID);
    expect(settings?.lastAnalysisCopiedAt).toBe('2026-11-17T09:30:00.000Z');
  });
});
