/** Der Ton der App: Papier, wie in `index.html` gesetzt. */
export const APP_THEME_COLOR = '#f2f2ef';

/** Die Tinte der App - derselbe Wert wie `accent.DEFAULT` in tailwind.config.js. */
export const INK_THEME_COLOR = '#0c1210';

/**
 * Färbt die Browser- und Statusleiste um, solange ein Zustand sie braucht.
 *
 * Nötig für die beiden dunklen Flächen der App, den Ruhemodus und den
 * geführten Screen: sie sind die einzigen in Tinte, und darüber zeichnet iOS
 * im installierten Zustand die Statusleiste. Bliebe `theme-color` auf Papier,
 * stünde dort dunkle Schrift auf dunklem Grund - die Uhrzeit des Geräts wäre
 * währenddessen nicht zu lesen.
 *
 * Gibt die Funktion zurück, die den vorherigen Wert wiederherstellt; damit
 * lässt sie sich direkt als Aufräumen eines Effekts verwenden. Fehlt das
 * Meta-Element, passiert nichts - eine fehlende Leistenfarbe ist kein Grund,
 * eine Ansicht scheitern zu lassen.
 */
export function applyThemeColor(color: string): () => void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');

  if (!meta) {
    return () => {};
  }

  const previous = meta.content;

  meta.content = color;

  return () => {
    meta.content = previous;
  };
}
