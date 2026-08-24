import { db } from '@/db/appDb';
import type { AppSettings } from '@/domain/models';

/*
 * Die Handgriffe, die jede Schreibaktion vor dem `put` macht.
 *
 * Sie standen bis hierher als wortgleiche Kopien in vier Dateien - und eine
 * davon war schon auseinandergelaufen: `program-actions.ts` deklarierte
 * `value: string`, während seine Aufrufer `undefined` übergaben. Nur
 * `strict: false` hat das verdeckt.
 */

export const SETTINGS_ID: AppSettings['id'] = 'app-settings';

/**
 * Leerer Text ist kein Text.
 *
 * Ein Feld, in dem nur Leerzeichen stehen, soll gar nicht erst gespeichert
 * werden: `undefined` löscht die Property beim Update, ein `''` bliebe als
 * leerer Wert stehen und wäre in der Historie nicht von "nie ausgefüllt" zu
 * unterscheiden.
 */
export function normalizeOptionalText(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Zahlen unter null und `NaN` sind keine Zielwerte, sondern Tippfehler. */
export function normalizeOptionalNumber(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return undefined;
  }

  return value >= 0 ? value : undefined;
}

/**
 * Verlangt einen nicht leeren Namen und gibt ihn beschnitten zurück.
 *
 * Die Meldung ist Pflichtparameter, weil sie beim Nutzer ankommt: "Die Übung
 * braucht einen Namen." und "Das Band braucht einen Namen." sind zwei Sätze,
 * kein gemeinsamer mit Platzhalter.
 */
export function assertName(name: string, message: string) {
  const trimmed = name.trim();

  if (!trimmed) {
    throw new Error(message);
  }

  return trimmed;
}

/**
 * Liefert die Einstellungszeile und legt sie an, falls sie fehlt.
 *
 * Der Bootstrap schreibt sie beim ersten Start, aber jede Aktion, die
 * Einstellungen ändert, muss auch ohne ihn auskommen - etwa direkt nach einem
 * lokalen Zurücksetzen.
 */
export async function ensureSettings(): Promise<AppSettings> {
  const existing = await db.appSettings.get(SETTINGS_ID);

  if (existing) {
    return existing;
  }

  const created: AppSettings = {
    id: SETTINGS_ID,
    exportSchemaVersion: 1,
    updatedAt: new Date().toISOString(),
  };

  await db.appSettings.add(created);
  return created;
}
