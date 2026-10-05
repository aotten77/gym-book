/**
 * Der Schlüssel, über den zugeordnet wird.
 *
 * Getrimmt und kleingeschrieben, an genau einer Stelle definiert: "Nordic
 * Curl" und "nordic curl " sind dieselbe Übung, sonst legt der zweite Import
 * eine zweite an. `toLocaleLowerCase('de')` statt `toLowerCase()`, damit auch
 * ein "Ü" verlässlich fällt.
 */
export function normalizeImportKey(name: string) {
  return name.trim().toLocaleLowerCase('de');
}
