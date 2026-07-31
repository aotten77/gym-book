import type { LoadKind, TrackingMode } from '@/domain/models';

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
