import type { ReactNode } from 'react';
import type { BandLevel, LoadKind, TrackingMode } from '@/domain/models';
import { supportsBand, supportsReps, supportsSeconds, supportsWeight } from '@/domain/tracking';
import { cn } from '@/lib/utils';

export interface ExerciseTargetFieldsValues {
  workSetCount: string;
  targetReps: string;
  targetSeconds: string;
  targetWeight: string;
  targetBandId: string;
  restSeconds: string;
}

const STACKED_FIELD_CLASSES =
  'w-full rounded-panel border border-line bg-surface px-4 py-4 text-base text-content outline-none transition placeholder:text-content-muted focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent';
const GRID_FIELD_CLASSES =
  'rounded-panel border border-line bg-surface px-4 py-4 text-base text-content outline-none transition placeholder:text-content-muted focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent';

interface ExerciseTargetFieldsProps {
  trackingMode?: TrackingMode;
  /** Entscheidet, ob das Ziel in Kilo oder als Band abgefragt wird. */
  loadKind?: LoadKind;
  /** Band-Katalog, sortiert von leicht nach schwer. */
  bandLevels?: BandLevel[];
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
  loadKind,
  bandLevels,
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

      {supportsWeight(trackingMode, loadKind) ? (
        <input
          value={values.targetWeight}
          onChange={(event) => onChange('targetWeight', event.target.value)}
          inputMode="decimal"
          aria-label={weightLabel}
          placeholder={weightLabel}
          className={fieldClassName}
        />
      ) : null}

      {supportsBand(trackingMode, loadKind) ? (
        <select
          value={values.targetBandId}
          onChange={(event) => onChange('targetBandId', event.target.value)}
          aria-label="Ziel-Band"
          className={cn(fieldClassName, 'select-control')}
        >
          <option value="">{bandLevels?.length ? 'Ziel-Band' : 'Noch keine Bänder angelegt'}</option>
          {bandLevels?.map((band) => (
            <option key={band.id} value={band.id}>
              {band.name}
            </option>
          ))}
        </select>
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
