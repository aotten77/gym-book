import type { Side, WorkoutSetLog } from '@/domain/models';

const SIDE_ORDER: Record<Side, number> = {
  both: 0,
  left: 1,
  right: 2,
};

/**
 * Bringt Sätze in die Reihenfolge, in der sie ausgeführt wurden:
 * Warmup zuerst, dann nach Satznummer, links vor rechts.
 *
 * Ohne explizite Sortierung liefert Dexie die Zeilen in Primary-Key-Reihenfolge
 * - und der Primary Key ist eine zufällige UUID.
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

export interface SetValues {
  reps?: number;
  seconds?: number;
  weight?: number;
}

/** Identifiziert eine Satzzeile innerhalb einer Ausführung. */
export function setLogKey(log: Pick<WorkoutSetLog, 'setKind' | 'side' | 'setNumber'>) {
  return `${log.setKind}:${log.side}:${log.setNumber}`;
}

/**
 * Baut die Nachschlagetabelle für die Platzhalter im Satz-Editor: was stand
 * beim letzten Mal in genau diesem Satz?
 *
 * Der Fallback ist der Grund für die zweite Ebene: hat die Vorlage inzwischen
 * vier statt drei Arbeitssätze, gibt es für Satz 4 keinen Vorgänger. Statt
 * ein leeres Feld zu zeigen, greift dann der höchste geloggte Arbeitssatz
 * derselben Seite - die letzte Zahl, die der Nutzer dort tatsächlich
 * geschafft hat.
 */
export function buildLastSetValues(logs: WorkoutSetLog[]) {
  const byKey: Record<string, SetValues> = {};
  const fallbackBySide: Record<string, { setNumber: number; values: SetValues }> = {};

  for (const log of logs) {
    const values: SetValues = {
      reps: log.reps,
      seconds: log.seconds,
      weight: log.weight,
    };

    byKey[setLogKey(log)] = values;

    if (log.setKind !== 'work') {
      continue;
    }

    const currentFallback = fallbackBySide[log.side];

    if (!currentFallback || log.setNumber > currentFallback.setNumber) {
      fallbackBySide[log.side] = { setNumber: log.setNumber, values };
    }
  }

  return {
    byKey,
    /** Werte für eine Satzzeile, mit Rückfall auf den letzten Satz der Seite. */
    resolve(log: Pick<WorkoutSetLog, 'setKind' | 'side' | 'setNumber'>): SetValues | undefined {
      const exact = byKey[setLogKey(log)];

      if (exact) {
        return exact;
      }

      // Für das Warmup gibt es keinen sinnvollen Rückfall auf Arbeitssätze:
      // die Last dort ist eine andere.
      if (log.setKind !== 'work') {
        return undefined;
      }

      return fallbackBySide[log.side]?.values;
    },
  };
}

export type LastSetValues = ReturnType<typeof buildLastSetValues>;

export interface ExerciseExecution {
  sessionExerciseId: string;
  exerciseId: string;
  sessionId: string;
  completedAt: string;
  templateNameSnapshot?: string;
  /** Bereits auf abgeschlossene Arbeitssätze gefiltert. */
  workLogs: WorkoutSetLog[];
}

/**
 * Wählt die letzte Ausführung einer Übung, die tatsächlich geloggte
 * Arbeitssätze hat.
 *
 * Nur "die zeitlich letzte Zeile" zu nehmen reicht nicht: war die Übung beim
 * letzten Mal übersprungen oder wurde nie geloggt, muss die Ausführung davor
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
