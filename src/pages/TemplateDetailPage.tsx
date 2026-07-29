import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { IconButton } from '@/components/ui/Button';
import { CheckboxField } from '@/components/ui/Field';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ExerciseMedia } from '@/components/ExerciseMedia';
import { ExerciseTargetFields } from '@/components/ExerciseTargetFields';
import { SectionCard } from '@/components/SectionCard';
import { TemplateProgressionSection } from '@/components/TemplateProgressionSection';
import { db } from '@/db/appDb';
import { clearExerciseMedia, replaceExerciseMedia } from '@/db/media-actions';
import {
  deleteTemplate,
  deleteTemplateExercise,
  reorderTemplateExercises,
  saveTemplateExercise,
  updateTemplate,
} from '@/db/template-actions';
import type { MediaAsset, WorkoutTemplateExercise } from '@/domain/models';
import { moveItem } from '@/lib/reorder';

interface TemplateExerciseFormState {
  exerciseId: string;
  workSetCount: string;
  includeWarmup: boolean;
  targetReps: string;
  targetSeconds: string;
  targetWeight: string;
  restSeconds: string;
  notes: string;
}

const defaultFormState: TemplateExerciseFormState = {
  exerciseId: '',
  workSetCount: '3',
  includeWarmup: true,
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

function buildFormState(item?: WorkoutTemplateExercise): TemplateExerciseFormState {
  if (!item) {
    return defaultFormState;
  }

  return {
    exerciseId: item.exerciseId,
    workSetCount: String(item.workSetCount),
    // Altdaten ohne den Schlüssel behalten ihr Warmup.
    includeWarmup: item.includeWarmup !== false,
    targetReps: numberToInputValue(item.targetReps),
    targetSeconds: numberToInputValue(item.targetSeconds),
    targetWeight: numberToInputValue(item.targetWeight),
    restSeconds: numberToInputValue(item.restSeconds),
    notes: item.notes ?? '',
  };
}

function TemplateExerciseMeta({
  item,
  exerciseName,
  mediaAsset,
}: {
  item: WorkoutTemplateExercise;
  exerciseName: string;
  mediaAsset?: MediaAsset;
}) {
  return (
    <div className="flex min-w-0 gap-3">
      <ExerciseMedia
        mediaAsset={mediaAsset}
        alt={exerciseName}
        className="h-16 w-16 shrink-0 rounded-control"
        imageClassName="h-full w-full"
      />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-content">
          {item.orderIndex}. {exerciseName}
        </p>
        <p className="mt-1 text-sm text-content-muted">
          {item.targetReps ? `${item.workSetCount} x ${item.targetReps} Wdh` : null}
          {item.targetReps && item.targetSeconds ? ' · ' : null}
          {item.targetSeconds ? `${item.workSetCount} x ${item.targetSeconds}s` : null}
          {item.targetWeight ? ` · ${item.targetWeight} kg` : ''}
          {item.restSeconds ? ` · Pause ${item.restSeconds}s` : ''}
        </p>
        {item.notes ? <p className="mt-3 text-sm text-content-muted">{item.notes}</p> : null}
      </div>
    </div>
  );
}

interface TemplateExerciseCardProps {
  item: WorkoutTemplateExercise;
  exerciseName: string;
  mediaAsset?: MediaAsset;
  isBusy: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMove: (templateExerciseId: string, direction: -1 | 1) => void;
  onEdit: (templateExerciseId: string) => void;
  onDelete: (templateExerciseId: string, exerciseName: string) => void;
}

/*
 * Sortiert wird über Pfeile, nicht per Drag: die alte Drag-Geste sprang schon
 * bei acht Pixeln an und veränderte beim Scrollen versehentlich die
 * Reihenfolge.
 */
function TemplateExerciseCard({
  item,
  exerciseName,
  mediaAsset,
  isBusy,
  isFirst,
  isLast,
  onMove,
  onEdit,
  onDelete,
}: TemplateExerciseCardProps) {
  return (
    <div className="rounded-panel border border-line bg-surface p-4 transition hover:border-accent-border hover:bg-surface-sunken">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 gap-3">
          <div className="flex shrink-0 flex-col gap-1">
            <IconButton
              label={`${exerciseName} nach oben`}
              onClick={() => onMove(item.id, -1)}
              disabled={isBusy || isFirst}
            >
              <ChevronUp size={16} />
            </IconButton>
            <IconButton
              label={`${exerciseName} nach unten`}
              onClick={() => onMove(item.id, 1)}
              disabled={isBusy || isLast}
            >
              <ChevronDown size={16} />
            </IconButton>
          </div>
          <TemplateExerciseMeta item={item} exerciseName={exerciseName} mediaAsset={mediaAsset} />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onEdit(item.id)}
            disabled={isBusy}
            aria-label={`${exerciseName} bearbeiten`}
            className="flex h-11 w-11 items-center justify-center rounded-control border border-line text-content-secondary transition hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Pencil size={16} />
          </button>
          <button
            type="button"
            onClick={() => onDelete(item.id, exerciseName)}
            disabled={isBusy}
            aria-label={`${exerciseName} aus Vorlage entfernen`}
            className="flex h-11 w-11 items-center justify-center rounded-control border border-danger-border text-danger transition hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function TemplateDetailPage() {
  /*
   * Statt window.confirm: der native Systemdialog bricht in einer
   * installierten PWA das Erscheinungsbild und blockiert auf iOS den Thread.
   */
  const [pendingDelete, setPendingDelete] = useState<
    { kind: 'template' } | { kind: 'exercise'; id: string; name: string } | null
  >(null);
  const { templateId = '' } = useParams();
  const navigate = useNavigate();
  const editExerciseSectionRef = useRef<HTMLDivElement | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [templateNotes, setTemplateNotes] = useState('');
  const [editingTemplateExerciseId, setEditingTemplateExerciseId] = useState<string | null>(null);
  const [form, setForm] = useState<TemplateExerciseFormState>(defaultFormState);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [isSavingExercise, setIsSavingExercise] = useState(false);
  const [isUpdatingExerciseMedia, setIsUpdatingExerciseMedia] = useState(false);
  const [isReorderingExercises, setIsReorderingExercises] = useState(false);
  const [templateExerciseOrder, setTemplateExerciseOrder] = useState<string[]>([]);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const template = useLiveQuery(() => db.workoutTemplates.get(templateId), [templateId]);
  const templateExercises = useLiveQuery(
    () => db.workoutTemplateExercises.where('templateId').equals(templateId).sortBy('orderIndex'),
    [templateId],
  );
  const exercises = useLiveQuery(() => db.exercises.toArray(), []);
  const mediaAssets = useLiveQuery(() => db.mediaAssets.toArray(), []);
  const programs = useLiveQuery(async () => {
    const items = await db.programs.toArray();
    return items.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  }, []);
  const settings = useLiveQuery(() => db.appSettings.get('app-settings'), []);
  const programWeeks = useLiveQuery(() => db.programWeeks.toArray(), []);
  const progressionRules = useLiveQuery(() => db.progressionRules.toArray(), []);

  const nameById = Object.fromEntries((exercises ?? []).map((item) => [item.id, item.name]));
  const exerciseById = Object.fromEntries((exercises ?? []).map((item) => [item.id, item]));
  const mediaAssetById = Object.fromEntries((mediaAssets ?? []).map((item) => [item.id, item]));
  const sortedExercises = useMemo(
    () => [...(exercises ?? [])].sort((left, right) => left.name.localeCompare(right.name)),
    [exercises],
  );
  const orderedTemplateExercises = useMemo(() => {
    if (!templateExercises) {
      return [];
    }

    const exerciseById = new Map(templateExercises.map((item) => [item.id, item]));
    const orderedItems = templateExerciseOrder
      .map((itemId) => exerciseById.get(itemId))
      .filter((item): item is WorkoutTemplateExercise => Boolean(item));

    return orderedItems.length === templateExercises.length ? orderedItems : templateExercises;
  }, [templateExerciseOrder, templateExercises]);
  const selectedExistingExercise = sortedExercises.find((item) => item.id === form.exerciseId);
  const selectedExistingExerciseMedia =
    selectedExistingExercise?.mediaAssetId ? mediaAssetById[selectedExistingExercise.mediaAssetId] : undefined;
  useEffect(() => {
    setTemplateName(template?.name ?? '');
    setTemplateNotes(template?.notes ?? '');
  }, [template?.id, template?.name, template?.notes]);

  function handleEditTemplateExercise(templateExerciseId: string) {
    setEditingTemplateExerciseId(templateExerciseId);
    requestAnimationFrame(() => {
      editExerciseSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function handleOpenAddTemplateExercise() {
    setEditingTemplateExerciseId(null);
    requestAnimationFrame(() => {
      editExerciseSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  useEffect(() => {
    if (!templateExercises) {
      return;
    }

    setTemplateExerciseOrder(templateExercises.map((item) => item.id));
  }, [templateExercises]);

  useEffect(() => {
    if (!templateExercises) {
      return;
    }

    if (!editingTemplateExerciseId) {
      setForm({
        ...defaultFormState,
        exerciseId: sortedExercises[0]?.id ?? '',
      });
      return;
    }

    const item = templateExercises.find((entry) => entry.id === editingTemplateExerciseId);

    setForm(buildFormState(item));
    setMediaError(null);
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


    await deleteTemplate(template.id);
    navigate('/templates');
  }

  async function handleSaveTemplateExercise() {
    if (!template) {
      return;
    }

    if (!form.exerciseId) {
      return;
    }

    setIsSavingExercise(true);

    try {
      const currentItem = editingTemplateExerciseId
        ? templateExercises?.find((entry) => entry.id === editingTemplateExerciseId)
        : undefined;

      await saveTemplateExercise({
        id: editingTemplateExerciseId ?? undefined,
        templateId: template.id,
        orderIndex: currentItem?.orderIndex ?? orderedTemplateExercises.length + 1,
        workSetCount: Number(form.workSetCount) || 1,
        includeWarmup: form.includeWarmup,
        targetReps: parseOptionalNumber(form.targetReps),
        targetSeconds: parseOptionalNumber(form.targetSeconds),
        targetWeight: parseOptionalNumber(form.targetWeight),
        restSeconds: parseOptionalNumber(form.restSeconds),
        notes: form.notes,
        exerciseId: form.exerciseId,
        trackingMode: selectedExistingExercise?.trackingMode ?? 'reps_weight',
        unilateral: selectedExistingExercise?.unilateral ?? false,
      });

      setEditingTemplateExerciseId(null);
      setMediaError(null);
    } catch (error) {
      setMediaError(
        error instanceof Error ? error.message : 'Bild konnte nicht gespeichert werden.',
      );
    } finally {
      setIsSavingExercise(false);
    }
  }

  async function handleReplaceExistingExerciseMedia(file?: File) {
    if (!selectedExistingExercise || !file) {
      return;
    }

    setIsUpdatingExerciseMedia(true);

    try {
      await replaceExerciseMedia({
        exerciseId: selectedExistingExercise.id,
        file,
        fileName: file.name,
        mimeType: file.type,
      });
      setMediaError(null);
    } catch (error) {
      setMediaError(
        error instanceof Error ? error.message : 'Bild konnte nicht aktualisiert werden.',
      );
    } finally {
      setIsUpdatingExerciseMedia(false);
    }
  }

  async function handleClearExistingExerciseMedia() {
    if (!selectedExistingExercise?.mediaAssetId) {
      return;
    }

    setIsUpdatingExerciseMedia(true);

    try {
      await clearExerciseMedia(selectedExistingExercise.id);
      setMediaError(null);
    } catch (error) {
      setMediaError(
        error instanceof Error ? error.message : 'Bild konnte nicht entfernt werden.',
      );
    } finally {
      setIsUpdatingExerciseMedia(false);
    }
  }

  async function handleMoveTemplateExercise(templateExerciseId: string, direction: -1 | 1) {
    if (!template) {
      return;
    }

    const currentIndex = templateExerciseOrder.indexOf(templateExerciseId);
    const nextOrder = moveItem(templateExerciseOrder, currentIndex, currentIndex + direction);

    if (nextOrder === templateExerciseOrder) {
      return;
    }

    const previousOrder = templateExerciseOrder;
    setTemplateExerciseOrder(nextOrder);
    setIsReorderingExercises(true);

    try {
      await reorderTemplateExercises(template.id, nextOrder);
    } catch {
      // Optimistische Reihenfolge zurücknehmen, sonst zeigt die Liste eine
      // Sortierung, die nie gespeichert wurde.
      setTemplateExerciseOrder(previousOrder);
    } finally {
      setIsReorderingExercises(false);
    }
  }

  async function handleDeleteTemplateExercise(templateExerciseId: string) {
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
              onClick={() => setPendingDelete({ kind: 'template' })}
              className="min-h-touch inline-flex items-center justify-center rounded-control border border-rose-400/20 px-3 py-2 text-sm text-rose-200 transition hover:bg-rose-400/10"
            >
              Löschen
            </button>
          }
        >
          <div className="space-y-3">
            <input
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
              aria-label="Vorlagenname" placeholder="Vorlagenname"
              className="w-full rounded-panel border border-line bg-surface px-4 py-4 text-base text-content outline-none transition placeholder:text-content-muted focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
            />
            <textarea
              value={templateNotes}
              onChange={(event) => setTemplateNotes(event.target.value)}
              aria-label="Notizen zur Einheit" placeholder="Notizen zur Einheit"
              rows={3}
              className="w-full rounded-panel border border-line bg-surface px-4 py-4 text-base text-content outline-none transition placeholder:text-content-muted focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
            />
            <button
              type="button"
              onClick={handleSaveTemplate}
              disabled={!templateName.trim() || isSavingTemplate}
              className="w-full rounded-panel bg-accent px-4 py-4 text-sm font-semibold text-accent-contrast transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Vorlage speichern
            </button>
          </div>
        </SectionCard>

        <SectionCard
          title="Template-Übungen"
          subtitle="Reihenfolge über die Pfeile - so verrutscht beim Scrollen nichts."
          action={
            <button
              type="button"
              onClick={handleOpenAddTemplateExercise}
              className="min-h-touch inline-flex items-center justify-center flex h-10 items-center gap-2 rounded-control bg-accent-soft px-3 py-2 text-sm text-accent transition hover:bg-accent/20"
            >
              <Plus size={16} />
              Hinzufügen
            </button>
          }
        >
          <div className="space-y-3">
            {orderedTemplateExercises.length > 0 ? (
              <div className="space-y-3">
                {orderedTemplateExercises.map((item, index) => (
                  <TemplateExerciseCard
                    key={item.id}
                    item={item}
                    exerciseName={nameById[item.exerciseId] ?? 'Unbekannte Übung'}
                    mediaAsset={
                      exerciseById[item.exerciseId]?.mediaAssetId
                        ? mediaAssetById[exerciseById[item.exerciseId].mediaAssetId]
                        : undefined
                    }
                    isBusy={isReorderingExercises}
                    isFirst={index === 0}
                    isLast={index === orderedTemplateExercises.length - 1}
                    onMove={handleMoveTemplateExercise}
                    onEdit={handleEditTemplateExercise}
                    onDelete={(id, name) => setPendingDelete({ kind: 'exercise', id, name })}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-panel border border-dashed border-line bg-surface px-4 py-5 text-sm text-content-muted">
                Noch keine Template-Übungen vorhanden.
              </div>
            )}
          </div>
        </SectionCard>

        <TemplateProgressionSection
          programs={programs}
          programWeeks={programWeeks}
          progressionRules={progressionRules}
          orderedTemplateExercises={orderedTemplateExercises}
          exerciseById={exerciseById}
          nameById={nameById}
          activeProgramId={settings?.activeProgramId}
        />

        <div ref={editExerciseSectionRef}>
          <SectionCard
            title={editingTemplateExerciseId ? 'Template-Übung bearbeiten' : 'Template-Übung hinzufügen'}
            subtitle="Übung aus der Bibliothek auswählen."
            action={
              <div className="flex h-10 w-10 items-center justify-center rounded-control bg-accent-soft text-accent">
                <Plus size={18} />
              </div>
            }
          >
          <div className="space-y-4">
            {sortedExercises.length === 0 ? (
              <div className="rounded-panel border border-dashed border-line bg-surface px-4 py-5 text-sm text-content-muted">
                Noch keine Übung in der Bibliothek.{' '}
                <Link to="/exercises" className="text-accent underline underline-offset-2">
                  Jetzt anlegen
                </Link>
                .
              </div>
            ) : (
              <div className="space-y-3">
                <select
                  value={form.exerciseId}
                  onChange={(event) => setForm((current) => ({ ...current, exerciseId: event.target.value }))}
                  className="select-control min-h-touch w-full rounded-panel border border-line bg-surface px-4 py-4 text-base text-content outline-none transition focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {sortedExercises.map((exercise) => (
                    <option key={exercise.id} value={exercise.id}>
                      {exercise.name}
                    </option>
                  ))}
                </select>

                {selectedExistingExercise ? (
                  <div className="rounded-panel bg-surface p-4 text-sm text-content-muted">
                    <ExerciseMedia
                      mediaAsset={selectedExistingExerciseMedia}
                      alt={selectedExistingExercise.name}
                      className="mb-4 h-40 w-full"
                      imageClassName="h-full w-full"
                    />
                    <p className="font-semibold text-content">{selectedExistingExercise.name}</p>
                    <p className="mt-2">
                      Tracking: {selectedExistingExercise.trackingMode} ·{' '}
                      {selectedExistingExercise.unilateral ? 'unilateral' : 'beidseitig'}
                    </p>
                    {selectedExistingExercise.instructions ? (
                      <p className="mt-2">{selectedExistingExercise.instructions}</p>
                    ) : null}
                    <div className="mt-4 flex flex-wrap gap-2">
                      <label className="min-h-touch inline-flex items-center justify-center rounded-control border border-line px-3 py-2 text-sm text-content-secondary transition hover:bg-surface-raised">
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/gif"
                          className="hidden"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            void handleReplaceExistingExerciseMedia(file);
                            event.target.value = '';
                          }}
                        />
                        {selectedExistingExerciseMedia ? 'Bild ersetzen' : 'Bild hochladen'}
                      </label>
                      {selectedExistingExerciseMedia ? (
                        <button
                          type="button"
                          onClick={handleClearExistingExerciseMedia}
                          disabled={isUpdatingExerciseMedia}
                          className="min-h-touch inline-flex items-center justify-center rounded-control border border-rose-400/20 px-3 py-2 text-sm text-rose-200 transition hover:bg-rose-400/10 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Bild entfernen
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            <ExerciseTargetFields
              trackingMode={selectedExistingExercise?.trackingMode}
              values={form}
              onChange={(field, value) => setForm((current) => ({ ...current, [field]: value }))}
              workSetCountHint="Die Reihenfolge änderst du oben mit den Pfeilen."
              weightLabel="Ziel-Gewicht in kg"
            />

            <CheckboxField
              label="Warmup-Satz anlegen"
              hint="Aus bleibt der Warmup-Satz beim Start der Session komplett weg."
              checked={form.includeWarmup}
              onChange={(event) =>
                setForm((current) => ({ ...current, includeWarmup: event.target.checked }))
              }
            />

            <textarea
              value={form.notes}
              onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
              aria-label="Template-spezifische Notiz" placeholder="Template-spezifische Notiz"
              rows={3}
              className="w-full rounded-panel border border-line bg-surface px-4 py-4 text-base text-content outline-none transition placeholder:text-content-muted focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
            />

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={handleSaveTemplateExercise}
                disabled={isSavingExercise || isUpdatingExerciseMedia}
                className="rounded-panel bg-accent px-4 py-4 text-sm font-semibold text-accent-contrast transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {editingTemplateExerciseId ? 'Änderung speichern' : 'Übung hinzufügen'}
              </button>
              <button
                type="button"
                onClick={() => setEditingTemplateExerciseId(null)}
                className="rounded-panel bg-surface-raised px-4 py-4 text-sm font-medium text-content-secondary transition hover:bg-surface-hover"
              >
                Zurücksetzen
              </button>
            </div>

            {mediaError ? (
              <div className="rounded-panel border border-rose-300/20 bg-rose-300/10 px-4 py-4 text-sm text-rose-100">
                {mediaError}
              </div>
            ) : null}
          </div>
        </SectionCard>
        </div>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete?.kind === 'template' ? 'Vorlage löschen?' : 'Übung entfernen?'}
        description={
          pendingDelete?.kind === 'template'
            ? `"${template?.name ?? ''}" wird entfernt. Bereits absolvierte Sessions bleiben in der Historie erhalten.`
            : `"${pendingDelete?.kind === 'exercise' ? pendingDelete.name : ''}" wird aus dieser Vorlage entfernt. Die Übung selbst und ihre Historie bleiben bestehen.`
        }
        confirmLabel="Entfernen"
        onConfirm={async () => {
          if (!pendingDelete) {
            return;
          }

          const target = pendingDelete;
          setPendingDelete(null);

          if (target.kind === 'template') {
            await handleDeleteTemplate();
          } else {
            await handleDeleteTemplateExercise(target.id);
          }
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </AppShell>
  );
}
