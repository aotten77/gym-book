import { db } from '@/db/appDb';
import { loadRestrictions } from '@/db/restriction-actions';
import { addSentChars, getTtsQuota, readTtsSettings, saveAnnouncement } from '@/db/tts-actions';
import {
  applyGuidance,
  requiredAnnouncementTexts,
  requiredGuidanceTexts,
} from '@/domain/guided-announcements';
import type { GuidedStep } from '@/domain/models';
import { isGuidedTemplate, resolveGuidedSections, sumGuidedSeconds } from '@/domain/guided-steps';
import { toDateInputValue } from '@/domain/program';
import { resolveGuidedSteps } from '@/domain/restriction';
import { announcementKey, countChars, quotaCostUsd, quotaFits, quotaOver } from '@/domain/tts-quota';
import { measureAudioDuration } from '@/lib/announcement-audio';
import { readBlobBuffer } from '@/lib/media';
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
  /**
   * Die gesprochene Anleitung, getrennt gezählt: `total`, `missing` und
   * `complete` oben meinen nur die Sätze ohne Anleitung, damit „Stimme + Ton“
   * nicht an einer fehlenden Anleitung hängt.
   */
  guidance: GuidanceAvailability;
}

export interface GuidanceAvailability {
  /** Mindestens ein (wirksamer) Schritt hat eine Anleitung. */
  available: boolean;
  /** Alle Anleitungssätze da und gemessen. */
  complete: boolean;
  /** Gesamtdauer der Einheit in Sekunden mit Anleitung; nur bei `complete`. */
  totalSeconds?: number;
}

const NO_GUIDANCE: GuidanceAvailability = { available: false, complete: false };

/**
 * Die Sätze der Vorlagen: die ihrer Schritte plus die der am Tag `now`
 * wirksamen Schritte - eine Schrittanpassung ändert die Sekunden und damit
 * den Satz („Als Nächstes: Taubenpose, 30 Sekunden“).
 *
 * `guidanceTexts` sind die Sätze mit angehängter Anleitung, getrennt von
 * `texts`. Erzeugt werden beide, damit der Schalter „Mit Anleitung“ ohne
 * zweiten Erzeugungslauf nutzbar ist. `effectiveSteps` sind die wirksamen
 * Schritte je Vorlage - für die Gesamtdauer mit Anleitung.
 */
async function loadGuidedTexts(
  templateIds: readonly string[],
  now: Date,
): Promise<{
  texts: string[];
  guidanceTexts: string[];
  effectiveSteps: Map<string, GuidedStep[]>;
}> {
  const templates = await db.workoutTemplates.bulkGet([...new Set(templateIds)]);
  const restrictions = await loadRestrictions();
  const day = toDateInputValue(now);
  const texts = new Set<string>();
  const guidanceTexts = new Set<string>();
  const effectiveSteps = new Map<string, GuidedStep[]>();

  for (const template of templates) {
    if (template && isGuidedTemplate(template)) {
      const steps = template.steps ?? [];
      const effective = resolveGuidedSteps({ restrictions, day, templateId: template.id, steps }).steps;

      effectiveSteps.set(template.id, effective);

      for (const text of [...requiredAnnouncementTexts(steps), ...requiredAnnouncementTexts(effective)]) {
        texts.add(text);
      }

      for (const { text } of [...requiredGuidanceTexts(steps), ...requiredGuidanceTexts(effective)]) {
        guidanceTexts.add(text);
      }
    }
  }

  return { texts: [...texts], guidanceTexts: [...guidanceTexts], effectiveSteps };
}

/**
 * Fehlend ist ein Satz ohne Datensatz - und ein Anleitungssatz ohne
 * gemessene Dauer: ohne sie lässt sich der Wechsel nicht festlegen.
 */
async function findMissingTexts(
  texts: readonly string[],
  voice: string,
  guidanceTexts: readonly string[] = [],
): Promise<string[]> {
  const existing = await db.announcements.bulkGet(texts.map((text) => announcementKey(text, voice)));
  const needsDuration = new Set(guidanceTexts);

  return texts.filter((text, index) => {
    const record = existing[index];

    return !record || (needsDuration.has(text) && record.durationMs === undefined);
  });
}

async function describeAvailability(
  texts: readonly string[],
  voice: string,
  guidance: GuidanceAvailability,
): Promise<AnnouncementAvailability> {
  const missing = await findMissingTexts(texts, voice);

  return {
    voice,
    total: texts.length,
    missing: missing.length,
    complete: texts.length > 0 && missing.length === 0,
    guidance,
  };
}

/**
 * Die gemessenen Längen der Sätze, je Satz - nur Sätze mit Datensatz **und**
 * Dauer. Reiner Lesezugriff: gemessen wird nur beim Erzeugen.
 */
