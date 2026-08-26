import { SelectField, TextArea, TextField } from '@/components/ui/Field';
import type { BandLevel, LoadKind, TrackingMode } from '@/domain/models';
import type { FoldedTargets } from '@/domain/progression-fold';
import type { ProgressionRuleFormState } from '@/domain/progression-rule-form';
import {
  supportsBand,
  supportsHeight,
  supportsReps,
  supportsSeconds,
  supportsWeight,
} from '@/domain/tracking';
import { formatNumber } from '@/lib/format';

/**
 * Die Wochenwerte einer Übung als Formular.
 *
 * Bewusst **nicht** [ExerciseTargetFields]: die trägt `restSeconds` und die
 * Zahl der Arbeitssätze - beides kann eine Wochenregel nicht überschreiben,
 * und ein Feld anzubieten, das nirgends ankommt, ist schlimmer als keines.
 *
 * Gebaut auf `TextField`/`SelectField`/`TextArea`, also mit echtem
 * `<label for>` statt der rohen Inputs mit Placeholder-Beschriftung, die
 * hier vorher standen: ein Placeholder verschwindet beim Tippen, und genau
 * dann braucht man ihn.
 *
 * **Die Basiswerte stehen als Placeholder.** Ein leeres Feld heißt damit
 * sichtbar "wie im Workout" - das ist die Bedeutung, die `foldProgressionRule`
 * dem fehlenden Wert gibt, und sie muss am Feld ablesbar sein, sonst liest
 * sich leer wie "nichts vorgegeben".
 */
interface ProgressionRuleFieldsProps {
  value: ProgressionRuleFormState;
  onChange: (next: ProgressionRuleFormState) => void;
  /** Erfassung der Übung - entscheidet, welche Felder es überhaupt gibt. */
  trackingMode?: TrackingMode;
  loadKind?: LoadKind;
  tracksHeight?: boolean;
  /** Die Werte des Workouts - sie stehen als Placeholder in den Feldern. */
  baseTargets?: FoldedTargets;
  bandLevels?: BandLevel[];
  disabled?: boolean;
}

export function ProgressionRuleFields({
  value,
  onChange,
  trackingMode,
  loadKind,
  tracksHeight,
  baseTargets,
  bandLevels,
  disabled,
}: ProgressionRuleFieldsProps) {
  const set = (field: keyof ProgressionRuleFormState, next: string) =>
    onChange({ ...value, [field]: next });
  /** Der Basiswert als Placeholder, sonst der Hinweis auf sein Fehlen. */
  const basePlaceholder = (base: number | undefined, unit?: string) =>
    typeof base === 'number'
      ? `${formatNumber(base)}${unit ? ` ${unit}` : ''}`
      : 'ohne Vorgabe';
  const baseBandName = baseTargets?.targetBandId
    ? bandLevels?.find((band) => band.id === baseTargets.targetBandId)?.name
    : undefined;

  return (
    <div className="space-y-3">
      {/*
        Die Satzzahl steht oben und hängt an keinem Tracking-Modus: sie ist
        das eine Feld, mit dem sich eine Deload-Woche wirklich ausdrücken
        lässt (zwei Sätze statt vier), und jede Übung hat sie.
      */}
      <TextField
        label="Arbeitssätze"
        inputMode="numeric"
        value={value.workSetCount}
        placeholder={basePlaceholder(baseTargets?.workSetCount)}
        onChange={(event) => set('workSetCount', event.target.value)}
        disabled={disabled}
      />

      {supportsReps(trackingMode) ? (
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Ziel-Wdh"
            inputMode="numeric"
            value={value.targetReps}
            placeholder={basePlaceholder(baseTargets?.targetReps)}
            onChange={(event) => set('targetReps', event.target.value)}
            disabled={disabled}
          />
          <TextField
            label="Ziel-Wdh bis"
            inputMode="numeric"
            value={value.targetRepsMax}
            placeholder={basePlaceholder(baseTargets?.targetRepsMax)}
            onChange={(event) => set('targetRepsMax', event.target.value)}
            disabled={disabled}
          />
        </div>
      ) : null}

      {supportsSeconds(trackingMode) ? (
        <TextField
          label="Ziel-Sekunden"
          inputMode="decimal"
          value={value.targetSeconds}
          placeholder={basePlaceholder(baseTargets?.targetSeconds, 's')}
          onChange={(event) => set('targetSeconds', event.target.value)}
          disabled={disabled}
        />
      ) : null}

      {supportsWeight(trackingMode, loadKind) ? (
        <TextField
          label="Ziel-Gewicht in kg"
          inputMode="decimal"
          value={value.targetWeight}
          placeholder={basePlaceholder(baseTargets?.targetWeight, 'kg')}
          onChange={(event) => set('targetWeight', event.target.value)}
          disabled={disabled}
        />
      ) : null}

      {supportsHeight(tracksHeight) ? (
        <TextField
          label="Ziel-Höhe in cm"
          inputMode="decimal"
          value={value.targetHeightCm}
          placeholder={basePlaceholder(baseTargets?.targetHeightCm, 'cm')}
          onChange={(event) => set('targetHeightCm', event.target.value)}
          disabled={disabled}
        />
      ) : null}

      {supportsBand(trackingMode, loadKind) ? (
        <SelectField
          label="Ziel-Band"
          value={value.targetBandId}
          onChange={(event) => set('targetBandId', event.target.value)}
          disabled={disabled}
        >
          <option value="">
            {bandLevels?.length
              ? `Wie im Workout${baseBandName ? ` (${baseBandName})` : ''}`
              : 'Noch keine Bänder angelegt'}
          </option>
          {bandLevels?.map((band) => (
            <option key={band.id} value={band.id}>
              {band.name}
            </option>
          ))}
        </SelectField>
      ) : null}

      <TextArea
        label="Notiz für diese Woche"
        rows={2}
        value={value.notes}
        placeholder={baseTargets?.notes ? baseTargets.notes : 'ohne Notiz'}
        onChange={(event) => set('notes', event.target.value)}
        disabled={disabled}
      />
    </div>
  );
}
