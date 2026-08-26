import type { ProgressionRule, WorkoutTemplateExercise } from '@/domain/models';

/**
 * Die Felder, die eine Wochenregel überhaupt überschreiben kann.
 *
 * Bewusst eine Liste und kein Spread über die Regel: `ProgressionRule` trägt
 * mit `id`, `templateExerciseId` und `programWeekId` drei Schlüssel, die im
 * Ziel nichts zu suchen haben. `restSeconds` fehlt hier, weil eine Regel es
 * nicht kennt - die Pause gehört dem Workout, nicht der Woche.
 */
export const FOLDABLE_TARGET_FIELDS = [
  'workSetCount',
  'targetReps',
  'targetRepsMax',
  'targetSeconds',
  'targetWeight',
  'targetBandId',
  'targetHeightCm',
  'notes',
] as const;

export type FoldableTargetField = (typeof FOLDABLE_TARGET_FIELDS)[number];

/** Die Zielwerte einer Übung, nachdem die Woche darüber gefaltet wurde. */
export type FoldedTargets = Pick<WorkoutTemplateExercise, FoldableTargetField>;

type FoldableSource = Pick<WorkoutTemplateExercise, FoldableTargetField>;

/**
 * Legt die Zielwerte einer Wochenregel über die Basiswerte des Workouts.
 *
 * Feldweise, nicht als Ganzes: `regel.targetWeight ?? basis.targetWeight`. Eine
 * Regel, die nur das Gewicht setzt, lässt Wiederholungen und Pause also
 * unangetastet - `undefined` heißt "nichts vorgegeben", nie "löschen". Das ist
 * dieselbe Zusage wie in `updateSetLogValues` und aus demselben Grund: ein
 * Nutzer, der für Woche 3 ein Gewicht plant, verliert dabei seine
 * Wiederholungsvorgabe nicht.
 *
 * Stand bis hierher inline in `materializeSession`. Herausgezogen, weil die
 * Programm-Seite dieselbe Faltung *anzeigt*: baute sie sie nach, würde sie
 * irgendwann etwas anderes zeigen, als der Start tatsächlich schreibt.
 * Eine Quelle, zwei Aufrufer.
 */
export function foldProgressionRule(
  templateExercise: FoldableSource,
  rule?: ProgressionRule,
): FoldedTargets {
  return {
    workSetCount: rule?.workSetCount ?? templateExercise.workSetCount,
    targetReps: rule?.targetReps ?? templateExercise.targetReps,
    // Die beiden Ränder fallen einzeln zurück: eine Woche, die nur den unteren
    // Rand anhebt, behält die Decke aus dem Workout.
    targetRepsMax: rule?.targetRepsMax ?? templateExercise.targetRepsMax,
    targetSeconds: rule?.targetSeconds ?? templateExercise.targetSeconds,
    targetWeight: rule?.targetWeight ?? templateExercise.targetWeight,
    targetBandId: rule?.targetBandId ?? templateExercise.targetBandId,
    targetHeightCm: rule?.targetHeightCm ?? templateExercise.targetHeightCm,
    notes: rule?.notes ?? templateExercise.notes,
  };
}

/**
 * Welche Felder in dieser Woche aus der Regel kommen und nicht aus dem Workout.
 *
 * Maßstab ist, dass die Regel das Feld *gesetzt* hat - nicht, dass ihr Wert
 * vom Basiswert abweicht. Eine Regel, die 85 kg vorgibt, während das Workout
 * ohnehin 85 kg sagt, ist eine Wochenvorgabe und bleibt eine, auch wenn jemand
 * später den Basiswert verschiebt; ein Vergleich ließe die Markierung dabei
 * von selbst umspringen.
 *
 * Nimmt deshalb nur die Regel: die Basiswerte tragen zur Antwort nichts bei.
 */
export function overriddenTargetFields(rule?: ProgressionRule): FoldableTargetField[] {
  if (!rule) {
    return [];
  }

  return FOLDABLE_TARGET_FIELDS.filter((field) => rule[field] !== undefined);
}
