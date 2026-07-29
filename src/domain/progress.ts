import type { TrackingMode, WorkoutSetLog } from '@/domain/models';

export interface ProgressPoint {
  completedAt: string;
  /** Bester Arbeitssatz der Ausfuehrung - die Zahl, die Fortschritt zeigt. */
  topValue: number;
  /** Summe aus Gewicht x Wiederholungen bzw. Gewicht x Sekunden. */
  volume: number;
  setCount: number;
}

/**
 * Welche Kennzahl den Fortschritt einer Uebung traegt, haengt vom Tracking ab:
 * bei Wiederholungen das Gewicht, bei reinen Zeituebungen die Sekunden.
 */
export function progressMetricFor(trackingMode: TrackingMode) {
  if (trackingMode === 'time') {
    return { key: 'seconds' as const, label: 'Sekunden', unit: 's' };
  }

  return { key: 'weight' as const, label: 'Gewicht', unit: 'kg' };
}

function valueOf(log: WorkoutSetLog, metric: 'weight' | 'seconds') {
  return metric === 'weight' ? log.weight : log.seconds;
}

/**
 * Verdichtet die Arbeitssaetze einer Ausfuehrung auf einen Punkt der Zeitreihe.
 *
 * Bei unilateralen Uebungen zaehlt der beste Satz einer Seite, nicht die Summe
 * beider - sonst zeigte das Diagramm einen Sprung, sobald links und rechts
 * getrennt geloggt werden.
 */
export function buildProgressSeries(
  executions: Array<{ completedAt: string; workLogs: WorkoutSetLog[] }>,
  trackingMode: TrackingMode,
): ProgressPoint[] {
  const metric = progressMetricFor(trackingMode).key;

  return executions
    .map((execution) => {
      const values = execution.workLogs
        .map((log) => valueOf(log, metric))
        .filter((value): value is number => typeof value === 'number');

      if (values.length === 0) {
        return null;
      }

      const volume = execution.workLogs.reduce((sum, log) => {
        const load = log.weight ?? 0;
        const reps = log.reps ?? log.seconds ?? 0;
        return sum + load * reps;
      }, 0);

      return {
        completedAt: execution.completedAt,
        topValue: Math.max(...values),
        volume,
        setCount: execution.workLogs.length,
      };
    })
    .filter((point): point is ProgressPoint => point !== null)
    .sort((left, right) => left.completedAt.localeCompare(right.completedAt));
}

export interface ProgressTrend {
  first: number;
  last: number;
  delta: number;
  percent: number;
}

export function summarizeTrend(points: ProgressPoint[]): ProgressTrend | undefined {
  if (points.length < 2) {
    return undefined;
  }

  const first = points[0].topValue;
  const last = points[points.length - 1].topValue;
  const delta = last - first;

  return {
    first,
    last,
    delta,
    percent: first === 0 ? 0 : Number(((delta / first) * 100).toFixed(1)),
  };
}
