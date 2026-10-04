import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { TextArea, TextField } from '@/components/ui/Field';
import { createRunLog, updateRunLog } from '@/db/run-actions';
import type { RunLog } from '@/domain/models';
import { toDateInputValue } from '@/domain/program';
import { formatPace } from '@/domain/run';
import { readRunForm, toRunFormState, type RunFormField, type RunFormState } from '@/domain/run-form';

interface RunLogSheetProps {
  open: boolean;
  /** Ohne Lauf wird ein neuer angelegt, mit Lauf dieser bearbeitet. */
  run?: RunLog;
  onClose: () => void;
}

/**
 * Das Formular für einen Lauf. Die Umrechnung zwischen Feld und Datensatz
 * steht in `run-form.ts`, hier steht nur, was davon wann sichtbar wird:
 * ein Fehler erst, wenn das Feld berührt wurde - ein leeres Formular soll
 * nicht beim Öffnen schon schimpfen.
 */
export function RunLogSheet({ open, run, onClose }: RunLogSheetProps) {
  const [form, setForm] = useState<RunFormState>(() => toRunFormState(run, new Date()));
  const [touched, setTouched] = useState<ReadonlySet<RunFormField>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Bei jedem Öffnen frisch: ein abgebrochener Entwurf bleibt nicht hängen.
  useEffect(() => {
    if (open) {
      setForm(toRunFormState(run, new Date()));
      setTouched(new Set());
      setSaveError(null);
      setIsSaving(false);
    }
    // `run` bewusst nicht in den Abhängigkeiten: ein Live-Update des Laufs
    // darf das Formular unter den Fingern nicht zurücksetzen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const today = new Date();
  const { values, errors, paceSecondsPerKm } = useMemo(
    () => readRunForm(form, new Date()),
    [form],
  );

  function setField(field: RunFormField, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setTouched((current) => new Set(current).add(field));
  }

  const touch = (field: RunFormField) => () =>
    setTouched((current) => new Set(current).add(field));

  const errorFor = (field: RunFormField) => (touched.has(field) ? errors[field] : undefined);
  const durationTouched =
    touched.has('hours') || touched.has('minutes') || touched.has('seconds');
  const durationError = durationTouched ? errors.hours : undefined;

  async function handleSave() {
    if (!values || isSaving) {
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      if (run) {
        await updateRunLog(run.id, values);
      } else {
        await createRunLog(values);
      }
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Der Lauf konnte nicht gespeichert werden.');
      setIsSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      label={run ? 'Lauf bearbeiten' : 'Lauf eintragen'}
      closeLabel="Lauf schließen"
      header={
        <h2 className="font-display text-xl font-bold text-content">
          {run ? 'Lauf bearbeiten' : 'Lauf eintragen'}
        </h2>
      }
      footer={
        <div className="space-y-2">
          {saveError ? (
            <p role="alert" className="text-sm text-danger">
              {saveError}
            </p>
          ) : null}
          <Button
            variant="primary"
            fullWidth
            className="min-h-[3.875rem]"
            disabled={!values || isSaving}
            onClick={() => void handleSave()}
          >
            Lauf speichern
          </Button>
        </div>
      }
      fieldNavigation
      onClose={onClose}
    >
      <div className="space-y-4">
        <TextField
          label="Datum"
          type="date"
          max={toDateInputValue(today)}
          value={form.date}
          error={errorFor('date')}
          onChange={(event) => setField('date', event.target.value)}
          onBlur={touch('date')}
        />
        <TextField
          label="Strecke (km)"
          inputMode="decimal"
          autoComplete="off"
          value={form.distance}
          error={errorFor('distance')}
          onChange={(event) => setField('distance', event.target.value)}
          onBlur={touch('distance')}
        />

        <fieldset>
          <legend className="mb-1.5 text-xs font-medium text-content-muted">Dauer</legend>
          <div className="grid grid-cols-3 gap-3">
            <TextField
              label="Std"
              inputMode="numeric"
              autoComplete="off"
              value={form.hours}
              aria-invalid={durationError ? true : undefined}
              aria-describedby={durationError ? 'run-duration-error' : undefined}
              onChange={(event) => setField('hours', event.target.value)}
              onBlur={touch('hours')}
            />
            <TextField
              label="Min"
              inputMode="numeric"
              autoComplete="off"
              value={form.minutes}
              error={errorFor('minutes')}
              onChange={(event) => setField('minutes', event.target.value)}
              onBlur={touch('minutes')}
            />
            <TextField
              label="Sek"
              inputMode="numeric"
              autoComplete="off"
              value={form.seconds}
              error={errorFor('seconds')}
              onChange={(event) => setField('seconds', event.target.value)}
              onBlur={touch('seconds')}
            />
          </div>
          {durationError ? (
            <p id="run-duration-error" role="alert" className="mt-1.5 text-xs text-danger">
              {durationError}
            </p>
          ) : null}
          {paceSecondsPerKm !== undefined ? (
            <p data-run-pace="" className="mt-2 text-sm text-content-secondary">
              {`${formatPace(paceSecondsPerKm)} /km`}
            </p>
          ) : null}
        </fieldset>

        <TextField
          label="Höhenmeter"
          inputMode="numeric"
          autoComplete="off"
          value={form.elevation}
          error={errorFor('elevation')}
          onChange={(event) => setField('elevation', event.target.value)}
          onBlur={touch('elevation')}
        />
        <TextField
          label="Ø Puls (bpm)"
          inputMode="numeric"
          autoComplete="off"
          value={form.heartRate}
          error={errorFor('heartRate')}
          onChange={(event) => setField('heartRate', event.target.value)}
          onBlur={touch('heartRate')}
        />
        <TextArea
          label="Notiz"
          rows={3}
          value={form.notes}
          onChange={(event) => setField('notes', event.target.value)}
        />
      </div>
    </Sheet>
  );
}
