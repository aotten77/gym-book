import { db } from '@/db/appDb';
import { addSentChars, getTtsQuota, readTtsSettings, saveAnnouncement } from '@/db/tts-actions';
import { requiredAnnouncementTexts } from '@/domain/guided-announcements';
import { isGuidedTemplate } from '@/domain/guided-steps';
import { announcementKey, countChars, quotaCostUsd, quotaFits, quotaOver } from '@/domain/tts-quota';
import { MISSING_KEY_MESSAGE, synthesizeSpeech, TtsError, type SynthesizeOptions } from '@/lib/tts-client';

/*
 * Ansagen für geführte Vorlagen: welche fehlen, und die Erzeugung der fehlenden.
 *
 * Der Netzweg ist nur hier und nur fürs Erzeugen offen - der Trainingsablauf
 * ruft nichts davon auf. Die Erzeugung wirft nie: jedes Scheitern ist ein
 * Ergebnis mit anzeigbarer Meldung, damit ein Import nie wegen ihr scheitert.
 */

export const OFFLINE_MESSAGE = 'Offline – Ansagen nicht erzeugt';

export interface AnnouncementAvailability {
  voice: string;
  /** Wie viele verschiedene Sätze die Vorlage braucht. */
  total: number;
  missing: number;
  /** Alle Ansagen mit der aktuellen Stimme da: nur dann ist „Stimme + Ton“ wählbar. */
  complete: boolean;
}

async function loadGuidedTexts(templateIds: readonly string[]): Promise<string[]> {
  const templates = await db.workoutTemplates.bulkGet([...new Set(templateIds)]);
  const texts = new Set<string>();

  for (const template of templates) {
    if (template && isGuidedTemplate(template)) {
      for (const text of requiredAnnouncementTexts(template.steps ?? [])) {
        texts.add(text);
      }
    }
  }

  return [...texts];
}

async function findMissingTexts(texts: readonly string[], voice: string): Promise<string[]> {
  const existing = await db.announcements.bulkGet(texts.map((text) => announcementKey(text, voice)));

  return texts.filter((_, index) => !existing[index]);
}

/** „Alle Ansagen da?“ für eine Vorlage mit der aktuellen Stimme. */
export async function getAnnouncementAvailability(templateId: string): Promise<AnnouncementAvailability> {
  const { voice } = await readTtsSettings();
  const texts = await loadGuidedTexts([templateId]);
  const missing = await findMissingTexts(texts, voice);

  return { voice, total: texts.length, missing: missing.length, complete: texts.length > 0 && missing.length === 0 };
}

export interface OverageInfo {
  chars: number;
  overChars: number;
  costUsd: number;
}

export interface GenerateAnnouncementsOptions {
  /** Fragt nach, wenn die Erzeugung das Freikontingent überschritte. Ohne sie gilt: nein. */
  confirmOverage?: (info: OverageInfo) => Promise<boolean>;
  /** Für Tests: ersetzt den ganzen Client. */
  synth?: (options: SynthesizeOptions) => Promise<Blob>;
  /** Für Tests: ersetzt nur den HTTP-Post des echten Clients. */
  post?: SynthesizeOptions['post'];
  sleep?: SynthesizeOptions['sleep'];
  now?: Date;
  isOnline?: () => boolean;
}

export interface GenerateAnnouncementsResult {
  /** `complete`: alles da (auch nichts zu tun); `declined`: Kosten abgelehnt; `failed`: Fehler. */
  status: 'complete' | 'declined' | 'failed';
  generated: number;
  /** Wie viele Sätze danach noch fehlen. */
  missing: number;
  message?: string;
}

/**
 * Erzeugt die fehlenden Ansagen der Vorlagen nacheinander. Vorhandene Sätze
 * (gleicher Satz, gleiche Stimme) entfallen. Beim ersten Fehler bricht sie
 * ab, schon Erzeugtes bleibt gespeichert.
 */
export async function generateAnnouncements(
  templateIds: readonly string[],
  options: GenerateAnnouncementsOptions = {},
): Promise<GenerateAnnouncementsResult> {
  try {
    const settings = await readTtsSettings();
    const texts = await loadGuidedTexts(templateIds);
    const missing = await findMissingTexts(texts, settings.voice);

    if (missing.length === 0) {
      return { status: 'complete', generated: 0, missing: 0 };
    }

    const fail = (message: string, generated = 0): GenerateAnnouncementsResult => ({
      status: 'failed',
      generated,
      missing: missing.length - generated,
      message,
    });

    if (!settings.apiKey?.trim()) {
      return fail(MISSING_KEY_MESSAGE);
    }

    if (!(options.isOnline ?? (() => navigator.onLine !== false))()) {
      return fail(OFFLINE_MESSAGE);
    }

    const chars = missing.reduce((sum, text) => sum + countChars(text), 0);
    const quota = await getTtsQuota(options.now);

    if (!quotaFits(quota, chars)) {
      const info = { chars, overChars: quotaOver(quota, chars), costUsd: quotaCostUsd(quota, chars) };

      if (!(await options.confirmOverage?.(info))) {
        return { status: 'declined', generated: 0, missing: missing.length };
      }
    }

    const synth = options.synth ?? synthesizeSpeech;
    let generated = 0;

    for (const text of missing) {
      try {
        const blob = await synth({
          apiKey: settings.apiKey,
          voice: settings.voice,
          text,
          post: options.post,
          sleep: options.sleep,
        });

        // Nur was gesendet und beantwortet wurde, zählt - dann erst speichern.
        await addSentChars(countChars(text), options.now);
        await saveAnnouncement(text, settings.voice, blob);
        generated += 1;
      } catch (error) {
        return fail(
          error instanceof TtsError ? error.message : 'Ansagen nicht erzeugt',
          generated,
        );
      }
    }

    return { status: 'complete', generated, missing: 0 };
  } catch {
    return { status: 'failed', generated: 0, missing: 0, message: 'Ansagen nicht erzeugt' };
  }
}
