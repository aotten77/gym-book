import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/appDb';
import { saveAnnouncement, saveApiKey, updateTtsSettings } from '@/db/tts-actions';
import {
  copyAnalysisSnapshot,
  exportAnalysisSnapshot,
  exportDatabaseSnapshot,
  parseDatabaseSnapshot,
  restoreDatabaseSnapshot,
} from '@/lib/export';

/*
 * Schlüssel, TTS-Einstellungen, Zähler und Ansagen gehören nicht ins Backup und
 * nicht in den Analyse-Export. Der Schlüssel ist ein offensichtlicher Platzhalter.
 */
const KEY = 'PLATZHALTER-NICHT-EXPORTIEREN-7788';
const ANNOUNCEMENT = 'Als Nächstes: Taube, links, 75 Sekunden';

async function seed() {
  await saveApiKey(KEY);
  await updateTtsSettings({ voice: 'de-DE-Chirp3-HD-Charon' });
  await saveAnnouncement(ANNOUNCEMENT, 'de-DE-Chirp3-HD-Charon', new Blob(['MP3-INHALT-XYZ'], { type: 'audio/mpeg' }));
}

function readAsLatin1(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('nicht lesbar'));
    reader.readAsBinaryString(file);
  });
}

function captureDownload() {
  const captured: { file?: File } = {};

  URL.createObjectURL = vi.fn((file: Blob) => {
    captured.file = file as File;

    return 'blob:test';
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

  return captured;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Sprachausgabe bleibt außerhalb von Backup und Analyse', () => {
  it('Backup-Datei enthält weder Schlüssel noch Einstellungen noch Ansagen', async () => {
    await seed();
    const captured = captureDownload();

    await exportDatabaseSnapshot();

    const text = await readAsLatin1(captured.file!);
    expect(text.length).toBeGreaterThan(10);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain('7788');
    expect(text).not.toContain('Charon');
    expect(text).not.toContain('Taube');
    expect(text).not.toContain('tts');
    expect(text).not.toContain('announcements');
    expect(Object.keys(JSON.parse(text))).not.toContain('ttsConfig');
  });

  it('Analyse-Export (Archiv und Text) enthält den Schlüssel nicht', async () => {
    await seed();
    const captured = captureDownload();

    await exportAnalysisSnapshot();
    const archive = await readAsLatin1(captured.file!);
    expect(archive).not.toContain(KEY);
    expect(archive).not.toContain('Taube');

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await copyAnalysisSnapshot();
    expect(writeText).toHaveBeenCalledTimes(1);
    const pasted = String(writeText.mock.calls[0][0]);
    expect(pasted.length).toBeGreaterThan(10);
    expect(pasted).not.toContain(KEY);
    expect(pasted).not.toContain('Taube');
  });

  it('Import ignoriert eingeschleuste TTS-Felder, und Restore lässt Schlüssel und Ansagen unberührt', async () => {
    await seed();
    const smuggled = JSON.stringify({
      schemaVersion: 1,
      exportedAt: '2026-11-01T00:00:00.000Z',
      exercises: [],
      workoutTemplates: [],
      workoutTemplateExercises: [],
      workoutSessions: [],
      workoutSessionExercises: [],
      workoutSetLogs: [],
      exerciseTests: [],
      programs: [],
      programWeeks: [],
      progressionRules: [],
      mediaAssets: [],
      appSettings: [],
      ttsConfig: [{ id: 'tts-config', apiKey: 'PLATZHALTER-EINGESCHLEUSERT' }],
      announcements: [{ id: 'x', text: 'fremd' }],
    });

    const snapshot = parseDatabaseSnapshot(smuggled);
    expect(Object.keys(snapshot)).not.toContain('ttsConfig');
    expect(Object.keys(snapshot)).not.toContain('announcements');

    await restoreDatabaseSnapshot(snapshot);

    expect((await db.ttsConfig.get('tts-config'))?.apiKey).toBe(KEY);
    expect(await db.announcements.count()).toBe(1);
    expect((await db.announcements.toArray())[0].text).toBe(ANNOUNCEMENT);
  });
});
