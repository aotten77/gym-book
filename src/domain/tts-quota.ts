/**
 * Freikontingent der Sprachausgabe: wie viele Zeichen sind in diesem UTC-Monat
 * noch frei, und was kostet der Rest. Übertragen aus `Quota` in yt-brain. Rein:
 * `now` kommt als Parameter.
 */

export const DEFAULT_TTS_VOICE = 'de-DE-Chirp3-HD-Iapetus';
export const DEFAULT_TTS_LANGUAGE = 'de-DE';
export const DEFAULT_FREE_CHARS_PER_MONTH = 1_000_000;
export const DEFAULT_PRICE_PER_MILLION_USD = 30;

export interface Quota {
  freeLeft: number;
  pricePerMillionUsd: number;
}

/** `YYYY-MM` des Monats von `now`, in UTC - Google rechnet in UTC ab. */
export function utcMonthKey(now: Date) {
  return now.toISOString().slice(0, 7);
}

/** Zeichen nach Code points; Google rechnet nach Zeichen, nicht nach UTF-16-Einheiten. */
export function countChars(text: string) {
  return Array.from(text).length;
}

export function createQuota(
  charsByMonth: Record<string, number>,
  now: Date,
  freeCharsPerMonth: number,
  pricePerMillionUsd: number,
): Quota {
  const used = charsByMonth[utcMonthKey(now)] ?? 0;

  return {
    freeLeft: Math.max(0, freeCharsPerMonth - used),
    pricePerMillionUsd,
  };
}

export function quotaFits(quota: Quota, chars: number) {
  return chars <= quota.freeLeft;
}

export function quotaOver(quota: Quota, chars: number) {
  return Math.max(0, chars - quota.freeLeft);
}

/** Kosten des Überschusses in US-Dollar, auf Cent gerundet. */
export function quotaCostUsd(quota: Quota, chars: number) {
  return Math.round((quotaOver(quota, chars) * quota.pricePerMillionUsd) / 1_000_000 * 100) / 100;
}

/** Nur die letzten vier Zeichen bleiben sichtbar; kurze Schlüssel zeigen nichts. */
export function maskApiKey(key: string) {
  return key.length >= 8 ? `••••${key.slice(-4)}` : '••••';
}

/** Gleiche Sätze mit gleicher Stimme teilen sich einen Datensatz. */
export function announcementKey(text: string, voice: string) {
  return `${voice}\u0000${text}`;
}
