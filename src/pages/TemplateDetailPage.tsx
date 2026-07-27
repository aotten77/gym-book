import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { SectionCard } from '@/components/SectionCard';
import { db } from '@/db/appDb';
import {
  deleteTemplate,
  deleteTemplateExercise,
  saveTemplateExercise,
  updateTemplate,
} from '@/db/template-actions';
import type { Exercise, TrackingMode, WorkoutTemplateExercise } from '@/domain/models';

type ExerciseSource = 'existing' | 'new';

interface TemplateExerciseFormState {
  exerciseSource: ExerciseSource;
  exerciseId: string;
  exerciseName: string;
  instructions: string;
  tempo: string;
  trackingMode: TrackingMode;
  unilateral: boolean;
  orderIndex: string;
  workSetCount: string;
  targetReps: string;
  targetSeconds: string;
  targetWeight: string;
  restSeconds: string;
  notes: string;
}

const defaultFormState: TemplateExerciseFormState = {
  exerciseSource: 'existing',
  exerciseId: '',
  exerciseName: '',
  instructions: '',
  tempo: '',
  trackingMode: 'reps_weight',
  unilateral: false,
  orderIndex: '1',
  workSetCount: '3',
  targetReps: '',
  targetSeconds: '',
  targetWeight: '',
  restSeconds: '',
  notes: '',
};

function numberToInputValue(value?: number) {
  return typeof value === 'number' ? String(value) : '';
}

