import type { WorkoutSetLog } from '@/domain/models';

/**
 * Trainingsvolumen einer Menge von Sätzen: Last mal Wiederholungen bzw. mal
 * Sekunden, aufsummiert.
 *
 * Die Formel stand bisher genau einmal inline in [progress.ts] und wird jetzt
 * an zwei weiteren Stellen gebraucht (Wochenkachel, Volumenbalken im Verlauf).
 * Sie filtert bewusst *nicht*: welche Sätze zählen - Arbeitssätze, abgehakte,
 * die einer Woche - entscheidet die Aufrufstelle, die den passenden Index
 * ohnehin schon in der Hand hat.
 *
 * Eine Band-Übung trägt hier null bei, weil ihr `weight` fehlt. Für die
 * Zeitreihe wird das in `buildProgressSeries` ausdrücklich abgefangen; fürs UI
 * heißt es: eine bandlastige Woche untertreibt. Deshalb ist die Kachel mit
 * "Volumen" und der Einheit kg beschriftet und nicht mit "Arbeit".
 */
export function sumWorkVolume(logs: WorkoutSetLog[]): number {
  return logs.reduce((sum, log) => {
    const load = log.weight ?? 0;
    const reps = log.reps ?? log.seconds ?? 0;
    return sum + load * reps;
  }, 0);
}
