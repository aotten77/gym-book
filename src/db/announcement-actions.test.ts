import { describe, expect, it, vi } from 'vitest';
import { db } from '@/db/appDb';
import {
  generateAnnouncements,
  getAnnouncementAvailability,
  getStepsAnnouncementAvailability,
  loadAnnouncementAudio,
  OFFLINE_MESSAGE,
} from '@/db/announcement-actions';
import { saveApiKey, updateTtsSettings, getTtsView } from '@/db/tts-actions';
import type { GuidedStep } from '@/domain/models';
import { announcementKey } from '@/domain/tts-quota';
import { TtsError, type TtsPost } from '@/lib/tts-client';

const KEY = 'PLATZHALTER-SCHLUESSEL-4321';
const STAMP = '2026-10-01T00:00:00.000Z';
const VOICE = 'de-DE-Chirp3-HD-Iapetus';
const ONLINE = () => true;

async function seed(id: string, steps: GuidedStep[]) {
  await db.workoutTemplates.add({
    id,
    name: id,
    category: 'yoga',
    steps,
    createdAt: STAMP,
    updatedAt: STAMP,
  });
}

const blob = () => new Blob(['mp3'], { type: 'audio/mpeg' });

// A: 2 Sätze + Geschafft. = 3
const A: GuidedStep[] = [
  { name: 'Hund', seconds: 60 },
  { name: 'Kind', seconds: 60 },
];
// B teilt „Hund, 60 Sekunden“ und „Geschafft.“ mit A, bringt 1 neuen Satz.
const B: GuidedStep[] = [
  { name: 'Hund', seconds: 60 },
  { name: 'Brücke', seconds: 30 },
];

describe('Verfügbarkeit', () => {
  it('meldet fehlende Ansagen und vollständige Vorlagen pro Stimme', async () => {
    await seed('a', A);

    expect(await getAnnouncementAvailability('a')).toMatchObject({ total: 3, missing: 3, complete: false });

    await saveApiKey(KEY);
    const result = await generateAnnouncements(['a'], { synth: async () => blob(), isOnline: ONLINE });

    expect(result).toMatchObject({ status: 'complete', generated: 3, missing: 0 });
    expect(await getAnnouncementAvailability('a')).toMatchObject({ missing: 0, complete: true });

    await updateTtsSettings({ voice: 'de-DE-Chirp3-HD-Charon' });
    expect(await getAnnouncementAvailability('a')).toMatchObject({ missing: 3, complete: false });
  });

  it('ist für eine unbekannte oder nicht geführte Vorlage nie vollständig', async () => {
    expect(await getAnnouncementAvailability('gibt-es-nicht')).toMatchObject({ total: 0, complete: false });
  });
});

