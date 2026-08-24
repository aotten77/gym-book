export type NumberInputResult =
  | { status: 'empty' }
  | { status: 'valid'; value: number }
  | { status: 'invalid' };

/**
 * Parst eine Zahleneingabe aus einem Textfeld.
 *
 * Deutsche Tastaturen liefern ein Dezimalkomma, das `Number()` als NaN
 * ablehnt. Ein NaN darf hier nie als "kein Wert" durchgereicht werden:
 * `Table.update` in Dexie löscht Properties, deren Wert `undefined` ist,
 * womit eine Fehleingabe einen bereits gespeicherten Wert vernichten würde.
 * Deshalb sind "leer" und "ungültig" zwei verschiedene Ergebnisse.
 */
export function parseNumberInput(value: string): NumberInputResult {
  const trimmed = value.trim();

  if (!trimmed) {
    return { status: 'empty' };
  }

  const parsed = Number(trimmed.replace(',', '.'));

  if (!Number.isFinite(parsed) || parsed < 0) {
    return { status: 'invalid' };
  }

  return { status: 'valid', value: parsed };
}

/**
 * Für Formulare, die einen Datensatz neu anlegen: leer und ungültig sind
 * beide "kein Wert". Nicht verwenden, wenn ein bereits gespeicherter Wert
 * überschrieben wird - dort muss `parseNumberInput` den Unterschied machen.
 */
export function optionalNumberInput(value: string) {
  const parsed = parseNumberInput(value);
  return parsed.status === 'valid' ? parsed.value : undefined;
}

/**
 * Der Wert, wie er im Feld steht - mit Dezimalkomma.
 *
 * Eine deutsche Tastatur liefert ohnehin ein Komma, und die Zeile unter dem
 * Feld schreibt "82,5 kg": stünde im Feld "82.5", wäre dieselbe Zahl zweimal
 * verschieden geschrieben. Zurück kommt sie über `parseNumberInput`, das beide
 * Schreibweisen annimmt.
 */
export function toInputValue(value?: number) {
  return typeof value === 'number' ? String(value).replace('.', ',') : '';
}
