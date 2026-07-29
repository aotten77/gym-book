import type { ReactNode } from 'react';
import type { TrackingMode } from '@/domain/models';
import { supportsReps, supportsSeconds, supportsWeight } from '@/domain/tracking';

export interface ExerciseTargetFieldsValues {
  workSetCount: string;
  targetReps: string;
  targetSeconds: string;
  targetWeight: string;
  restSeconds: string;
}

const STACKED_FIELD_CLASSES =
  'w-full rounded-panel border border-line bg-surface px-4 py-4 text-base text-content outline-none transition placeholder:text-content-muted focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent';
const GRID_FIELD_CLASSES =
  'rounded-panel border border-line bg-surface px-4 py-4 text-base text-content outline-none transition placeholder:text-content-muted focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent';

interface ExerciseTargetFieldsProps {
  trackingMode?: TrackingMode;
  values: ExerciseTargetFieldsValues;
  onChange: (field: keyof ExerciseTargetFieldsValues, value: string) => void;
  /**
   * 'stacked': ein Feld pro Zeile (Template-Formular), Pause steht am Ende.
   * 'grid': zwei Spalten (Session-Formular), Pause direkt neben Arbeitssätze.
   * Der Aufrufer liefert bei 'grid' selbst den umgebenden `grid grid-cols-2`-Container.
   */
  layout?: 'stacked' | 'grid';
  workSetCountHint?: ReactNode;
  weightLabel?: string;
}

/**
 * Arbeitssätze/Ziel-Wdh/Ziel-Sekunden/Ziel-Gewicht/Pause - dieselben fünf
 * Felder mit derselben Tracking-Mode-Sichtbarkeit tauchten identisch im
 * Template- und im Session-Formular auf, nur mit abweichendem Layout.
 */
export function ExerciseTargetFields({
  trackingMode,
  values,
  onChange,
  layout = 'stacked',
  workSetCountHint,
  weightLabel = 'Ziel-Gewicht',
}: ExerciseTargetFieldsProps) {
  const fieldClassName = layout === 'grid' ? GRID_FIELD_CLASSES : STACKED_FIELD_CLASSES;

  const workSetCountField = (
    <input
      value={values.workSetCount}
      onChange={(event) => onChange('workSetCount', event.target.value)}
      inputMode="numeric"
      aria-label="Arbeitssätze"
      placeholder="Arbeitssätze"
      className={fieldClassName}
    />
  );

  return (
    <>
      {layout === 'stacked' ? (
        <div className="space-y-2">
          {workSetCountField}
          {workSetCountHint ? <p className="text-xs text-content-muted">{workSetCountHint}</p> : null}
        </div>
      ) : (
        workSetCountField
      )}

      {layout === 'grid' ? (
        <input
          value={values.restSeconds}
          onChange={(event) => onChange('restSeconds', event.target.value)}
          inputMode="decimal"
          aria-label="Pause in s"
          placeholder="Pause in s"
          className={fieldClassName}
        />
      ) : null}

      {supportsReps(trackingMode) ? (
        <input
          value={values.targetReps}
          onChange={(event) => onChange('targetReps', event.target.value)}
          inputMode="numeric"
          aria-label="Ziel-Wdh"
          placeholder="Ziel-Wdh"
          className={fieldClassName}
        />
      ) : null}

      {supportsSeconds(trackingMode) ? (
        <input
          value={values.targetSeconds}
          onChange={(event) => onChange('targetSeconds', event.target.value)}
          inputMode="decimal"
          aria-label="Ziel-Sekunden"
          placeholder="Ziel-Sekunden"
          className={fieldClassName}
        />
      ) : null}

      {supportsWeight(trackingMode) ? (
        <input
          value={values.targetWeight}
          onChange={(event) => onChange('targetWeight', event.target.value)}
          inputMode="decimal"
          aria-label={weightLabel}
          placeholder={weightLabel}
          className={fieldClassName}
        />
      ) : null}

      {layout === 'stacked' ? (
        <input
          value={values.restSeconds}
          onChange={(event) => onChange('restSeconds', event.target.value)}
          inputMode="numeric"
          aria-label="Pause in Sekunden"
          placeholder="Pause in Sekunden"
          className={fieldClassName}
        />
      ) : null}
    </>
  );
}
