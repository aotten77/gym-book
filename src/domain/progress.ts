import type { LoadKind, TrackingMode, WorkoutSetLog } from '@/domain/models';
import { sumWorkVolume } from '@/domain/volume';

export interface ProgressPoint {
  completedAt: string;
  /** Bester Arbeitssatz der Ausführung - die Zahl, die Fortschritt zeigt. */
  topValue: number;
  /** Summe aus Gewicht x Wiederholungen bzw. Gewicht x Sekunden. */
  volume: number;
  setCount: number;
}

export type ProgressMetricKey = 'weight' | 'seconds' | 'band' | 'height';

/**
 * Position eines Bands im Katalog, 1-basiert.
 *
 * Bänder haben keinen Zahlenwert - erst die Reihenfolge macht sie
 * vergleichbar. Gibt `undefined` zurück, wenn das Band nicht mehr im Katalog
 * steht; solche Sätze fallen aus der Zeitreihe, behalten in der Historie aber
 * ihren Namen.
 */
export type BandRank = (bandId: string) => number | undefined;

/**
 * Welche Kennzahl den Fortschritt einer Übung trägt, hängt vom Tracking ab:
 * bei Wiederholungen das Gewicht, bei reinen Zeitübungen die Sekunden - und
 * bei Bändern die Stufe im Katalog.
 *
 * Die Höhe sticht alle drei. Sie ist kein Nebenwert, den man mitschreibt,
 * sondern wird eingeschaltet, *weil* an ihr der Fortschritt hängt: wer den
 * Step-Down von 20 auf 25 cm bringt, will genau diese Kurve sehen und nicht
 * die Kurzhanteln, die dabei unverändert in den Händen liegen.
 */
export function progressMetricFor(
  trackingMode: TrackingMode,
  loadKind?: LoadKind,
  tracksHeight?: boolean,
) {
  if (tracksHeight) {
    return { key: 'height' as const, label: 'Höhe', unit: 'cm' };
  }

  if (trackingMode === 'time') {
    return { key: 'seconds' as const, label: 'Sekunden', unit: 's' };
  }

  if (loadKind === 'band') {
    return { key: 'band' as const, label: 'Band', unit: '' };
  }

  return { key: 'weight' as const, label: 'Gewicht', unit: 'kg' };
}

function valueOf(log: WorkoutSetLog, metric: ProgressMetricKey, bandRank?: BandRank) {
  if (metric === 'band') {
    return log.bandId ? bandRank?.(log.bandId) : undefined;
  }

  if (metric === 'height') {
    return log.heightCm;
  }

  return metric === 'weight' ? log.weight : log.seconds;
}

interface ProgressSeriesOptions {
  loadKind?: LoadKind;
  tracksHeight?: boolean;
  bandRank?: BandRank;
}

/**
 * Verdichtet die Arbeitssätze einer Ausführung auf einen Punkt der Zeitreihe.
 *
 * Bei unilateralen Übungen zählt der beste Satz einer Seite, nicht die Summe
 * beider - sonst zeigte das Diagramm einen Sprung, sobald links und rechts
 * getrennt geloggt werden.
 */
export function buildProgressSeries(
  executions: Array<{ completedAt: string; workLogs: WorkoutSetLog[] }>,
  trackingMode: TrackingMode,
  { loadKind, tracksHeight, bandRank }: ProgressSeriesOptions = {},
): ProgressPoint[] {
  const metric = progressMetricFor(trackingMode, loadKind, tracksHeight).key;

  return executions
    .map((execution) => {
      const values = execution.workLogs
        .map((log) => valueOf(log, metric, bandRank))
        .filter((value): value is number => typeof value === 'number');

      if (values.length === 0) {
        return null;
      }

      // Bänder tragen keine Last in Kilo, ein Volumen ergäbe dort keine Zahl.
      // Die Ausnahme steht hier und nicht in `sumWorkVolume`: dort käme
      // ohnehin null heraus, aber nur hier ist bekannt, dass das kein
      // Messwert ist, sondern eine Kennzahl, die es für Bänder nicht gibt.
      const volume = metric === 'band' ? 0 : sumWorkVolume(execution.workLogs);

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
