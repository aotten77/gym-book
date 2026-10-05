import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Alert } from '@/components/Alert';
import { PlanKindSwitch } from '@/components/PlanKindSwitch';
import { PlanRunTargetFields } from '@/components/PlanRunTargetFields';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SelectField, TextArea, TextField } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';
import { db } from '@/db/appDb';
import { createPlanEntry, deletePlanEntry, updatePlanEntry } from '@/db/plan-actions';
import { loadPlanBetween } from '@/db/plan-queries';
import type { PlanEntry } from '@/domain/models';
import { planEntryName } from '@/domain/plan';
import {
  readPlanEntryForm,
  toPlanEntryFormState,
  type PlanEntryFormField,
  type PlanEntryFormState,
} from '@/domain/plan-entry-form';
import { toDateInputValue } from '@/domain/program';
import { formatRunDate } from '@/lib/format';

interface PlanEntrySheetProps {
  open: boolean;
  /** Ohne Termin wird ein neuer angelegt, mit Termin dieser bearbeitet. */
  entry?: PlanEntry;
  defaultDate: string;
  onClose: () => void;
}

/**
 * Das Formular für einen Einzeltermin. Ein bereits trainierter Termin lässt
 * sich nicht mehr ändern (`PLAN_MESSAGES.taken`) - das Sheet zeigt dann nur,
 * was daraus wurde, und führt zur Session bzw. zum Lauf.
 */
export function PlanEntrySheet({ open, entry, defaultDate, onClose }: PlanEntrySheetProps) {
  const [form, setForm] = useState<PlanEntryFormState>(() =>
    toPlanEntryFormState(entry, { date: defaultDate }),
  );
  const [touched, setTouched] = useState<ReadonlySet<PlanEntryFormField>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const templates = useLiveQuery(() => db.workoutTemplates.toArray(), []);
  const entryPlan = useLiveQuery(
    () => (entry ? loadPlanBetween(entry.date, entry.date) : Promise.resolve(undefined)),
    [entry?.id, entry?.date],
  );
  const link = entry ? entryPlan?.links[entry.id] : undefined;

  // Bei jedem Öffnen frisch: ein abgebrochener Entwurf bleibt nicht hängen.
  useEffect(() => {
    if (open) {
      setForm(toPlanEntryFormState(entry, { date: defaultDate }));
      setTouched(new Set());
      setSaveError(null);
      setIsSaving(false);
      setConfirmDelete(false);
    }
    // `entry` bewusst nicht in den Abhängigkeiten: ein Live-Update darf das
    // Formular unter den Fingern nicht zurücksetzen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entry?.id]);

  const templateNames = useMemo(
    () =>
      (templates ?? []).reduce<Record<string, string>>((names, template) => {
        names[template.id] = template.name;
        return names;
      }, {}),
    [templates],
  );
  const sortedTemplates = useMemo(
    () => [...(templates ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'de')),
    [templates],
  );
  const { values, errors } = useMemo(() => readPlanEntryForm(form), [form]);

  function setField(field: PlanEntryFormField, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setTouched((current) => new Set(current).add(field));
  }

  const touch = (field: PlanEntryFormField) =>
    setTouched((current) => new Set(current).add(field));
  const errorFor = (field: PlanEntryFormField) => (touched.has(field) ? errors[field] : undefined);

  async function handleSave() {
    if (!values || isSaving) {
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      if (entry) {
        await updatePlanEntry(entry.id, values);
      } else {
        await createPlanEntry(values);
      }
      onClose();
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : 'Der Termin konnte nicht gespeichert werden.',
      );
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!entry) {
      return;
    }

    setIsSaving(true);

    try {
      await deletePlanEntry(entry.id);
      setConfirmDelete(false);
      onClose();
    } catch (error) {
      setConfirmDelete(false);
      setSaveError(
        error instanceof Error ? error.message : 'Der Termin konnte nicht gelöscht werden.',
      );
      setIsSaving(false);
    }
  }

  const title = entry ? 'Termin bearbeiten' : 'Termin hinzufügen';
  const header = <h2 className="font-display text-xl font-bold text-content">{title}</h2>;

  if (entry && link) {
    const doneDay = link.doneAt ? formatRunDate(toDateInputValue(new Date(link.doneAt))) : undefined;

    return (
      <Sheet open={open} label={title} closeLabel="Termin schließen" header={header} onClose={onClose}>
        <div className="space-y-4">
          <p className="font-display text-lg font-bold text-content">
            {planEntryName(entry, templateNames, entryPlan?.links ?? {})}
          </p>
          <p className="text-sm text-content-secondary">
            {link.done ? `Erledigt am ${doneDay ?? formatRunDate(entry.date)}` : 'Läuft gerade'}
          </p>
          <Link
            to={link.source === 'session' ? `/history/session/${link.sourceId}` : `/runs/${link.sourceId}`}
            className="min-h-touch inline-flex items-center rounded-control border border-line px-4 py-2 text-sm font-semibold text-content hover:bg-surface-raised"
          >
            {link.source === 'session' ? 'Zur Session' : 'Zum Lauf'}
          </Link>
        </div>
      </Sheet>
    );
  }

  return (
    <>
      <Sheet
        open={open}
        label={title}
        closeLabel="Termin schließen"
        header={header}
        footer={
          <div className="space-y-2">
            <Button
              variant="primary"
              fullWidth
              className="min-h-[3.875rem]"
              disabled={!values || isSaving}
              onClick={() => void handleSave()}
            >
              Termin speichern
            </Button>
            {entry ? (
              <Button
                variant="danger"
                fullWidth
                disabled={isSaving}
                onClick={() => setConfirmDelete(true)}
              >
                Termin löschen
              </Button>
            ) : null}
          </div>
        }
        fieldNavigation
        onClose={onClose}
      >
        <div className="space-y-4">
          {saveError ? <Alert variant="error">{saveError}</Alert> : null}

          <PlanKindSwitch
            value={form.kind === 'run' ? 'run' : 'workout'}
            onChange={(kind) => setField('kind', kind)}
          />

          <TextField
            label="Datum"
            type="date"
            value={form.date}
            error={errorFor('date')}
            onChange={(event) => setField('date', event.target.value)}
            onBlur={() => touch('date')}
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

          <TextArea
            label="Notiz"
            rows={3}
            value={form.notes}
            onChange={(event) => setField('notes', event.target.value)}
          />
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirmDelete}
        title="Termin löschen?"
        description="Der Termin verschwindet aus dem Plan. Trainiertes bleibt unberührt."
        busy={isSaving}
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
