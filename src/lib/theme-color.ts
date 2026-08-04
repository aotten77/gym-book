/** Der Ton der App: Papier, wie in `index.html` gesetzt. */
export const APP_THEME_COLOR = '#f2f2ef';

/**
 * Färbt die Browser- und Statusleiste um, solange ein Zustand sie braucht.
 *
 * Nötig für den Ruhemodus: er ist die einzige Fläche der App in Tinte, und
 * darüber zeichnet iOS im installierten Zustand die Statusleiste. Bliebe
 * `theme-color` auf Papier, stünde dort dunkle Schrift auf dunklem Grund - die
 * Uhrzeit des Geräts wäre während der ganzen Pause nicht zu lesen.
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
