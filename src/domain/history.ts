import type { Side, WorkoutSetLog } from '@/domain/models';

const SIDE_ORDER: Record<Side, number> = {
  both: 0,
  left: 1,
  right: 2,
};

/**
 * Bringt Saetze in die Reihenfolge, in der sie ausgefuehrt wurden:
 * Warmup zuerst, dann nach Satznummer, links vor rechts.
 *
 * Ohne explizite Sortierung liefert Dexie die Zeilen in Primary-Key-Reihenfolge
 * - und der Primary Key ist eine zufaellige UUID.
 */
export function sortSetLogs(logs: WorkoutSetLog[]) {
  return [...logs].sort((left, right) => {
    if (left.setKind !== right.setKind) {
      return left.setKind === 'warmup' ? -1 : 1;
    }

    if (left.setNumber !== right.setNumber) {
      return left.setNumber - right.setNumber;
    }

    return SIDE_ORDER[left.side] - SIDE_ORDER[right.side];
  });
}

export interface ExerciseExecution {
  sessionExerciseId: string;
  exerciseId: string;
  sessionId: string;
  completedAt: string;
  templateNameSnapshot?: string;
  /** Bereits auf abgeschlossene Arbeitssaetze gefiltert. */
  workLogs: WorkoutSetLog[];
}

/**
 * Waehlt die letzte Ausfuehrung einer Uebung, die tatsaechlich geloggte
 * Arbeitssaetze hat.
 *
 * Nur "die zeitlich letzte Zeile" zu nehmen reicht nicht: war die Uebung beim
 * letzten Mal uebersprungen oder wurde nie geloggt, muss die Ausfuehrung davor
 * gewinnen - sonst behauptet die App "keine Werte", obwohl Historie existiert.
 */
export function pickLastCompletedExecution(executions: ExerciseExecution[]) {
  return executions
    .filter((execution) => execution.workLogs.length > 0)
    .reduce<ExerciseExecution | undefined>((latest, execution) => {
      if (!latest || execution.completedAt > latest.completedAt) {
        return execution;
      }

      return latest;
    }, undefined);
}
