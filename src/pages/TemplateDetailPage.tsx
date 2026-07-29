import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ExerciseMedia } from '@/components/ExerciseMedia';
import { SectionCard } from '@/components/SectionCard';
import { db } from '@/db/appDb';
import { clearExerciseMedia, replaceExerciseMedia } from '@/db/media-actions';
import {
  clearProgressionRule,
  deleteTemplate,
  deleteTemplateExercise,
  reorderTemplateExercises,
  saveProgressionRule,
  saveTemplateExercise,
  updateTemplate,
} from '@/db/template-actions';
import type { MediaAsset, TrackingMode, WorkoutTemplateExercise } from '@/domain/models';

interface TemplateExerciseFormState {
  exerciseId: string;
  workSetCount: string;
  targetReps: string;
  targetSeconds: string;
  targetWeight: string;
  restSeconds: string;
  notes: string;
}

const defaultFormState: TemplateExerciseFormState = {
  exerciseId: '',
  workSetCount: '3',
  targetReps: '',
  targetSeconds: '',
  targetWeight: '',
  restSeconds: '',
  notes: '',
};

interface ProgressionRuleFormState {
  targetReps: string;
  targetSeconds: string;
  targetWeight: string;
  notes: string;
}

const defaultProgressionRuleFormState: ProgressionRuleFormState = {
  targetReps: '',
  targetSeconds: '',
  targetWeight: '',
  notes: '',
};

function numberToInputValue(value?: number) {
  return typeof value === 'number' ? String(value) : '';
}

function supportsReps(trackingMode?: TrackingMode) {
  return trackingMode === 'reps_weight';
}

function supportsSeconds(trackingMode?: TrackingMode) {
  return trackingMode === 'time' || trackingMode === 'time_weight';
}

function supportsWeight(trackingMode?: TrackingMode) {
  return trackingMode === 'reps_weight' || trackingMode === 'time_weight';
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
    targetReps: numberToInputValue(item.targetReps),
    targetSeconds: numberToInputValue(item.targetSeconds),
    targetWeight: numberToInputValue(item.targetWeight),
    restSeconds: numberToInputValue(item.restSeconds),
    notes: item.notes ?? '',
  };
}

function buildProgressionRuleFormState(rule?: {
  targetReps?: number;
  targetSeconds?: number;
  targetWeight?: number;
  notes?: string;
}): ProgressionRuleFormState {
  return {
    targetReps: numberToInputValue(rule?.targetReps),
    targetSeconds: numberToInputValue(rule?.targetSeconds),
    targetWeight: numberToInputValue(rule?.targetWeight),
    notes: rule?.notes ?? '',
  };
}

