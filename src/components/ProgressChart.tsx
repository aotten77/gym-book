import { useId } from 'react';
import type { ProgressPoint } from '@/domain/progress';
import { summarizeTrend } from '@/domain/progress';
import { formatNumber } from '@/lib/format';

interface ProgressChartProps {
  points: ProgressPoint[];
  unit: string;
  label: string;
  /**
   * Übersetzt den Y-Wert in seine Beschriftung.
   *
   * Gedacht für Bänder: dort ist der Wert die Stufe im Katalog, und "3" sagt
   * niemandem etwas, "grün" schon. Ist die Funktion gesetzt, entfällt auch die
   * Differenz-Angabe - zwei Stufen Unterschied sind keine zwei Kilo.
   */
  formatValue?: (value: number) => string;
}

const WIDTH = 320;
const HEIGHT = 120;
const PADDING = { top: 12, right: 8, bottom: 20, left: 8 };

/**
 * Handgeschriebenes SVG statt einer Chart-Bibliothek.
 *
 * Eine einzelne Zeitreihe rechtfertigt in einer Offline-App keine zusätzliche
 * Abhängigkeit im Bundle - und ohne Netz muss ohnehin alles mit ausgeliefert
 * werden.
 */
export function ProgressChart({ points, unit, label, formatValue }: ProgressChartProps) {
  const gradientId = useId();

  if (points.length === 0) {
    return null;
  }

  const trend = summarizeTrend(points);
  const values = points.map((point) => point.topValue);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Bei konstanten Werten wäre die Spanne 0 - dann liegt die Linie mittig.
  const span = max - min || Math.max(1, max * 0.1);
  const innerWidth = WIDTH - PADDING.left - PADDING.right;
  const innerHeight = HEIGHT - PADDING.top - PADDING.bottom;

  const coords = points.map((point, index) => {
    const x =
      PADDING.left + (points.length === 1 ? innerWidth / 2 : (index / (points.length - 1)) * innerWidth);
    const y = PADDING.top + innerHeight - ((point.topValue - min) / span) * innerHeight;
    return { x, y, point };
  });

  const line = coords.map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${coords[coords.length - 1].x.toFixed(1)},${(HEIGHT - PADDING.bottom).toFixed(1)} L${coords[0].x.toFixed(1)},${(HEIGHT - PADDING.bottom).toFixed(1)} Z`;

  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' }).format(new Date(iso));

  const format = (value: number) => (formatValue ? formatValue(value) : `${formatNumber(value)} ${unit}`);
  const summary = trend
    ? formatValue
      ? `${label} von ${format(trend.first)} auf ${format(trend.last)}`
      : `${label} von ${formatNumber(trend.first)} auf ${formatNumber(trend.last)} ${unit}, ${trend.delta >= 0 ? 'plus' : 'minus'} ${formatNumber(Math.abs(trend.delta))} ${unit}`
    : `${label}: ${format(points[0].topValue)} bei einer Ausführung`;

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label={summary}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-line)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--chart-line)" stopOpacity="0" />
          </linearGradient>
        </defs>

        <path d={area} fill={`url(#${gradientId})`} />
        <path
          d={line}
          fill="none"
          stroke="var(--chart-line)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {coords.map(({ x, y, point }) => (
          <circle
            key={point.completedAt}
            cx={x}
            cy={y}
            r="3"
            fill="var(--chart-dot)"
            stroke="var(--chart-line)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      <figcaption className="mt-2 flex items-baseline justify-between gap-2 text-xs text-content-muted">
        <span>{formatDate(points[0].completedAt)}</span>
        <span className="text-content-secondary">
          {min === max
            ? format(max)
            : formatValue
              ? `${format(min)}–${format(max)}`
              : `${formatNumber(min)}–${formatNumber(max)} ${unit}`}
          {trend && !formatValue ? (
            <span className={trend.delta >= 0 ? ' text-success' : ' text-danger'}>
              {' '}
              {trend.delta >= 0 ? '+' : ''}
              {formatNumber(trend.delta)} {unit}
            </span>
          ) : null}
        </span>
        <span>{formatDate(points[points.length - 1].completedAt)}</span>
      </figcaption>
    </figure>
  );
}
