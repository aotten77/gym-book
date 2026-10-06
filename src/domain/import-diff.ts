import { formatNumber } from '@/lib/format';

/*
 * Wie der Bibliotheks-Import Änderungen beschreibt - geteilt zwischen
 * `library-import.ts` und `plan-import.ts`. Eigenes Modul, weil
 * `library-import.ts` die Termin-Planung zur Laufzeit aufruft: ein Import in
 * die Gegenrichtung wäre ein Zyklus.
 */

/** Eine Zeile der Vorschau: "Erfassung: Zeit → Wiederholungen + Gewicht". */
export interface ImportFieldChange {
  field: string;
  from: string;
  to: string;
}

export function describeImportValue(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return '—';
  }

  if (typeof value === 'boolean') {
    return value ? 'ja' : 'nein';
  }

  if (typeof value === 'number') {
    return formatNumber(value);
  }

  return String(value);
}

/**
 * Sammelt eine Änderung, wenn sich der Wert unterscheidet.
 *
 * Gibt zurück, ob geschrieben werden muss - so entstehen Vorschauzeile und
 * Schreibwert aus einer Entscheidung statt aus zwei.
 */
export function diffImportField(
  changes: ImportFieldChange[],
  field: string,
  current: unknown,
  next: unknown,
  format: (value: unknown) => string = describeImportValue,
) {
  if (current === next) {
    return false;
  }

  changes.push({ field, from: format(current), to: format(next) });
  return true;
}
