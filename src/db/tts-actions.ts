import { db } from '@/db/appDb';
import type { TtsConfig } from '@/domain/models';
import {
  announcementKey,
  countChars,
  createQuota,
  DEFAULT_FREE_CHARS_PER_MONTH,
  DEFAULT_PRICE_PER_MILLION_USD,
  DEFAULT_TTS_LANGUAGE,
  DEFAULT_TTS_VOICE,
  maskApiKey,
  utcMonthKey,
  type Quota,
} from '@/domain/tts-quota';
import { toStorableBlob } from '@/lib/media';
import { synthesizeSpeech, type SynthesizeOptions } from '@/lib/tts-client';

/*
 * Schlüssel, TTS-Einstellungen, Zeichenzähler und Ansagen liegen außerhalb von
 * `appSettings` und kommen weder in Backup noch Restore noch Analyse-Export
 * (`lib/export.ts` liest diese Tabellen nicht). Der Schlüssel verlässt diese
 * Datei nur in Richtung TTS-Client; die Oberfläche bekommt ihn nie zu sehen,
 * nur die maskierte Anzeige aus [getTtsView].
 */

const CONFIG_ID = 'tts-config';
export const CHECK_TEXT = 'Die Sprachausgabe funktioniert.';

function defaultConfig(): TtsConfig {
  return {
    id: CONFIG_ID,
    voice: DEFAULT_TTS_VOICE,
    languageCode: DEFAULT_TTS_LANGUAGE,
    freeCharsPerMonth: DEFAULT_FREE_CHARS_PER_MONTH,
    pricePerMillionUsd: DEFAULT_PRICE_PER_MILLION_USD,
    charsByMonth: {},
    updatedAt: new Date().toISOString(),
  };
}

async function readConfig(): Promise<TtsConfig> {
  return (await db.ttsConfig.get(CONFIG_ID)) ?? defaultConfig();
}

/**
 * Read-Modify-Write auf die eine Zeile, geklammert wie `updateSettings`. Es wird
 * die ganze Zeile geschrieben (`put`), nie `update` mit `undefined` - das
 * löschte Felder.
 */
async function changeConfig(change: (current: TtsConfig) => TtsConfig) {
  await db.transaction('rw', db.ttsConfig, async () => {
    const next = change(await readConfig());

    await db.ttsConfig.put({ ...next, id: CONFIG_ID, updatedAt: new Date().toISOString() });
  });
}

export interface TtsView {
  /** Maskiert, nur die letzten vier Zeichen; `undefined`, wenn kein Schlüssel da ist. */
  keyHint?: string;
  voice: string;
  freeCharsPerMonth: number;
  pricePerMillionUsd: number;
  /** Gesendete Zeichen im UTC-Monat von `now`. */
  monthChars: number;
}

export async function getTtsView(now: Date = new Date()): Promise<TtsView> {
  const config = await readConfig();

  return {
    keyHint: config.apiKey ? maskApiKey(config.apiKey) : undefined,
    voice: config.voice,
    freeCharsPerMonth: config.freeCharsPerMonth,
    pricePerMillionUsd: config.pricePerMillionUsd,
    monthChars: config.charsByMonth[utcMonthKey(now)] ?? 0,
  };
}

export async function getTtsQuota(now: Date = new Date()): Promise<Quota> {
  const config = await readConfig();

  return createQuota(config.charsByMonth, now, config.freeCharsPerMonth, config.pricePerMillionUsd);
}

export async function saveApiKey(key: string) {
  const trimmed = key.trim();

  if (!trimmed) {
    throw new Error('Bitte einen Schlüssel eintragen.');
  }

  await changeConfig((current) => ({ ...current, apiKey: trimmed }));
}

export async function clearApiKey() {
  await changeConfig((current) => {
    const next = { ...current };

    delete next.apiKey;

    return next;
  });
}

export async function updateTtsSettings(changes: {
  voice?: string;
  freeCharsPerMonth?: number;
  pricePerMillionUsd?: number;
}) {
  if (changes.voice !== undefined && !changes.voice.trim()) {
    throw new Error('Bitte eine Stimme angeben.');
  }

  for (const value of [changes.freeCharsPerMonth, changes.pricePerMillionUsd]) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw new Error('Bitte eine Zahl ab 0 angeben.');
    }
  }

  await changeConfig((current) => ({
    ...current,
    ...(changes.voice !== undefined ? { voice: changes.voice.trim() } : {}),
    ...(changes.freeCharsPerMonth !== undefined
      ? { freeCharsPerMonth: Math.floor(changes.freeCharsPerMonth) }
      : {}),
    ...(changes.pricePerMillionUsd !== undefined ? { pricePerMillionUsd: changes.pricePerMillionUsd } : {}),
  }));
}

/** Zählt tatsächlich gesendete Zeichen in den UTC-Monat von `now`. */
export async function addSentChars(chars: number, now: Date = new Date()) {
  const month = utcMonthKey(now);

  await changeConfig((current) => ({
    ...current,
    charsByMonth: { ...current.charsByMonth, [month]: (current.charsByMonth[month] ?? 0) + chars },
  }));
}

type Synthesize = (options: SynthesizeOptions) => Promise<Blob>;

export interface CheckApiKeyOptions {
  /** Für Tests: ersetzt den ganzen Client. */
  synth?: Synthesize;
  /** Für Tests: ersetzt nur den HTTP-Post des echten Clients. */
  post?: SynthesizeOptions['post'];
  now?: Date;
}

/**
 * "Schlüssel prüfen": erzeugt eine Testansage mit dem gespeicherten Schlüssel
 * und zählt sie ins Kontingent. Wirft `TtsError` mit anzeigbarer Meldung; bei
 * einem Fehler wird nichts gezählt.
 */
export async function checkApiKey(options: CheckApiKeyOptions = {}) {
  const config = await readConfig();
  const synth = options.synth ?? synthesizeSpeech;
  const blob = await synth({
    apiKey: config.apiKey,
    voice: config.voice,
    text: CHECK_TEXT,
    post: options.post,
  });
  const chars = countChars(CHECK_TEXT);

  await addSentChars(chars, options.now);

  return { blob, text: CHECK_TEXT, chars };
}

/** Speichert eine Ansage; ein vorhandener Satz mit gleicher Stimme bleibt unverändert. */
export async function saveAnnouncement(text: string, voice: string, blob: Blob) {
  const id = announcementKey(text, voice);
  // Vor der Transaktion: ein `await` auf Nicht-Dexie-Arbeit schlösse sie früh.
  const stored = await toStorableBlob(blob);

  await db.transaction('rw', db.announcements, async () => {
    if (await db.announcements.get(id)) {
      return;
    }

    await db.announcements.add({
      id,
      text,
      voice,
      blob: stored,
      byteSize: stored.size,
      createdAt: new Date().toISOString(),
    });
  });
}