function formatPrescriptionLine(input: {
  workSetCount: number;
  targetReps?: number;
  targetSeconds?: number;
  targetWeight?: number;
  restSeconds?: number;
}) {
  const parts = [
    input.targetReps ? `${input.workSetCount} x ${input.targetReps} Wdh` : null,
    input.targetSeconds ? `${input.workSetCount} x ${input.targetSeconds}s` : null,
    typeof input.targetWeight === 'number' ? `${input.targetWeight} kg` : null,
    typeof input.restSeconds === 'number' ? `Pause ${input.restSeconds}s` : null,
  ].filter(Boolean);

  return parts.join(' · ') || 'Keine Zielwerte gesetzt';
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

interface SortableTemplateExerciseCardProps {
  item: WorkoutTemplateExercise;
  exerciseName: string;
  mediaAsset?: MediaAsset;
  isBusy: boolean;
  onEdit: (templateExerciseId: string) => void;
  onDelete: (templateExerciseId: string, exerciseName: string) => void;
}

function SortableTemplateExerciseCard({
  item,
  exerciseName,
  mediaAsset,
  isBusy,
  onEdit,
  onDelete,
}: SortableTemplateExerciseCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-panel border bg-surface p-4 transition ${
        isDragging
          ? 'border-accent-border opacity-35 shadow-soft ring-2 ring-lime-300/20'
          : 'border-line hover:border-accent-border hover:bg-surface-sunken'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 gap-3">
          <button
            type="button"
            aria-label={`${exerciseName} ziehen und umsortieren`}
            disabled={isBusy}
            className={`touch-none rounded-control border p-2 transition disabled:cursor-not-allowed disabled:opacity-35 ${
              isDragging
                ? 'cursor-grabbing border-accent-border bg-accent-soft text-accent'
                : 'cursor-grab border-line text-content-secondary hover:bg-surface-raised active:cursor-grabbing'
            }`}
            {...attributes}
            {...listeners}
          >
            <GripVertical size={16} />
          </button>
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
  const [isSavingProgressionRule, setIsSavingProgressionRule] = useState(false);
  const [isUpdatingExerciseMedia, setIsUpdatingExerciseMedia] = useState(false);
  const [isReorderingExercises, setIsReorderingExercises] = useState(false);
  const [activeTemplateExerciseId, setActiveTemplateExerciseId] = useState<string | null>(null);
  const [templateExerciseOrder, setTemplateExerciseOrder] = useState<string[]>([]);
  const [selectedProgramId, setSelectedProgramId] = useState('');
  const [selectedProgressionTemplateExerciseId, setSelectedProgressionTemplateExerciseId] =
    useState<string>('');
  const [progressionFormsByWeekId, setProgressionFormsByWeekId] = useState<
    Record<string, ProgressionRuleFormState>
  >({});
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
  const activeTemplateExercise = useMemo(
    () => orderedTemplateExercises.find((item) => item.id === activeTemplateExerciseId),
    [activeTemplateExerciseId, orderedTemplateExercises],
  );
  const selectedProgressionTemplateExercise = useMemo(
    () =>
      orderedTemplateExercises.find((item) => item.id === selectedProgressionTemplateExerciseId),
    [orderedTemplateExercises, selectedProgressionTemplateExerciseId],
  );
  const selectedProgressionExercise =
    selectedProgressionTemplateExercise?.exerciseId
      ? exerciseById[selectedProgressionTemplateExercise.exerciseId]
      : undefined;
  const selectedProgramWeeks = useMemo(
    () =>
      [...(programWeeks ?? [])]
        .filter((week) => week.programId === selectedProgramId)
        .sort((left, right) => left.weekNumber - right.weekNumber),
    [programWeeks, selectedProgramId],
  );
  const selectedProgressionRulesByWeekId = useMemo(() => {
    if (!selectedProgressionTemplateExerciseId) {
      return {};
    }

    const relevantWeekIds = new Set(selectedProgramWeeks.map((week) => week.id));

    return Object.fromEntries(
      (progressionRules ?? [])
        .filter(
          (rule) =>
            rule.templateExerciseId === selectedProgressionTemplateExerciseId &&
            relevantWeekIds.has(rule.programWeekId),
        )
        .map((rule) => [rule.programWeekId, rule]),
    );
  }, [progressionRules, selectedProgramWeeks, selectedProgressionTemplateExerciseId]);
  const selectedExistingExercise = sortedExercises.find((item) => item.id === form.exerciseId);
  const selectedExistingExerciseMedia =
    selectedExistingExercise?.mediaAssetId ? mediaAssetById[selectedExistingExercise.mediaAssetId] : undefined;
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

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

  useEffect(() => {
    const availableProgramIds = (programs ?? []).map((program) => program.id);

    if (availableProgramIds.length === 0) {
      if (selectedProgramId) {
        setSelectedProgramId('');
      }
      return;
    }

    const preferredProgramId = settings?.activeProgramId ?? availableProgramIds[0];

    if (!selectedProgramId || !availableProgramIds.includes(selectedProgramId)) {
      setSelectedProgramId(preferredProgramId);
    }
  }, [programs, selectedProgramId, settings?.activeProgramId]);

  useEffect(() => {
    const availableTemplateExerciseIds = orderedTemplateExercises.map((item) => item.id);

    if (availableTemplateExerciseIds.length === 0) {
      if (selectedProgressionTemplateExerciseId) {
        setSelectedProgressionTemplateExerciseId('');
      }
      return;
    }

    if (
      !selectedProgressionTemplateExerciseId ||
      !availableTemplateExerciseIds.includes(selectedProgressionTemplateExerciseId)
    ) {
      setSelectedProgressionTemplateExerciseId(availableTemplateExerciseIds[0]);
    }
  }, [orderedTemplateExercises, selectedProgressionTemplateExerciseId]);

  useEffect(() => {
    if (selectedProgramWeeks.length === 0) {
      setProgressionFormsByWeekId({});
      return;
    }

    setProgressionFormsByWeekId(
      Object.fromEntries(
        selectedProgramWeeks.map((week) => [
          week.id,
          buildProgressionRuleFormState(selectedProgressionRulesByWeekId[week.id]),
        ]),
      ),
    );
  }, [selectedProgramWeeks, selectedProgressionRulesByWeekId]);

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

  async function handleTemplateExerciseDragEnd(event: DragEndEvent) {
    setActiveTemplateExerciseId(null);

    if (!template || !event.over || event.active.id === event.over.id) {
      return;
    }

    const currentIndex = templateExerciseOrder.indexOf(String(event.active.id));
    const targetIndex = templateExerciseOrder.indexOf(String(event.over.id));

    if (currentIndex === -1 || targetIndex === -1) {
      return;
    }

    const nextOrder = arrayMove(templateExerciseOrder, currentIndex, targetIndex);
    setTemplateExerciseOrder(nextOrder);
    setIsReorderingExercises(true);

    try {
      await reorderTemplateExercises(template.id, nextOrder);
    } finally {
      setIsReorderingExercises(false);
    }
  }

  function handleTemplateExerciseDragStart(event: DragStartEvent) {
    setActiveTemplateExerciseId(String(event.active.id));
  }

  function handleTemplateExerciseDragCancel() {
    setActiveTemplateExerciseId(null);
  }

  async function handleDeleteTemplateExercise(templateExerciseId: string) {
    await deleteTemplateExercise(templateExerciseId);

    if (editingTemplateExerciseId === templateExerciseId) {
      setEditingTemplateExerciseId(null);
    }
  }

  async function handleSaveProgressionForWeek(programWeekId: string) {
    if (!selectedProgressionTemplateExercise) {
      return;
    }

    const draft = progressionFormsByWeekId[programWeekId] ?? defaultProgressionRuleFormState;

    setIsSavingProgressionRule(true);

    try {
      await saveProgressionRule({
        templateExerciseId: selectedProgressionTemplateExercise.id,
        programWeekId,
        targetReps: supportsReps(selectedProgressionExercise?.trackingMode)
          ? parseOptionalNumber(draft.targetReps)
          : undefined,
        targetSeconds: supportsSeconds(selectedProgressionExercise?.trackingMode)
          ? parseOptionalNumber(draft.targetSeconds)
          : undefined,
        targetWeight: supportsWeight(selectedProgressionExercise?.trackingMode)
          ? parseOptionalNumber(draft.targetWeight)
          : undefined,
        notes: draft.notes,
      });
    } finally {
      setIsSavingProgressionRule(false);
    }
  }

  async function handleClearProgressionForWeek(programWeekId: string) {
    if (!selectedProgressionTemplateExercise) {
      return;
    }

    setIsSavingProgressionRule(true);

    try {
      await clearProgressionRule(selectedProgressionTemplateExercise.id, programWeekId);
      setProgressionFormsByWeekId((current) => ({
        ...current,
        [programWeekId]: defaultProgressionRuleFormState,
      }));
    } finally {
      setIsSavingProgressionRule(false);
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
              Loeschen
            </button>
          }
        >
          <div className="space-y-3">
            <input
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
              aria-label="Vorlagenname" placeholder="Vorlagenname"
              className="w-full rounded-panel border border-line bg-surface px-4 py-4 text-sm text-content outline-none transition placeholder:text-content-muted focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
            />
            <textarea
              value={templateNotes}
              onChange={(event) => setTemplateNotes(event.target.value)}
              aria-label="Notizen zur Einheit" placeholder="Notizen zur Einheit"
              rows={3}
              className="w-full rounded-panel border border-line bg-surface px-4 py-4 text-sm text-content outline-none transition placeholder:text-content-muted focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
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
          title="Template-Uebungen"
          subtitle="Per Drag auf Touch und Desktop umsortieren. Ueber den Handle geht das auch per Tastatur."
          action={
            <button
              type="button"
              onClick={handleOpenAddTemplateExercise}
              className="min-h-touch inline-flex items-center justify-center flex h-10 items-center gap-2 rounded-control bg-accent-soft px-3 py-2 text-sm text-accent transition hover:bg-accent/20"
            >
              <Plus size={16} />
              Hinzufuegen
            </button>
          }
        >
          <div className="space-y-3">
            {orderedTemplateExercises.length > 0 ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleTemplateExerciseDragStart}
                onDragCancel={handleTemplateExerciseDragCancel}
                onDragEnd={handleTemplateExerciseDragEnd}
              >
                <SortableContext items={templateExerciseOrder} strategy={verticalListSortingStrategy}>
                  <div
                    className={`space-y-3 rounded-card transition ${
                      activeTemplateExerciseId ? 'bg-accent/[0.03] p-1 ring-1 ring-lime-300/15' : ''
                    }`}
                  >
                    {orderedTemplateExercises.map((item) => (
                      <SortableTemplateExerciseCard
                        key={item.id}
                        item={item}
                        exerciseName={nameById[item.exerciseId] ?? 'Unbekannte Uebung'}
                        mediaAsset={
                          exerciseById[item.exerciseId]?.mediaAssetId
                            ? mediaAssetById[exerciseById[item.exerciseId].mediaAssetId]
                            : undefined
                        }
                        isBusy={isReorderingExercises}
                        onEdit={handleEditTemplateExercise}
                        onDelete={(id, name) => setPendingDelete({ kind: 'exercise', id, name })}
                      />
                    ))}
                  </div>
                </SortableContext>
                <DragOverlay>
                  {activeTemplateExercise ? (
                    <div className="w-[min(100vw-40px,32rem)] rounded-panel border border-lime-300/35 bg-zinc-950/95 p-4 shadow-soft ring-2 ring-lime-300/20 backdrop-blur">
                      <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-accent/90">
                        <GripVertical size={14} />
                        <span>Loslassen zum Ablegen</span>
                      </div>
                      <div className="flex min-w-0 gap-3">
                        <div className="rounded-control border border-accent-border bg-accent-soft p-2 text-accent">
                          <GripVertical size={16} />
                        </div>
                        <TemplateExerciseMeta
                          item={activeTemplateExercise}
                          exerciseName={nameById[activeTemplateExercise.exerciseId] ?? 'Unbekannte Uebung'}
                          mediaAsset={
                            exerciseById[activeTemplateExercise.exerciseId]?.mediaAssetId
                              ? mediaAssetById[exerciseById[activeTemplateExercise.exerciseId].mediaAssetId]
                              : undefined
                          }
                        />
                      </div>
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
            ) : (
              <div className="rounded-panel border border-dashed border-line bg-surface px-4 py-5 text-sm text-content-muted">
                Noch keine Template-Uebungen vorhanden.
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard
          title="Wochenprogression"
          subtitle="Pro Programmwoche kannst du Zielwerte fuer diese Vorlage ueberschreiben. Beim Session-Start wird genau diese Stufe als Snapshot uebernommen."
          action={
            <Link
              to="/programs"
              className="min-h-touch inline-flex items-center justify-center rounded-control border border-line px-3 py-2 text-sm text-content-secondary transition hover:bg-surface-raised"
            >
              Programme
            </Link>
          }
        >
          {(programs?.length ?? 0) === 0 ? (
            <div className="rounded-panel border border-dashed border-line bg-surface px-4 py-5 text-sm text-content-muted">
              Lege zuerst ein Programm mit Wochen an, damit du Wochen-Overrides pflegen kannst.
            </div>
          ) : orderedTemplateExercises.length === 0 ? (
            <div className="rounded-panel border border-dashed border-line bg-surface px-4 py-5 text-sm text-content-muted">
              Fuege zuerst eine Template-Uebung hinzu. Danach kannst du hier die Progression je Woche editieren.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <select
                  value={selectedProgramId}
                  onChange={(event) => setSelectedProgramId(event.target.value)}
                  className="select-control w-full rounded-panel border border-line bg-surface px-4 py-4 text-sm text-content outline-none transition focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {(programs ?? []).map((program) => (
                    <option key={program.id} value={program.id}>
                      {program.name}
                    </option>
                  ))}
                </select>
                <select
                  value={selectedProgressionTemplateExerciseId}
                  onChange={(event) => setSelectedProgressionTemplateExerciseId(event.target.value)}
                  className="select-control w-full rounded-panel border border-line bg-surface px-4 py-4 text-sm text-content outline-none transition focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {orderedTemplateExercises.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.orderIndex}. {nameById[item.exerciseId] ?? 'Unbekannte Uebung'}
                    </option>
                  ))}
                </select>
              </div>

              {selectedProgressionTemplateExercise ? (
                <div className="rounded-panel bg-surface p-4 text-sm text-content-muted">
                  <p className="font-semibold text-content">
                    {nameById[selectedProgressionTemplateExercise.exerciseId] ?? 'Unbekannte Uebung'}
                  </p>
                  <p className="mt-2">
                    Basis: {formatPrescriptionLine(selectedProgressionTemplateExercise)}
                  </p>
                  <p className="mt-1">
                    Tracking: {selectedProgressionExercise?.trackingMode ?? 'reps_weight'} ·{' '}
                    {selectedProgressionExercise?.unilateral ? 'unilateral' : 'beidseitig'}
                  </p>
                </div>
              ) : null}

              {selectedProgramWeeks.length > 0 ? (
                <div className="space-y-3">
                  {selectedProgramWeeks.map((week) => {
                    const draft = progressionFormsByWeekId[week.id] ?? defaultProgressionRuleFormState;
                    const hasSavedRule = Boolean(selectedProgressionRulesByWeekId[week.id]);

                    return (
                      <div
                        key={week.id}
                        className="rounded-panel border border-line bg-surface p-4"
                      >
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-content">
                              W{week.weekNumber}
                              {week.label ? ` · ${week.label}` : ''}
                            </p>
                            <p className="mt-1 text-xs text-content-muted">
                              Leer lassen = Basiswerte der Template-Uebung verwenden
                            </p>
                          </div>
                          {hasSavedRule ? (
                            <span className="min-h-touch inline-flex items-center justify-center rounded-control bg-accent-soft px-3 py-2 text-xs font-medium text-accent">
                              Override aktiv
                            </span>
                          ) : null}
                        </div>

                        <div className="space-y-3">
                          {supportsReps(selectedProgressionExercise?.trackingMode) ? (
                            <input
                              value={draft.targetReps}
                              onChange={(event) =>
                                setProgressionFormsByWeekId((current) => ({
                                  ...current,
                                  [week.id]: {
                                    ...(current[week.id] ?? defaultProgressionRuleFormState),
                                    targetReps: event.target.value,
                                  },
                                }))
                              }
                              inputMode="numeric"
                              aria-label="Ziel-Wdh" placeholder="Ziel-Wdh"
                              className="w-full rounded-panel border border-line bg-surface-sunken px-4 py-4 text-sm text-content outline-none transition focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
                            />
                          ) : null}

                          {supportsSeconds(selectedProgressionExercise?.trackingMode) ? (
                            <input
                              value={draft.targetSeconds}
                              onChange={(event) =>
                                setProgressionFormsByWeekId((current) => ({
                                  ...current,
                                  [week.id]: {
                                    ...(current[week.id] ?? defaultProgressionRuleFormState),
                                    targetSeconds: event.target.value,
                                  },
                                }))
                              }
                              inputMode="decimal"
                              aria-label="Ziel-Sekunden" placeholder="Ziel-Sekunden"
                              className="w-full rounded-panel border border-line bg-surface-sunken px-4 py-4 text-sm text-content outline-none transition focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
                            />
                          ) : null}

                          {supportsWeight(selectedProgressionExercise?.trackingMode) ? (
                            <input
                              value={draft.targetWeight}
                              onChange={(event) =>
                                setProgressionFormsByWeekId((current) => ({
                                  ...current,
                                  [week.id]: {
                                    ...(current[week.id] ?? defaultProgressionRuleFormState),
                                    targetWeight: event.target.value,
                                  },
                                }))
                              }
                              inputMode="decimal"
                              aria-label="Ziel-Gewicht in kg" placeholder="Ziel-Gewicht in kg"
                              className="w-full rounded-panel border border-line bg-surface-sunken px-4 py-4 text-sm text-content outline-none transition focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
                            />
                          ) : null}

                          <textarea
                            value={draft.notes}
                            onChange={(event) =>
                              setProgressionFormsByWeekId((current) => ({
                                ...current,
                                [week.id]: {
                                  ...(current[week.id] ?? defaultProgressionRuleFormState),
                                  notes: event.target.value,
                                },
                              }))
                            }
                            rows={2}
                            aria-label="Wochen-spezifische Notiz" placeholder="Wochen-spezifische Notiz"
                            className="w-full rounded-panel border border-line bg-surface-sunken px-4 py-4 text-sm text-content outline-none transition placeholder:text-content-muted focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
                          />

                          <div className="grid grid-cols-2 gap-3">
                            <button
                              type="button"
                              onClick={() => handleSaveProgressionForWeek(week.id)}
                              disabled={isSavingProgressionRule}
                              className="rounded-panel bg-accent px-4 py-4 text-sm font-semibold text-accent-contrast transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Wochenwerte speichern
                            </button>
                            <button
                              type="button"
                              onClick={() => handleClearProgressionForWeek(week.id)}
                              disabled={isSavingProgressionRule}
                              className="rounded-panel bg-surface-raised px-4 py-4 text-sm font-medium text-content-secondary transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Override entfernen
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-panel border border-dashed border-line bg-surface px-4 py-5 text-sm text-content-muted">
                  Dieses Programm hat noch keine Wochen. Fuege sie in der Programm-Verwaltung hinzu.
                </div>
              )}
            </div>
          )}
        </SectionCard>

        <div ref={editExerciseSectionRef}>
          <SectionCard
            title={editingTemplateExerciseId ? 'Template-Uebung bearbeiten' : 'Template-Uebung hinzufuegen'}
            subtitle="Uebung aus der Bibliothek auswaehlen."
            action={
              <div className="flex h-10 w-10 items-center justify-center rounded-control bg-accent-soft text-accent">
                <Plus size={18} />
              </div>
            }
          >
          <div className="space-y-4">
            {sortedExercises.length === 0 ? (
              <div className="rounded-panel border border-dashed border-line bg-surface px-4 py-5 text-sm text-content-muted">
                Noch keine Uebung in der Bibliothek.{' '}
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
                  className="select-control min-h-touch w-full rounded-panel border border-line bg-surface px-4 py-4 text-sm text-content outline-none transition focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
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

            <div className="space-y-2">
              <input
                value={form.workSetCount}
                onChange={(event) => setForm((current) => ({ ...current, workSetCount: event.target.value }))}
                inputMode="numeric"
                aria-label="Arbeitssaetze" placeholder="Arbeitssaetze"
                className="w-full rounded-panel border border-line bg-surface px-4 py-4 text-sm text-content outline-none transition placeholder:text-content-muted focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
              />
                <p className="text-xs text-content-muted">Die Reihenfolge aenderst du oben direkt per Drag am Handle.</p>
            </div>

            {selectedExistingExercise?.trackingMode === 'reps_weight' ? (
              <input
                value={form.targetReps}
                onChange={(event) => setForm((current) => ({ ...current, targetReps: event.target.value }))}
                inputMode="numeric"
                aria-label="Ziel-Wdh" placeholder="Ziel-Wdh"
                className="w-full rounded-panel border border-line bg-surface px-4 py-4 text-sm text-content outline-none transition placeholder:text-content-muted focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
              />
            ) : null}

            {selectedExistingExercise?.trackingMode !== 'reps_weight' ? (
              <input
                value={form.targetSeconds}
                onChange={(event) => setForm((current) => ({ ...current, targetSeconds: event.target.value }))}
                inputMode="decimal"
                aria-label="Ziel-Sekunden" placeholder="Ziel-Sekunden"
                className="w-full rounded-panel border border-line bg-surface px-4 py-4 text-sm text-content outline-none transition placeholder:text-content-muted focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
              />
            ) : null}

            {selectedExistingExercise?.trackingMode !== 'time' ? (
              <input
                value={form.targetWeight}
                onChange={(event) => setForm((current) => ({ ...current, targetWeight: event.target.value }))}
                inputMode="decimal"
                aria-label="Ziel-Gewicht in kg" placeholder="Ziel-Gewicht in kg"
                className="w-full rounded-panel border border-line bg-surface px-4 py-4 text-sm text-content outline-none transition placeholder:text-content-muted focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
              />
            ) : null}

            <input
              value={form.restSeconds}
              onChange={(event) => setForm((current) => ({ ...current, restSeconds: event.target.value }))}
              inputMode="numeric"
              aria-label="Pause in Sekunden" placeholder="Pause in Sekunden"
              className="w-full rounded-panel border border-line bg-surface px-4 py-4 text-sm text-content outline-none transition placeholder:text-content-muted focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
            />

            <textarea
              value={form.notes}
              onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
              aria-label="Template-spezifische Notiz" placeholder="Template-spezifische Notiz"
              rows={3}
              className="w-full rounded-panel border border-line bg-surface px-4 py-4 text-sm text-content outline-none transition placeholder:text-content-muted focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
            />

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={handleSaveTemplateExercise}
                disabled={isSavingExercise || isUpdatingExerciseMedia}
                className="rounded-panel bg-accent px-4 py-4 text-sm font-semibold text-accent-contrast transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {editingTemplateExerciseId ? 'Aenderung speichern' : 'Uebung hinzufuegen'}
              </button>
              <button
                type="button"
                onClick={() => setEditingTemplateExerciseId(null)}
                className="rounded-panel bg-surface-raised px-4 py-4 text-sm font-medium text-content-secondary transition hover:bg-surface-hover"
              >
                Zuruecksetzen
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
        title={pendingDelete?.kind === 'template' ? 'Vorlage loeschen?' : 'Uebung entfernen?'}
        description={
          pendingDelete?.kind === 'template'
            ? `"${template?.name ?? ''}" wird entfernt. Bereits absolvierte Sessions bleiben in der Historie erhalten.`
            : `"${pendingDelete?.kind === 'exercise' ? pendingDelete.name : ''}" wird aus dieser Vorlage entfernt. Die Uebung selbst und ihre Historie bleiben bestehen.`
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