describe('generateAnnouncements', () => {
  it('teilt gleiche Sätze über Vorlagen hinweg und erzeugt nur die fehlenden', async () => {
    await seed('a', A);
    await seed('b', B);
    await saveApiKey(KEY);
    const synth = vi.fn(async () => blob());

    await generateAnnouncements(['a'], { synth, isOnline: ONLINE });
    expect(synth).toHaveBeenCalledTimes(3);

    synth.mockClear();
    const result = await generateAnnouncements(['a', 'b'], { synth, isOnline: ONLINE });

    expect(result.generated).toBe(1);
    expect(synth).toHaveBeenCalledTimes(1);
    expect(synth).toHaveBeenCalledWith(expect.objectContaining({ text: 'Als Nächstes: Brücke, 30 Sekunden' }));
    expect(await db.announcements.count()).toBe(4);
  });

  it('erzeugt nichts, wenn schon alles da ist', async () => {
    await seed('a', A);
    await saveApiKey(KEY);
    const synth = vi.fn(async () => blob());

    await generateAnnouncements(['a'], { synth, isOnline: ONLINE });
    synth.mockClear();

    expect(await generateAnnouncements(['a'], { synth, isOnline: ONLINE })).toMatchObject({
      status: 'complete',
      generated: 0,
    });
    expect(synth).not.toHaveBeenCalled();
  });

  it('bricht beim ersten Fehler ab und behält Erzeugtes samt Zähler', async () => {
    await seed('a', A);
    await saveApiKey(KEY);
    const synth = vi
      .fn()
      .mockResolvedValueOnce(blob())
      .mockRejectedValueOnce(new TtsError('API key not valid'))
      .mockResolvedValue(blob());

    const result = await generateAnnouncements(['a'], { synth, isOnline: ONLINE });

    expect(result).toMatchObject({ status: 'failed', generated: 1, missing: 2, message: 'API key not valid' });
    expect(synth).toHaveBeenCalledTimes(2);
    expect(await db.announcements.count()).toBe(1);
    expect((await getTtsView()).monthChars).toBe('Als Nächstes: Hund, 60 Sekunden'.length);
  });

  it('sendet ohne Schlüssel nichts', async () => {
    await seed('a', A);
    const post = vi.fn();

    const result = await generateAnnouncements(['a'], { post, isOnline: ONLINE });

    expect(result).toMatchObject({ status: 'failed', generated: 0, missing: 3 });
    expect(result.message).toContain('Kein Google-Schlüssel');
    expect(post).not.toHaveBeenCalled();
  });

  it('sendet offline nichts', async () => {
    await seed('a', A);
    await saveApiKey(KEY);
    const post = vi.fn();

    const result = await generateAnnouncements(['a'], { post, isOnline: () => false });

    expect(result).toMatchObject({ status: 'failed', message: OFFLINE_MESSAGE });
    expect(post).not.toHaveBeenCalled();
  });

  it('zeigt bei Googles 4xx die Meldung ohne Schlüssel', async () => {
    await seed('a', A);
    await saveApiKey(KEY);
    const post: TtsPost = vi.fn(async () => ({
      status: 403,
      body: JSON.stringify({ error: { message: `denied for ${KEY}` } }),
    }));

    const result = await generateAnnouncements(['a'], { post, isOnline: ONLINE });

    expect(result.status).toBe('failed');
    expect(result.message).toContain('denied');
    expect(result.message).not.toContain(KEY);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('fragt bei Überschreitung des Freikontingents nach, und ein Nein sendet nichts', async () => {
    await seed('a', A);
    await saveApiKey(KEY);
    await updateTtsSettings({ freeCharsPerMonth: 10, pricePerMillionUsd: 30 });
    const synth = vi.fn(async () => blob());
    const confirmOverage = vi.fn(async () => false);

    const result = await generateAnnouncements(['a'], { synth, confirmOverage, isOnline: ONLINE });

    expect(result).toMatchObject({ status: 'declined', generated: 0, missing: 3 });
    expect(synth).not.toHaveBeenCalled();
    expect(confirmOverage).toHaveBeenCalledWith(
      expect.objectContaining({ chars: expect.any(Number), overChars: expect.any(Number), costUsd: expect.any(Number) }),
    );

    // Ohne Rückfrage-Funktion gilt ebenfalls: nein.
    expect((await generateAnnouncements(['a'], { synth, isOnline: ONLINE })).status).toBe('declined');
    expect(synth).not.toHaveBeenCalled();

    // Ja: es wird erzeugt.
    const accepted = await generateAnnouncements(['a'], {
      synth,
      confirmOverage: async () => true,
      isOnline: ONLINE,
    });
    expect(accepted).toMatchObject({ status: 'complete', generated: 3 });
  });

  it('fragt nicht nach, solange das Kontingent reicht, und speichert unter Satz und Stimme', async () => {
    await seed('a', A);
    await saveApiKey(KEY);
    const confirmOverage = vi.fn(async () => false);

    await generateAnnouncements(['a'], { synth: async () => blob(), confirmOverage, isOnline: ONLINE });

    expect(confirmOverage).not.toHaveBeenCalled();
    expect(await db.announcements.get(announcementKey('Geschafft.', VOICE))).toBeTruthy();
  });
});

describe('Ansagen bei einer Schrittanpassung', () => {
  const STEPS: GuidedStep[] = [
    { name: 'Hund', seconds: 60 },
    { name: 'Taubenpose', seconds: 60 },
  ];
  const IN_PHASE = new Date(2026, 11, 1, 18, 0, 0);
  const BEFORE = new Date(2026, 10, 24, 18, 0, 0);

  async function seedAdjustment() {
    await seed('t', STEPS);
    await db.restrictions.add({
      id: 'r1',
      name: 'Beispiel A',
      from: '2026-12-01',
      until: '2026-12-14',
      pauses: [],
      adjustments: [{ stepName: 'Taubenpose', templateId: 't', seconds: 30 }],
      createdAt: STAMP,
      updatedAt: STAMP,
    });
  }

  it('verlangt am Tag der Anpassung zusätzlich den Satz mit den angepassten Sekunden', async () => {
    await seedAdjustment();

    expect(await getAnnouncementAvailability('t', IN_PHASE)).toMatchObject({ total: 4, missing: 4 });

    await saveApiKey(KEY);
    const texts: string[] = [];
    await generateAnnouncements(['t'], {
      synth: async ({ text }) => {
        texts.push(text);
        return blob();
      },
      isOnline: ONLINE,
      now: IN_PHASE,
    });

    expect(texts).toContain('Als Nächstes: Taubenpose, 30 Sekunden');
    expect(texts).toContain('Als Nächstes: Taubenpose, 60 Sekunden');
    expect(await getAnnouncementAvailability('t', IN_PHASE)).toMatchObject({ missing: 0, complete: true });
  });

  it('bleibt ohne wirksame Einschränkung unverändert', async () => {
    await seedAdjustment();

    expect(await getAnnouncementAvailability('t', BEFORE)).toMatchObject({ total: 3, missing: 3 });
  });
});

describe('Ansagen einer laufenden Einheit (Schritt-Snapshot)', () => {
  it('prüft die Verfügbarkeit an den Schritten, ohne die Vorlage zu lesen', async () => {
    expect(await getStepsAnnouncementAvailability(A)).toMatchObject({ total: 3, missing: 3, complete: false });

    await saveApiKey(KEY);
    await generateAnnouncements([], { synth: async () => blob(), isOnline: ONLINE });
    await seed('a', A);
    await generateAnnouncements(['a'], { synth: async () => blob(), isOnline: ONLINE });
    // Die Vorlage darf weg sein: der Snapshot genügt.
    await db.workoutTemplates.delete('a');

    expect(await getStepsAnnouncementAvailability(A)).toMatchObject({ missing: 0, complete: true });
  });

  it('lädt die Puffer je Satz als ArrayBuffer und nur, wenn alle da sind', async () => {
    await seed('a', A);
    expect(await loadAnnouncementAudio(A)).toBeNull();

    await saveApiKey(KEY);
    await generateAnnouncements(['a'], { synth: async () => blob(), isOnline: ONLINE });

    const audio = await loadAnnouncementAudio(A);

    expect(audio).not.toBeNull();
    expect([...audio!.keys()].sort()).toEqual(
      ['Als Nächstes: Hund, 60 Sekunden', 'Als Nächstes: Kind, 60 Sekunden', 'Geschafft.'].sort(),
    );
    expect(audio!.get('Geschafft.')!.byteLength).toBe(3);
  });
});

describe('Anleitung', () => {
  const GUIDE = 'Erfundener Beispieltext zum Einstieg.';
  const G: GuidedStep[] = [
    { name: 'Beispiel A', seconds: 40, guidance: GUIDE },
    { name: 'Beispiel B', seconds: 30 },
  ];
  const GUIDED_TEXT = `Als Nächstes: Beispiel A, 40 Sekunden. ${GUIDE}`;

  it('erzeugt beide Varianten und speichert die gemessene Dauer', async () => {
    await seed('g', G);
    await saveApiKey(KEY);
    const result = await generateAnnouncements(['g'], {
      synth: async () => blob(),
      isOnline: ONLINE,
      measure: async () => 12_000,
    });

    // 2 Sätze ohne Anleitung + Geschafft. + 1 Satz mit Anleitung
    expect(result).toMatchObject({ status: 'complete', generated: 4 });
    expect((await db.announcements.get(announcementKey(GUIDED_TEXT, VOICE)))?.durationMs).toBe(12_000);
  });

  it('erzeugt einen Anleitungssatz ohne Dauer beim nächsten Lauf neu und speichert ihn mit Dauer', async () => {
    await seed('g', G);
    await saveApiKey(KEY);
    await generateAnnouncements(['g'], {
      synth: async () => blob(),
      isOnline: ONLINE,
      measure: async () => null,
    });
    expect((await db.announcements.get(announcementKey(GUIDED_TEXT, VOICE)))?.durationMs).toBeUndefined();

    const second = await generateAnnouncements(['g'], {
      synth: async () => blob(),
      isOnline: ONLINE,
      measure: async () => 9_000,
    });

    expect(second).toMatchObject({ status: 'complete', generated: 1 });
    expect((await db.announcements.get(announcementKey(GUIDED_TEXT, VOICE)))?.durationMs).toBe(9_000);
  });

  it('meldet die Anleitung als verfügbar, vollständig und mit Gesamtdauer', async () => {
    await seed('g', G);
    expect((await getAnnouncementAvailability('g')).guidance).toEqual({ available: true, complete: false });

    await saveApiKey(KEY);
    await generateAnnouncements(['g'], {
      synth: async () => blob(),
      isOnline: ONLINE,
      measure: async () => 12_000,
    });

    // Wechsel 15 + 40 + Wechsel 5 + 30 = 90
    expect((await getAnnouncementAvailability('g')).guidance).toEqual({
      available: true,
      complete: true,
      totalSeconds: 90,
    });
  });

  it('kennt keine Anleitung bei Vorlagen ohne guidance', async () => {
    await seed('a', A);

    expect((await getAnnouncementAvailability('a')).guidance).toEqual({ available: false, complete: false });
  });

  it('meldet eine ungemessene Anleitung als unvollständig, Stimme + Ton bleibt wählbar', async () => {
    await seed('g', G);
    await saveApiKey(KEY);
    await generateAnnouncements(['g'], {
      synth: async () => blob(),
      isOnline: ONLINE,
      measure: async () => null,
    });

    const availability = await getAnnouncementAvailability('g');

    expect(availability).toMatchObject({ total: 3, missing: 0, complete: true });
    expect(availability.guidance).toEqual({ available: true, complete: false });
  });

  it('misst bei einer Schrittanpassung den wirksamen Satz', async () => {
    const IN_PHASE = new Date(2026, 11, 1, 18, 0, 0);

    await seed('g', G);
    await db.restrictions.add({
      id: 'r1',
      name: 'Beispiel R',
      from: '2026-12-01',
      until: '2026-12-14',
      pauses: [],
      adjustments: [{ stepName: 'Beispiel A', templateId: 'g', seconds: 20 }],
      createdAt: STAMP,
      updatedAt: STAMP,
    });
    await saveApiKey(KEY);
    const texts: string[] = [];
    await generateAnnouncements(['g'], {
      synth: async ({ text }) => {
        texts.push(text);
        return blob();
      },
      isOnline: ONLINE,
      now: IN_PHASE,
      measure: async () => 12_000,
    });

    expect(texts).toContain(`Als Nächstes: Beispiel A, 20 Sekunden. ${GUIDE}`);
    // Wechsel 15 + 20 + Wechsel 5 + 30 = 70
    expect((await getAnnouncementAvailability('g', IN_PHASE)).guidance).toEqual({
      available: true,
      complete: true,
      totalSeconds: 70,
    });
  });

  it('braucht für Sätze ohne Anleitung keine Dauer', async () => {
    await seed('a', A);
    await saveApiKey(KEY);
    await generateAnnouncements(['a'], {
      synth: async () => blob(),
      isOnline: ONLINE,
      measure: async () => null,
    });

    expect(
      await generateAnnouncements(['a'], { synth: async () => blob(), isOnline: ONLINE }),
    ).toMatchObject({ status: 'complete', generated: 0 });
  });
});
