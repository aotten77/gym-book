/**
 * Orientierungswinkel des Bildschirms für das CSS sichtbar machen.
 *
 * Die App hält sich im Hochformat, indem sie sich im Querformat per CSS
 * zurückdreht (siehe `index.css`). Eine Media Query kennt aber nur
 * `portrait`/`landscape` und nicht, *in welche Richtung* das Gerät gekippt
 * wurde - eine feste Drehung um 90 Grad steht deshalb in einer der beiden
 * Querformat-Lagen auf dem Kopf. Genau das ist der 180-Grad-Sprung, den man
 * beim Ablegen des Telefons sieht.
 *
 * Der Winkel kommt aus `screen.orientation` (iOS ab 16.4) mit
 * `window.orientation` als Rückfall und landet als `data-screen-angle` auf
 * `<html>`; das CSS wählt daran die Drehrichtung. 90 Grad heißt: das Gerät
 * wurde gegen den Uhrzeigersinn gekippt, die Anzeige steht im Geräterahmen
 * also um 90 Grad im Uhrzeigersinn - genau so weit dreht das CSS zurück.
 */

/** Bildschirmlagen, für die es eine eigene Regel im CSS gibt. */
export type ScreenAngle = 0 | 90 | 180 | 270;

interface OrientationSource {
  screen?: { orientation?: { angle?: number } };
  /** Von iOS vor 16.4 als einziger Wert geliefert, mit -90 statt 270. */
  orientation?: unknown;
}

/**
 * Normalisiert den gemeldeten Winkel auf 0/90/180/270.
 *
 * Unbekannte oder krumme Werte werden zu 0 - lieber das bisherige Verhalten
 * als eine willkürliche Drehung.
 */
export function readScreenAngle(source: OrientationSource = window): ScreenAngle {
  const reported =
    typeof source.screen?.orientation?.angle === 'number'
      ? source.screen.orientation.angle
      : typeof source.orientation === 'number'
        ? source.orientation
        : 0;

  const normalized = ((Math.round(reported / 90) * 90) % 360 + 360) % 360;

  return normalized === 90 || normalized === 180 || normalized === 270 ? normalized : 0;
}

/**
 * Schreibt den aktuellen Winkel nach `<html data-screen-angle>` und hält ihn
 * dort aktuell. Gibt eine Abmelde-Funktion zurück.
 */
export function watchScreenOrientation(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }

  const apply = () => {
    document.documentElement.dataset.screenAngle = String(readScreenAngle());
  };

  apply();

  const screenOrientation = window.screen?.orientation;
  screenOrientation?.addEventListener?.('change', apply);
  // Ältere WebKit-Versionen kennen nur diese beiden Ereignisse.
  window.addEventListener('orientationchange', apply);
  window.addEventListener('resize', apply);

  return () => {
    screenOrientation?.removeEventListener?.('change', apply);
    window.removeEventListener('orientationchange', apply);
    window.removeEventListener('resize', apply);
  };
}
