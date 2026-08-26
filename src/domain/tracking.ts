import type { LoadKind, TrackingMode } from '@/domain/models';

/**
 * Wie ein Tracking-Modus heißt, wenn ein Mensch ihn liest.
 *
 * Steht hier und nicht im Formular, weil inzwischen zwei Stellen ihn anzeigen:
 * die Übungsverwaltung und die Vorschau des Bibliotheks-Imports, die für eine
 * geänderte Erfassung "Zeit → Wiederholungen + Gewicht" schreibt.
 */
export const TRACKING_MODE_LABELS: Record<TrackingMode, string> = {
  reps_weight: 'Wiederholungen + Gewicht',
  time: 'Zeit',
  time_weight: 'Zeit + Gewicht',
};

export function supportsReps(trackingMode?: TrackingMode) {
  return trackingMode === 'reps_weight';
}

export function supportsSeconds(trackingMode?: TrackingMode) {
  return trackingMode === 'time' || trackingMode === 'time_weight';
}

/** Ob die Übung überhaupt eine Belastung trägt - egal ob Kilo oder Band. */
export function supportsLoad(trackingMode?: TrackingMode) {
  return trackingMode === 'reps_weight' || trackingMode === 'time_weight';
}

/**
 * Kilo oder Band, nie beides: die Belastungsart entscheidet, welches der
 * beiden Felder erscheint. Fehlt `loadKind`, bleibt es beim Gewicht - so
 * verhalten sich alle Datensätze von vor der Einführung der Bänder.
 */
export function supportsWeight(trackingMode?: TrackingMode, loadKind?: LoadKind) {
  return supportsLoad(trackingMode) && (loadKind ?? 'weight') === 'weight';
}

export function supportsBand(trackingMode?: TrackingMode, loadKind?: LoadKind) {
  return supportsLoad(trackingMode) && loadKind === 'band';
}

/**
 * Ob die Übung eine Höhe in Zentimetern mitschreibt.
 *
 * Als einziges Feld hängt die Höhe *nicht* am Tracking-Modus: sie ist keine
 * Last, sondern der Weg der Übung, und steht deshalb neben Kilo oder Band
 * statt an deren Stelle. Ein Step-Down von 25 cm darf Kurzhanteln tragen, ein
 * Plank über 45 s eine Ablage. `undefined` zählt als aus - so verhalten sich
 * alle Übungen von vor der Einführung der Höhe.
 */
export function supportsHeight(tracksHeight?: boolean) {
  return tracksHeight === true;
}
