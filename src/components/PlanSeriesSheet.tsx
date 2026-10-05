import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Alert } from '@/components/Alert';
import { PlanKindSwitch } from '@/components/PlanKindSwitch';
import { PlanRunTargetFields } from '@/components/PlanRunTargetFields';
import { WeekdayPicker } from '@/components/WeekdayPicker';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';
import { db } from '@/db/appDb';
import { createPlanSeries } from '@/db/plan-actions';
import {
  readPlanEntryForm,
  toPlanEntryFormState,
  type PlanEntryFormField,
  type PlanEntryFormState,
} from '@/domain/plan-entry-form';
import type { IsoWeekday } from '@/domain/training-calendar';
import { parseNumberInput } from '@/lib/number-input';

interface PlanSeriesSheetProps {
  open: boolean;
  defaultStartDate: string;
  onClose: () => void;
}

const MAX_SERIES_WEEKS = 26;
const DEFAULT_SERIES_WEEKS = '4';

/**
 * Eine Serie legt dasselbe Workout oder dieselbe Laufvorgabe an mehreren
 * Wochentagen über mehrere Wochen an. Das Sheet bleibt nach dem Anlegen offen
 * und meldet, wie viele Termine entstanden und wie viele schon da waren.
 */
export function PlanSeriesSheet({ open, defaultStartDate, onClose }: PlanSeriesSheetProps) {
  const [form, setForm] = useState<PlanEntryFormState>(() =>
    toPlanEntryFormState(undefined, { date: defaultStartDate }),
  );
  const [weekdays, setWeekdays] = useState<IsoWeekday[]>([]);
  const [weeks, setWeeks] = useState(DEFAULT_SERIES_WEEKS);
  const [touched, setTouched] = useState<ReadonlySet<PlanEntryFormField>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const templates = useLiveQuery(() => db.workoutTemplates.toArray(), []);
  const sortedTemplates = useMemo(
    () => [...(templates ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'de')),
    [templates],
  );

  useEffect(() => {
    if (open) {
      setForm(toPlanEntryFormState(undefined, { date: defaultStartDate }));
      setWeekdays([]);
      setWeeks(DEFAULT_SERIES_WEEKS);
      setTouched(new Set());
      setIsSaving(false);
      setError(null);
      setResult(null);
    }
    // Nur beim Öffnen: ein Wechsel der Woche dahinter darf den Entwurf nicht kippen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const { values, errors } = useMemo(() => readPlanEntryForm(form), [form]);
  const parsedWeeks = parseNumberInput(weeks);
  const weekCount =
    parsedWeeks.status === 'valid' &&
    Number.isInteger(parsedWeeks.value) &&
    parsedWeeks.value >= 1 &&
    parsedWeeks.value <= MAX_SERIES_WEEKS
      ? parsedWeeks.value
      : undefined;
  const canSave = Boolean(values) && weekdays.length > 0 && weekCount !== undefined;

  function setField(field: PlanEntryFormField, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setTouched((current) => new Set(current).add(field));
    setResult(null);
  }

  const touch = (field: PlanEntryFormField) =>
    setTouched((current) => new Set(current).add(field));
  const errorFor = (field: PlanEntryFormField) => (touched.has(field) ? errors[field] : undefined);

  async function handleSave() {
    if (!values || weekCount === undefined || isSaving) {
      return;
    }

    setIsSaving(true);
    setError(null);
    setResult(null);

    try {
      const { date, ...rest } = values;
      const { created, skipped } = await createPlanSeries({
        values: rest,
        weekdays,
        startDate: date,
        weeks: weekCount,
      });

      setResult(`${created} angelegt, ${skipped} gab es schon`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Die Serie konnte nicht angelegt werden.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      label="Serie anlegen"
      closeLabel="Serie schließen"
      header={<h2 className="font-display text-xl font-bold text-content">Serie anlegen</h2>}
      footer={
        <Button
          variant="primary"
          fullWidth
          className="min-h-[3.875rem]"
          disabled={!canSave || isSaving}
          onClick={() => void handleSave()}
        >
          Serie anlegen
        </Button>
      }
      fieldNavigation
      onClose={onClose}
    >
      <div className="space-y-4">
        {error ? <Alert variant="error">{error}</Alert> : null}
        {result ? <Alert variant="success">{result}</Alert> : null}

        <PlanKindSwitch
          value={form.kind === 'run' ? 'run' : 'workout'}
          onChange={(kind) => setField('kind', kind)}
        />

        {form.kind === 'run' ? (
          <PlanRunTargetFields form={form} errorFor={errorFor} onChange={setField} onTouch={touch} />
        ) : (
          <SelectField
            label="Workout"
            value={form.templateId}
            error={errorFor('templateId')}
            onChange={(event) => setField('templateId', event.target.value)}
            onBlur={() => touch('templateId')}
          >
            <option value="">Workout wählen</option>
            {sortedTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </SelectField>
        )}

        <WeekdayPicker
          value={weekdays}
          onChange={(next) => {
            setWeekdays(next);
            setResult(null);
          }}
        />

        <TextField
          label="Startdatum"
          type="date"
          value={form.date}
          error={errorFor('date')}
          onChange={(event) => setField('date', event.target.value)}
          onBlur={() => touch('date')}
        />
        <TextField
          label="Wochen"
          inputMode="numeric"
          autoComplete="off"
          hint={`1 bis ${MAX_SERIES_WEEKS}`}
          value={weeks}
          error={weekCount === undefined ? `Bitte 1 bis ${MAX_SERIES_WEEKS} Wochen.` : undefined}
          onChange={(event) => {
            setWeeks(event.target.value);
            setResult(null);
          }}
        />
      </div>
    </Sheet>
  );
}
