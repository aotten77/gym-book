import { useId } from 'react';
import { TextArea, TextField } from '@/components/ui/Field';
import type { PlanEntryFormField, PlanEntryFormState } from '@/domain/plan-entry-form';

interface PlanRunTargetFieldsProps {
  form: PlanEntryFormState;
  errorFor: (field: PlanEntryFormField) => string | undefined;
  onChange: (field: PlanEntryFormField, value: string) => void;
  onTouch: (field: PlanEntryFormField) => void;
}

/**
 * Die Vorgabefelder eines Lauf-Termins. Termin-Sheet und Serien-Sheet teilen
 * sie - zwei Kopien würden bei der ersten neuen Vorgabe auseinanderlaufen.
 * Der Zustand gehört dem Aufrufer; hier steht nur, wie er dargestellt wird.
 */
export function PlanRunTargetFields({ form, errorFor, onChange, onTouch }: PlanRunTargetFieldsProps) {
  // `hours` trägt auch den Fehler der ganzen Dauer ("Dauer bitte über 0.") - er steht unter dem Fieldset.
  const hoursError = errorFor('hours');
  const durationError = hoursError ?? errorFor('minutes') ?? errorFor('seconds');
  const durationErrorId = useId();

  const text = (field: PlanEntryFormField) => ({
    value: form[field],
    error: errorFor(field),
    onChange: (event: { target: { value: string } }) => onChange(field, event.target.value),
    onBlur: () => onTouch(field),
  });

  return (
    <div className="space-y-4">
      <TextField label="Titel" autoComplete="off" {...text('title')} />
      <TextField label="Strecke (km)" inputMode="decimal" autoComplete="off" {...text('distance')} />

      <fieldset>
        <legend className="mb-1.5 text-xs font-medium text-content-muted">Dauer</legend>
        <div className="grid grid-cols-3 gap-3">
          <TextField
            label="Std"
            inputMode="numeric"
            autoComplete="off"
            value={form.hours}
            aria-invalid={durationError ? true : undefined}
            aria-describedby={hoursError ? durationErrorId : undefined}
            onChange={(event) => onChange('hours', event.target.value)}
            onBlur={() => onTouch('hours')}
          />
          <TextField label="Min" inputMode="numeric" autoComplete="off" {...text('minutes')} />
          <TextField label="Sek" inputMode="numeric" autoComplete="off" {...text('seconds')} />
        </div>
        {hoursError ? (
          <p id={durationErrorId} role="alert" className="mt-1.5 text-xs text-danger">
            {hoursError}
          </p>
        ) : null}
      </fieldset>

      <TextField
        label="Pace (m:ss pro km)"
        inputMode="text"
        autoComplete="off"
        placeholder="5:30"
        {...text('pace')}
      />
      <TextField label="Höhenmeter" inputMode="numeric" autoComplete="off" {...text('elevation')} />
      <TextField label="Ø Puls (bpm)" inputMode="numeric" autoComplete="off" {...text('heartRate')} />
      <TextArea
        label="Anleitung"
        rows={4}
        hint="Markdown: **fett**, Listen mit -"
        value={form.instructions}
        onChange={(event) => onChange('instructions', event.target.value)}
      />
    </div>
  );
}
