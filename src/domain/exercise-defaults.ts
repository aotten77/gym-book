import type { Exercise } from '@/domain/models';
import { supportsReps } from '@/domain/tracking';
import { toInputValue } from '@/lib/number-input';

/**
 * Die Wiederholungsempfehlung der Übung als Vorbelegung - **eine Kopie**.
 *
 * Die eine Stelle, an der `Exercise.defaultTargetReps` in ein `targetReps`
 * übergeht. Danach ist die Zahl im Workout zu Hause: wer den Default der Übung
 * später auf 12 stellt, lässt ein Workout, in dem 5 steht, unangetastet. Ein
 * Live-Rückgriff wäre das Gegenteil - eine Zahl, die sich hinter dem Rücken
 * eines fertig geplanten Workouts ändert.
 *
 * Deshalb auch nur ins **leere** Feld: was jemand getippt oder aus einer
 * bestehenden Zuordnung geladen hat, ist bereits eine Entscheidung.
 *
 * Als eigene Funktion, weil zwei Formulare zuordnen - das Workout und die
 * laufende Session ("Übung in der Session ergänzen"). Zwei Kopien dieser Regel
 * sind der Weg, auf dem eines der beiden Formulare die Vorbelegung eines Tages
 * still verliert.
 */
export function prefillTargetReps(
  current: string,
  exercise?: Pick<Exercise, 'trackingMode' | 'defaultTargetReps'>,
): string {
  if (current.trim() !== '') {
    return current;
  }

  if (!exercise || !supportsReps(exercise.trackingMode)) {
    return current;
  }

  return toInputValue(exercise.defaultTargetReps) || current;
}
