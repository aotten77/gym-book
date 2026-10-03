/**
 * Eine gemeinsame Scroll-Sperre für alles, was über der Seite liegt.
 *
 * Sheet, Rückfrage und Info-Modal sperrten den Body früher jeweils selbst:
 * vorherigen Wert merken, `hidden` setzen, beim Schließen zurückschreiben.
 * Das hält nur, solange jeder in umgekehrter Reihenfolge aufräumt - und das
 * Sheet tut es nicht: sein Effekt läuft bei jedem Render der Session neu an
 * und merkte sich dann das `hidden` des Modals darüber als Ausgangswert.
 * Verließ man die Session mit beiden offen, blieb die Seite gesperrt, bis
 * man neu lud.
 *
 * Ein Zähler kennt keine Reihenfolge: der erste merkt sich den Ausgangswert,
 * der letzte stellt ihn wieder her.
 */

let activeLocks = 0;
let originalOverflow = '';

/** Sperrt das Scrollen des Body; die zurückgegebene Funktion gibt frei. */
export function lockBodyScroll(): () => void {
  if (activeLocks === 0) {
    originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }

  activeLocks += 1;
  let released = false;

  return () => {
    if (released) {
      return;
    }

    released = true;
    activeLocks -= 1;

    if (activeLocks === 0) {
      document.body.style.overflow = originalOverflow;
    }
  };
}