function parseOptionalNumber(value: string) {
  if (!value.trim()) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function buildFormState(item?: WorkoutTemplateExercise, exercise?: Exercise): TemplateExerciseFormState {
  if (!item) {
    return defaultFormState;
  }

  return {
    exerciseSource: 'existing',
    exerciseId: item.exerciseId,
    exerciseName: '',
    instructions: '',
    tempo: '',
    trackingMode: exercise?.trackingMode ?? 'reps_weight',
    unilateral: exercise?.unilateral ?? false,
    orderIndex: String(item.orderIndex),
    workSetCount: String(item.workSetCount),
    targetReps: numberToInputValue(item.targetReps),
    targetSeconds: numberToInputValue(item.targetSeconds),
    targetWeight: numberToInputValue(item.targetWeight),
    restSeconds: numberToInputValue(item.restSeconds),
    notes: item.notes ?? '',
  };
}

export function TemplateDetailPage() {
  const { templateId = '' } = useParams();
  const navigate = useNavigate();
  const [templateName, setTemplateName] = useState('');
  const [templateNotes, setTemplateNotes] = useState('');
  const [editingTemplateExerciseId, setEditingTemplateExerciseId] = useState<string | null>(null);
  const [form, setForm] = useState<TemplateExerciseFormState>(defaultFormState);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [isSavingExercise, setIsSavingExercise] = useState(false);
  const template = useLiveQuery(() => db.workoutTemplates.get(templateId), [templateId]);
  const templateExercises = useLiveQuery(
    () => db.workoutTemplateExercises.where('templateId').equals(templateId).sortBy('orderIndex'),
    [templateId],
  );
  const exercises = useLiveQuery(() => db.exercises.toArray(), []);

  const nameById = Object.fromEntries((exercises ?? []).map((item) => [item.id, item.name]));
  const sortedExercises = useMemo(
    () => [...(exercises ?? [])].sort((left, right) => left.name.localeCompare(right.name)),
    [exercises],
  );
  const selectedExistingExercise =
    form.exerciseSource === 'existing'
      ? sortedExercises.find((item) => item.id === form.exerciseId)
      : undefined;

  useEffect(() => {
    setTemplateName(template?.name ?? '');
    setTemplateNotes(template?.notes ?? '');
  }, [template?.id, template?.name, template?.notes]);

  useEffect(() => {
    if (!templateExercises) {
      return;
    }

    if (!editingTemplateExerciseId) {
        setForm({
        ...defaultFormState,
        exerciseId: sortedExercises[0]?.id ?? '',
        orderIndex: String(templateExercises.length + 1 || 1),
        });
      return;
    }

    const item = templateExercises.find((entry) => entry.id === editingTemplateExerciseId);
    const exercise = sortedExercises.find((entry) => entry.id === item?.exerciseId);

    setForm(buildFormState(item, exercise));
  }, [editingTemplateExerciseId, sortedExercises, templateExercises]);

  async function handleSaveTemplate() {
    if (!template || !templateName.trim()) {
      return;
    }

    setIsSavingTemplate(true);

    try {
      await updateTemplate(template.id, {
        name: templateName,
        notes: templateNotes,
      });
    } finally {
      setIsSavingTemplate(false);
    }
  }

  async function handleDeleteTemplate() {
    if (!template) {
      return;
    }

    const shouldDelete = window.confirm(
      `Vorlage "${template.name}" loeschen? Bereits absolvierte Sessions bleiben erhalten.`,
    );

    if (!shouldDelete) {
      return;
    }

    await deleteTemplate(template.id);
    navigate('/templates');
  }

  async function handleSaveTemplateExercise() {
    if (!template) {
      return;
    }

    if (form.exerciseSource === 'existing' && !form.exerciseId) {
      return;
    }

    if (form.exerciseSource === 'new' && !form.exerciseName.trim()) {
      return;
    }

    setIsSavingExercise(true);

    try {
      await saveTemplateExercise({
        id: editingTemplateExerciseId ?? undefined,
        templateId: template.id,
        orderIndex: Number(form.orderIndex) || (templateExercises?.length ?? 0) + 1,
        workSetCount: Number(form.workSetCount) || 1,
        targetReps: parseOptionalNumber(form.targetReps),
        targetSeconds: parseOptionalNumber(form.targetSeconds),
        targetWeight: parseOptionalNumber(form.targetWeight),
        restSeconds: parseOptionalNumber(form.restSeconds),
        notes: form.notes,
        exerciseId: form.exerciseSource === 'existing' ? form.exerciseId : undefined,
        exerciseName: form.exerciseSource === 'new' ? form.exerciseName : undefined,
        instructions: form.exerciseSource === 'new' ? form.instructions : undefined,
        tempo: form.exerciseSource === 'new' ? form.tempo : undefined,
        trackingMode:
          form.exerciseSource === 'new'
            ? form.trackingMode
            : selectedExistingExercise?.trackingMode ?? 'reps_weight',
        unilateral:
          form.exerciseSource === 'new'
            ? form.unilateral
            : selectedExistingExercise?.unilateral ?? false,
      });

      setEditingTemplateExerciseId(null);
    } finally {
      setIsSavingExercise(false);
    }
  }

  async function handleDeleteTemplateExercise(templateExerciseId: string) {
    const shouldDelete = window.confirm('Diese Uebung aus der Vorlage entfernen?');

    if (!shouldDelete) {
      return;
    }

    await deleteTemplateExercise(templateExerciseId);

    if (editingTemplateExerciseId === templateExerciseId) {
      setEditingTemplateExerciseId(null);
    }
  }

  return (
    <AppShell title={template?.name ?? 'Vorlage'} eyebrow="Detail">
      <div className="space-y-4">
        <SectionCard
          title="Vorlagen-Metadaten"
          subtitle="Name und Fokus bleiben editierbar, ohne bereits geloggte Sessions zu verbiegen."
          action={
            <button
              type="button"
              onClick={handleDeleteTemplate}
              className="rounded-2xl border border-rose-400/20 px-3 py-2 text-sm text-rose-200 transition hover:bg-rose-400/10"
            >
              Loeschen
            </button>
          }
        >
          <div className="space-y-3">
            <input
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
              placeholder="Vorlagenname"
              className="w-full rounded-3xl border border-white/10 bg-zinc-950/45 px-4 py-4 text-sm text-zinc-50 outline-none transition placeholder:text-zinc-500 focus:border-lime-300/40"
            />
            <textarea
              value={templateNotes}
              onChange={(event) => setTemplateNotes(event.target.value)}
              placeholder="Notizen zur Einheit"
              rows={3}
              className="w-full rounded-3xl border border-white/10 bg-zinc-950/45 px-4 py-4 text-sm text-zinc-50 outline-none transition placeholder:text-zinc-500 focus:border-lime-300/40"
            />
            <button
              type="button"
              onClick={handleSaveTemplate}
              disabled={!templateName.trim() || isSavingTemplate}
              className="w-full rounded-3xl bg-lime-300 px-4 py-4 text-sm font-semibold text-zinc-950 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Vorlage speichern
            </button>
          </div>
        </SectionCard>

        <SectionCard
          title="Template-Uebungen"
          subtitle="Reihenfolge, Zielwerte und Referenzen auf globale Uebungen kommen direkt aus IndexedDB."
        >
          <div className="space-y-3">
            {(templateExercises ?? []).length > 0 ? (
              (templateExercises ?? []).map((item) => (
                <div key={item.id} className="rounded-3xl bg-zinc-950/45 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-zinc-50">
                        {item.orderIndex}. {nameById[item.exerciseId] ?? 'Unbekannte Uebung'}
                      </p>
                      <p className="mt-1 text-sm text-zinc-400">
                        {item.targetReps ? `${item.workSetCount} x ${item.targetReps} Wdh` : null}
                        {item.targetReps && item.targetSeconds ? ' · ' : null}
                        {item.targetSeconds ? `${item.workSetCount} x ${item.targetSeconds}s` : null}
                        {item.targetWeight ? ` · ${item.targetWeight} kg` : ''}
                        {item.restSeconds ? ` · Pause ${item.restSeconds}s` : ''}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingTemplateExerciseId(item.id)}
                        className="rounded-2xl border border-white/10 p-2 text-zinc-300 transition hover:bg-white/5"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteTemplateExercise(item.id)}
                        className="rounded-2xl border border-rose-400/20 p-2 text-rose-200 transition hover:bg-rose-400/10"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  {item.notes ? <p className="mt-3 text-sm text-zinc-400">{item.notes}</p> : null}
                </div>
              ))
            ) : (
              <div className="rounded-3xl border border-dashed border-white/10 bg-zinc-950/35 px-4 py-5 text-sm text-zinc-400">
                Noch keine Template-Uebungen vorhanden.
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard
          title={editingTemplateExerciseId ? 'Template-Uebung bearbeiten' : 'Template-Uebung hinzufuegen'}
          subtitle="Bestehende Uebung auswaehlen oder direkt eine neue globale Uebung anlegen."
          action={
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-lime-300/10 text-lime-200">
              <Plus size={18} />
            </div>
          }
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setForm((current) => ({ ...current, exerciseSource: 'existing' }))}
                className={`rounded-3xl px-4 py-4 text-sm font-medium transition ${
                  form.exerciseSource === 'existing'
                    ? 'bg-lime-300 text-zinc-950'
                    : 'bg-white/5 text-zinc-300 hover:bg-white/10'
                }`}
              >
                Bestehende Uebung
              </button>
              <button
                type="button"
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    exerciseSource: 'new',
                    exerciseId: '',
                  }))
                }
                className={`rounded-3xl px-4 py-4 text-sm font-medium transition ${
                  form.exerciseSource === 'new'
                    ? 'bg-lime-300 text-zinc-950'
                    : 'bg-white/5 text-zinc-300 hover:bg-white/10'
                }`}
              >
                Neue Uebung
              </button>
            </div>

            {form.exerciseSource === 'existing' ? (
              <div className="space-y-3">
                <select
                  value={form.exerciseId}
                  onChange={(event) => setForm((current) => ({ ...current, exerciseId: event.target.value }))}
                  className="w-full rounded-3xl border border-white/10 bg-zinc-950/45 px-4 py-4 text-sm text-zinc-50 outline-none transition focus:border-lime-300/40"
                >
                  {sortedExercises.map((exercise) => (
                    <option key={exercise.id} value={exercise.id}>
                      {exercise.name}
                    </option>
                  ))}
                </select>

                {selectedExistingExercise ? (
                  <div className="rounded-3xl bg-zinc-950/45 p-4 text-sm text-zinc-400">
                    <p className="font-semibold text-zinc-100">{selectedExistingExercise.name}</p>
                    <p className="mt-2">
                      Tracking: {selectedExistingExercise.trackingMode} ·{' '}
                      {selectedExistingExercise.unilateral ? 'unilateral' : 'beidseitig'}
                    </p>
                    {selectedExistingExercise.instructions ? (
                      <p className="mt-2">{selectedExistingExercise.instructions}</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="space-y-3">
                <input
                  value={form.exerciseName}
                  onChange={(event) => setForm((current) => ({ ...current, exerciseName: event.target.value }))}
                  placeholder="Uebungsname"
                  className="w-full rounded-3xl border border-white/10 bg-zinc-950/45 px-4 py-4 text-sm text-zinc-50 outline-none transition placeholder:text-zinc-500 focus:border-lime-300/40"
                />
                <textarea
                  value={form.instructions}
                  onChange={(event) => setForm((current) => ({ ...current, instructions: event.target.value }))}
                  placeholder="Ausfuehrungshinweis"
                  rows={3}
                  className="w-full rounded-3xl border border-white/10 bg-zinc-950/45 px-4 py-4 text-sm text-zinc-50 outline-none transition placeholder:text-zinc-500 focus:border-lime-300/40"
                />
                <input
                  value={form.tempo}
                  onChange={(event) => setForm((current) => ({ ...current, tempo: event.target.value }))}
                  placeholder="Tempo, z. B. 4-1-1"
                  className="w-full rounded-3xl border border-white/10 bg-zinc-950/45 px-4 py-4 text-sm text-zinc-50 outline-none transition placeholder:text-zinc-500 focus:border-lime-300/40"
                />
                <div className="grid grid-cols-2 gap-3">
                  <select
                    value={form.trackingMode}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        trackingMode: event.target.value as TrackingMode,
                      }))
                    }
                    className="rounded-3xl border border-white/10 bg-zinc-950/45 px-4 py-4 text-sm text-zinc-50 outline-none transition focus:border-lime-300/40"
                  >
                    <option value="reps_weight">Wdh + Gewicht</option>
                    <option value="time">Sekunden</option>
                    <option value="time_weight">Sekunden + Gewicht</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => setForm((current) => ({ ...current, unilateral: !current.unilateral }))}
                    className={`rounded-3xl px-4 py-4 text-sm font-medium transition ${
                      form.unilateral
                        ? 'bg-lime-300 text-zinc-950'
                        : 'bg-white/5 text-zinc-300 hover:bg-white/10'
                    }`}
                  >
                    {form.unilateral ? 'Unilateral' : 'Beidseitig'}
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <input
                value={form.orderIndex}
                onChange={(event) => setForm((current) => ({ ...current, orderIndex: event.target.value }))}
                inputMode="numeric"
                placeholder="Reihenfolge"
                className="rounded-3xl border border-white/10 bg-zinc-950/45 px-4 py-4 text-sm text-zinc-50 outline-none transition placeholder:text-zinc-500 focus:border-lime-300/40"
              />
              <input
                value={form.workSetCount}
                onChange={(event) => setForm((current) => ({ ...current, workSetCount: event.target.value }))}
                inputMode="numeric"
                placeholder="Arbeitssaetze"
                className="rounded-3xl border border-white/10 bg-zinc-950/45 px-4 py-4 text-sm text-zinc-50 outline-none transition placeholder:text-zinc-500 focus:border-lime-300/40"
              />
            </div>

            {(form.exerciseSource === 'new' ? form.trackingMode : selectedExistingExercise?.trackingMode) ===
            'reps_weight' ? (
              <input
                value={form.targetReps}
                onChange={(event) => setForm((current) => ({ ...current, targetReps: event.target.value }))}
                inputMode="numeric"
                placeholder="Ziel-Wdh"
                className="w-full rounded-3xl border border-white/10 bg-zinc-950/45 px-4 py-4 text-sm text-zinc-50 outline-none transition placeholder:text-zinc-500 focus:border-lime-300/40"
              />
            ) : null}

            {(form.exerciseSource === 'new' ? form.trackingMode : selectedExistingExercise?.trackingMode) !==
            'reps_weight' ? (
              <input
                value={form.targetSeconds}
                onChange={(event) => setForm((current) => ({ ...current, targetSeconds: event.target.value }))}
                inputMode="decimal"
                placeholder="Ziel-Sekunden"
                className="w-full rounded-3xl border border-white/10 bg-zinc-950/45 px-4 py-4 text-sm text-zinc-50 outline-none transition placeholder:text-zinc-500 focus:border-lime-300/40"
              />
            ) : null}

            {(form.exerciseSource === 'new' ? form.trackingMode : selectedExistingExercise?.trackingMode) !==
            'time' ? (
              <input
                value={form.targetWeight}
                onChange={(event) => setForm((current) => ({ ...current, targetWeight: event.target.value }))}
                inputMode="decimal"
                placeholder="Ziel-Gewicht in kg"
                className="w-full rounded-3xl border border-white/10 bg-zinc-950/45 px-4 py-4 text-sm text-zinc-50 outline-none transition placeholder:text-zinc-500 focus:border-lime-300/40"
              />
            ) : null}

            <input
              value={form.restSeconds}
              onChange={(event) => setForm((current) => ({ ...current, restSeconds: event.target.value }))}
              inputMode="numeric"
              placeholder="Pause in Sekunden"
              className="w-full rounded-3xl border border-white/10 bg-zinc-950/45 px-4 py-4 text-sm text-zinc-50 outline-none transition placeholder:text-zinc-500 focus:border-lime-300/40"
            />

            <textarea
              value={form.notes}
              onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
              placeholder="Template-spezifische Notiz"
              rows={3}
              className="w-full rounded-3xl border border-white/10 bg-zinc-950/45 px-4 py-4 text-sm text-zinc-50 outline-none transition placeholder:text-zinc-500 focus:border-lime-300/40"
            />

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={handleSaveTemplateExercise}
                disabled={isSavingExercise}
                className="rounded-3xl bg-lime-300 px-4 py-4 text-sm font-semibold text-zinc-950 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {editingTemplateExerciseId ? 'Aenderung speichern' : 'Uebung hinzufuegen'}
              </button>
              <button
                type="button"
                onClick={() => setEditingTemplateExerciseId(null)}
                className="rounded-3xl bg-white/5 px-4 py-4 text-sm font-medium text-zinc-300 transition hover:bg-white/10"
              >
                Zuruecksetzen
              </button>
            </div>
          </div>
        </SectionCard>
      </div>
    </AppShell>
  );
}