export async function loadGuidanceDurations(
  texts: readonly string[],
  voice: string,
): Promise<Map<string, number>> {
  const records = await db.announcements.bulkGet(texts.map((text) => announcementKey(text, voice)));
  const durations = new Map<string, number>();

  for (const [index, record] of records.entries()) {
    if (record?.durationMs !== undefined) {
      durations.set(texts[index], record.durationMs);
    }
  }

  return durations;
}

async function describeGuidance(
  steps: readonly GuidedStep[],
  voice: string,
): Promise<GuidanceAvailability> {
  const texts = requiredGuidanceTexts(steps).map((entry) => entry.text);

  if (texts.length === 0) {
    return NO_GUIDANCE;
  }

  const withGuidance = applyGuidance(steps, await loadGuidanceDurations(texts, voice));

  return withGuidance
    ? { available: true, complete: true, totalSeconds: sumGuidedSeconds(resolveGuidedSections(withGuidance)) }
    : { available: true, complete: false };
}

/** „Alle Ansagen da?“ für eine Vorlage mit der aktuellen Stimme, am Tag `now`. */
export async function getAnnouncementAvailability(
  templateId: string,
  now: Date = new Date(),
): Promise<AnnouncementAvailability> {
  const { voice } = await readTtsSettings();
  const { texts, effectiveSteps } = await loadGuidedTexts([templateId], now);
  // Die Anleitung des Tages: eine Schrittanpassung ändert ihren Satz und ihre Länge.
  const guidance = await describeGuidance(effectiveSteps.get(templateId) ?? [], voice);

  return describeAvailability(texts, voice, guidance);
}

/**
 * Dasselbe für die Schritte einer laufenden Einheit: sie trägt ihren eigenen
 * Snapshot, und die Vorlage darf inzwischen anders aussehen oder fehlen.
 */
export async function getStepsAnnouncementAvailability(
  steps: readonly GuidedStep[],
): Promise<AnnouncementAvailability> {
  const { voice } = await readTtsSettings();

  // Die Sätze eines Snapshots mit `guidanceSeconds` enthalten die Anleitung schon.
  return describeAvailability(requiredAnnouncementTexts(steps), voice, NO_GUIDANCE);
}

/**
 * Die MP3-Daten aller Ansagen einer Einheit, je Satz - oder `null`, wenn auch
 * nur eine fehlt (dann gibt es kein „Stimme + Ton“). Reiner Lesezugriff auf
 * IndexedDB: im Ablauf geht nichts ins Netz. Die Puffer sind Kopien, weil
 * `decodeAudioData` seinen Puffer ablöst.
 */
export async function loadAnnouncementAudio(
  steps: readonly GuidedStep[],
): Promise<Map<string, ArrayBuffer> | null> {
  const { voice } = await readTtsSettings();
  const texts = requiredAnnouncementTexts(steps);
  const records = await db.announcements.bulkGet(texts.map((text) => announcementKey(text, voice)));
  const audio = new Map<string, ArrayBuffer>();

  for (const [index, record] of records.entries()) {
    if (!record) {
      return null;
    }

    audio.set(texts[index], record.audio.slice(0));
  }

  return audio;
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
  /** Für Tests: ersetzt die Messung der MP3-Länge. */
  measure?: (data: ArrayBuffer) => Promise<number | null>;
}

export interface GenerateAnnouncementsResult {
  /** `complete`: alles da (auch nichts zu tun); `declined`: Kosten abgelehnt; `failed`: Fehler. */
  status: 'complete' | 'declined' | 'failed';
  generated: number;
  /** Wie viele Sätze danach noch fehlen. */
  missing: number;
  /**
   * Wie viele Sätze mit Anleitung ohne Dauer gespeichert wurden, weil die
   * Messung scheiterte - sie gelten weiter als fehlend.
   */
  unmeasured?: number;
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
    const { texts, guidanceTexts } = await loadGuidedTexts(templateIds, options.now ?? new Date());
    const missing = await findMissingTexts([...texts, ...guidanceTexts], settings.voice, guidanceTexts);

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
    const measure = options.measure ?? measureAudioDuration;
    const needsDuration = new Set(guidanceTexts);
    let generated = 0;
    let unmeasured = 0;

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
        // Gemessen wird nur hier, beim Erzeugen; Start und Ablauf lesen die Dauer.
        const durationMs = await measure(await readBlobBuffer(blob));
        await saveAnnouncement(text, settings.voice, blob, durationMs ?? undefined);
        generated += 1;

        if (durationMs === null && needsDuration.has(text)) {
          unmeasured += 1;
        }
      } catch (error) {
        return fail(
          error instanceof TtsError ? error.message : 'Ansagen nicht erzeugt',
          generated,
        );
      }
    }

    return { status: 'complete', generated, missing: 0, unmeasured };
  } catch {
    return { status: 'failed', generated: 0, missing: 0, message: 'Ansagen nicht erzeugt' };
  }
}
