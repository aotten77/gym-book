import { describe, expect, it, vi } from 'vitest';
import { db } from '@/db/appDb';
import {
  checkApiKey,
  clearApiKey,
  getTtsQuota,
  getTtsView,
  saveAnnouncement,
  saveApiKey,
  updateTtsSettings,
} from '@/db/tts-actions';
import { announcementKey } from '@/domain/tts-quota';
import { TtsError } from '@/lib/tts-client';

const KEY = 'PLATZHALTER-SCHLUESSEL-4321';

describe('Schlüssel', () => {
  it('speichert den Schlüssel und zeigt ihn nur maskiert', async () => {
    await saveApiKey(`  ${KEY}  `);

    const view = await getTtsView(new Date('2026-11-10T10:00:00.000Z'));
    expect(view.keyHint).toBe('••••4321');
    expect(JSON.stringify(view)).not.toContain(KEY);
    expect((await db.ttsConfig.get('tts-config'))?.apiKey).toBe(KEY);
  });

  it('lehnt einen leeren Schlüssel ab', async () => {
    await expect(saveApiKey('   ')).rejects.toThrow('Schlüssel');
  });

  it('löscht den Schlüssel und lässt Einstellungen und Zähler stehen', async () => {
    await saveApiKey(KEY);
    await updateTtsSettings({ freeCharsPerMonth: 500 });

    await clearApiKey();

    const row = await db.ttsConfig.get('tts-config');
    expect(row?.apiKey).toBeUndefined();
    expect(row?.freeCharsPerMonth).toBe(500);
    expect((await getTtsView()).keyHint).toBeUndefined();
  });
});

describe('Einstellungen', () => {
  it('liefert die Standardwerte ohne gespeicherte Zeile', async () => {
    const view = await getTtsView(new Date('2026-11-10T10:00:00.000Z'));

    expect(view).toMatchObject({
      voice: 'de-DE-Chirp3-HD-Iapetus',
      freeCharsPerMonth: 1_000_000,
      pricePerMillionUsd: 30,
      monthChars: 0,
    });
  });

  it('ändert nur die genannten Felder und prüft die Werte', async () => {
    await saveApiKey(KEY);
    await updateTtsSettings({ voice: 'de-DE-Chirp3-HD-Charon' });
    await updateTtsSettings({ pricePerMillionUsd: 16 });

    const row = await db.ttsConfig.get('tts-config');
    expect(row).toMatchObject({ voice: 'de-DE-Chirp3-HD-Charon', pricePerMillionUsd: 16, apiKey: KEY });
    await expect(updateTtsSettings({ freeCharsPerMonth: -1 })).rejects.toThrow();
    await expect(updateTtsSettings({ voice: '  ' })).rejects.toThrow();
  });
});

describe('checkApiKey', () => {
  it('erzeugt eine Testansage und zählt die gesendeten Zeichen in den UTC-Monat', async () => {
    await saveApiKey(KEY);
    const blob = new Blob(['mp3'], { type: 'audio/mpeg' });
    const synth = vi.fn().mockResolvedValue(blob);

    const result = await checkApiKey({ synth, now: new Date('2026-11-30T23:59:00.000Z') });

    expect(result.blob).toBe(blob);
    expect(synth).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: KEY, voice: 'de-DE-Chirp3-HD-Iapetus', text: result.text }),
    );
    expect(result.chars).toBe(result.text.length);

    const november = await getTtsView(new Date('2026-11-30T23:59:00.000Z'));
    const december = await getTtsView(new Date('2026-12-01T00:00:00.000Z'));
    expect(november.monthChars).toBe(result.chars);
    expect(december.monthChars).toBe(0);

    await checkApiKey({ synth, now: new Date('2026-12-01T00:00:00.000Z') });
    expect((await getTtsView(new Date('2026-12-01T00:00:00.000Z'))).monthChars).toBe(result.chars);
    expect((await getTtsView(new Date('2026-11-30T23:59:00.000Z'))).monthChars).toBe(result.chars);
  });

  it('zählt nicht, wenn die Erzeugung scheitert, und reicht die Meldung durch', async () => {
    await saveApiKey(KEY);
    const synth = vi.fn().mockRejectedValue(new TtsError('Ansagen nicht erzeugt'));

    await expect(checkApiKey({ synth })).rejects.toThrow('Ansagen nicht erzeugt');
    expect((await getTtsView()).monthChars).toBe(0);
  });

  it('meldet fehlenden Schlüssel über den echten Client ohne Request', async () => {
    const post = vi.fn();

    await expect(checkApiKey({ post })).rejects.toThrow('Kein Google-Schlüssel – in Einstellungen eintragen');
    expect(post).not.toHaveBeenCalled();
  });

  it('rechnet das Kontingent aus den Einstellungen', async () => {
    await updateTtsSettings({ freeCharsPerMonth: 100, pricePerMillionUsd: 30 });
    await saveApiKey(KEY);
    const now = new Date('2026-11-10T10:00:00.000Z');
    await checkApiKey({ synth: vi.fn().mockResolvedValue(new Blob(['x'])), now });

    const quota = await getTtsQuota(now);
    const used = (await getTtsView(now)).monthChars;
    expect(quota.freeLeft).toBe(100 - used);
  });
});

describe('Ansagen', () => {
  it('speichert eine Ansage unter Stimme und Satz und teilt gleiche Sätze', async () => {
    const blob = new Blob(['mp3-bytes'], { type: 'audio/mpeg' });

    await saveAnnouncement('Als Nächstes: Taube', 'v1', blob);
    await saveAnnouncement('Als Nächstes: Taube', 'v1', new Blob(['andere'], { type: 'audio/mpeg' }));
    await saveAnnouncement('Als Nächstes: Taube', 'v2', blob);

    expect(await db.announcements.count()).toBe(2);
    const stored = await db.announcements.get(announcementKey('Als Nächstes: Taube', 'v1'));
    expect(stored).toMatchObject({ text: 'Als Nächstes: Taube', voice: 'v1', byteSize: 9 });
    expect(stored?.createdAt).toBeTruthy();
  });

  it('ersetzt eine Ansage ohne Dauer, sobald eine gemessene kommt', async () => {
    const id = announcementKey('Als Nächstes: Beispiel A', 'v1');

    await saveAnnouncement('Als Nächstes: Beispiel A', 'v1', new Blob(['alt'], { type: 'audio/mpeg' }));
    expect((await db.announcements.get(id))?.durationMs).toBeUndefined();

    await saveAnnouncement('Als Nächstes: Beispiel A', 'v1', new Blob(['neuer'], { type: 'audio/mpeg' }), 9_000);
    expect(await db.announcements.get(id)).toMatchObject({ durationMs: 9_000, byteSize: 5 });
  });

  it('lässt eine Ansage mit Dauer beim zweiten Speichern unverändert', async () => {
    const id = announcementKey('Als Nächstes: Beispiel A', 'v1');

    await saveAnnouncement('Als Nächstes: Beispiel A', 'v1', new Blob(['erst'], { type: 'audio/mpeg' }), 9_000);
    const first = await db.announcements.get(id);

    await saveAnnouncement('Als Nächstes: Beispiel A', 'v1', new Blob(['zweite'], { type: 'audio/mpeg' }), 4_000);
    await saveAnnouncement('Als Nächstes: Beispiel A', 'v1', new Blob(['dritte'], { type: 'audio/mpeg' }));

    expect(await db.announcements.get(id)).toEqual(first);
  });
});
