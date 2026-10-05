import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronDown } from 'lucide-react';
import { MarkdownText } from '@/components/MarkdownText';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { SelectField, TextArea, TextField } from '@/components/ui/Field';
import { loadRunPlanOptions } from '@/db/plan-queries';
import { buildExerciseGuide } from '@/domain/exercise-guide';
import { describeRunTarget, findMatchingPlanEntry } from '@/domain/plan';
import { createRunLog, updateRunLog } from '@/db/run-actions';
import type { RunLog } from '@/domain/models';
import { toDateInputValue } from '@/domain/program';
import { formatPace } from '@/domain/run';
import { formatRunDate } from '@/lib/format';
import { readRunForm, toRunFormState, type RunFormField, type RunFormState } from '@/domain/run-form';

interface RunLogSheetProps {
  open: boolean;
  /** Ohne Lauf wird ein neuer angelegt, mit Lauf dieser bearbeitet. */
  run?: RunLog;
  /** Der Lauf-Termin, von dem aus das Sheet geöffnet wurde (Home: "Heute"). */
  initialPlanEntryId?: string;
  onClose: () => void;
}

/**
 * Die Anleitung des Termins als eine Zeile, die aufklappt - das Muster der
 * Ausführungszeile in der Session. Anders als dort steht der Text gleich hier
 * statt in einem Dialog: das Sheet ist schon die Ebene, auf der man ihn liest.
 */
function RunInstructions({ instructions }: { instructions: string }) {
  const [expanded, setExpanded] = useState(false);
  const guide = buildExerciseGuide({ instructions });

  if (!guide) {
    return null;
  }

  return (
    <div data-run-instructions="" className="rounded-panel bg-surface-raised">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="flex min-h-touch w-full items-center gap-2 rounded-panel px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.16em] text-content-muted">
          Anleitung
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-content">
          {expanded ? '' : guide.teaser}
        </span>
        <ChevronDown
          size={18}
          aria-hidden="true"
          className={expanded ? 'shrink-0 rotate-180 text-content-muted' : 'shrink-0 text-content-muted'}
        />
      </button>
      {expanded ? (
        <div className="px-3 pb-3 text-[15px] text-content-secondary">
          <MarkdownText blocks={guide.blocks} compact />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Das Formular für einen Lauf. Die Umrechnung zwischen Feld und Datensatz
 * steht in `run-form.ts`, hier steht nur, was davon wann sichtbar wird:
 * ein Fehler erst, wenn das Feld berührt wurde - ein leeres Formular soll
 * nicht beim Öffnen schon schimpfen.
 */
export function RunLogSheet({ open, run, initialPlanEntryId, onClose }: RunLogSheetProps) {
  const [form, setForm] = useState<RunFormState>(() => toRunFormState(run, new Date()));
  const [touched, setTouched] = useState<ReadonlySet<RunFormField>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // `undefined` = nicht von Hand gewählt: dann rechnet das Sheet die Vorwahl mit dem Datum neu.
  const [manualPlanEntryId, setManualPlanEntryId] = useState<string | undefined>();

  // Bei jedem Öffnen frisch: ein abgebrochener Entwurf bleibt nicht hängen.
  useEffect(() => {
    if (open) {
      setForm(toRunFormState(run, new Date()));
      setTouched(new Set());
      setSaveError(null);
      setIsSaving(false);
      setManualPlanEntryId(undefined);
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

  const planOptions = useLiveQuery(
    () => (open ? loadRunPlanOptions(form.date, run?.id) : Promise.resolve([])),
    [open, form.date, run?.id],
  );
  const options = planOptions ?? [];
  const autoPlanEntryId =
    run?.planEntryId ??
    initialPlanEntryId ??
    findMatchingPlanEntry(options, { kind: 'run', day: form.date, takenIds: new Set() })?.id ??
    '';
  const wantedPlanEntryId = manualPlanEntryId ?? autoPlanEntryId;
  // Ein Verweis auf einen Termin, den es hier nicht (mehr) zur Wahl gibt, wäre im Select unsichtbar.
  const planEntryId = options.some((entry) => entry.id === wantedPlanEntryId) ? wantedPlanEntryId : '';
  const planEntry = options.find((entry) => entry.id === planEntryId);
  const planTarget = planEntry ? describeRunTarget(planEntry) : '';

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
      // `null` löst den Verweis, `''` hieße in den Actions "nicht anfassen".
      const input = { ...values, planEntryId: planEntryId || null };

      if (run) {
        await updateRunLog(run.id, input);
      } else {
        await createRunLog(input);
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
        {options.length > 0 || planEntryId ? (
          <div className="space-y-2">
            <SelectField
              label="Geplanter Lauf"
              data-run-plan=""
              value={planEntryId}
              onChange={(event) => setManualPlanEntryId(event.target.value)}
            >
              <option value="">Keiner</option>
              {options.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {`${entry.title ?? 'Lauf'} · ${formatRunDate(entry.date)}`}
                </option>
              ))}
            </SelectField>
            {planTarget ? (
              <p data-run-target="" className="text-sm text-content-secondary">
                {planTarget}
              </p>
            ) : null}
            {planEntry?.instructions ? <RunInstructions instructions={planEntry.instructions} /> : null}
          </div>
        ) : null}
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
