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
import { ExerciseMedia } from '@/components/ExerciseMedia';
import { SectionCard } from '@/components/SectionCard';
import { db } from '@/db/appDb';
import { clearExerciseMedia, createPendingExerciseMedia, replaceExerciseMedia } from '@/db/media-actions';
import {
  clearProgressionRule,
  deleteTemplate,
  deleteTemplateExercise,
  reorderTemplateExercises,
  saveProgressionRule,
  saveTemplateExercise,
  updateTemplate,
} from '@/db/template-actions';
import type { Exercise, MediaAsset, TrackingMode, WorkoutTemplateExercise } from '@/domain/models';

type ExerciseSource = 'existing' | 'new';

interface TemplateExerciseFormState {
  exerciseSource: ExerciseSource;
  exerciseId: string;
  exerciseName: string;
  instructions: string;
  tempo: string;
  trackingMode: TrackingMode;
  unilateral: boolean;
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
        className="h-16 w-16 shrink-0 rounded-2xl"
        imageClassName="h-full w-full"
      />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-zinc-50">
          {item.orderIndex}. {exerciseName}
        </p>
        <p className="mt-1 text-sm text-zinc-400">
          {item.targetReps ? `${item.workSetCount} x ${item.targetReps} Wdh` : null}
          {item.targetReps && item.targetSeconds ? ' · ' : null}
          {item.targetSeconds ? `${item.workSetCount} x ${item.targetSeconds}s` : null}
          {item.targetWeight ? ` · ${item.targetWeight} kg` : ''}
          {item.restSeconds ? ` · Pause ${item.restSeconds}s` : ''}
        </p>
        {item.notes ? <p className="mt-3 text-sm text-zinc-400">{item.notes}</p> : null}
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
  onDelete: (templateExerciseId: string) => void;
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
      className={`rounded-3xl border bg-zinc-950/45 p-4 transition ${
        isDragging
          ? 'border-lime-300/30 opacity-35 shadow-soft ring-2 ring-lime-300/20'
          : 'border-white/10 hover:border-lime-300/20 hover:bg-zinc-950/55'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 gap-3">
          <button
            type="button"
            aria-label={`${exerciseName} ziehen und umsortieren`}
            disabled={isBusy}
            className={`touch-none rounded-2xl border p-2 transition disabled:cursor-not-allowed disabled:opacity-35 ${
              isDragging
                ? 'cursor-grabbing border-lime-300/30 bg-lime-300/10 text-lime-200'
                : 'cursor-grab border-white/10 text-zinc-300 hover:bg-white/5 active:cursor-grabbing'
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
            className="rounded-2xl border border-white/10 p-2 text-zinc-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Pencil size={16} />
          </button>
          <button
            type="button"
            onClick={() => onDelete(item.id)}
            disabled={isBusy}
            className="rounded-2xl border border-rose-400/20 p-2 text-rose-200 transition hover:bg-rose-400/10 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function TemplateDetailPage() {
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
  const [pendingNewExerciseMediaFile, setPendingNewExerciseMediaFile] = useState<File | null>(null);
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
  const selectedExistingExercise =
    form.exerciseSource === 'existing'
      ? sortedExercises.find((item) => item.id === form.exerciseId)
      : undefined;
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
    const exercise = sortedExercises.find((entry) => entry.id === item?.exerciseId);

    setForm(buildFormState(item, exercise));
    setPendingNewExerciseMediaFile(null);
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
      const currentItem = editingTemplateExerciseId
        ? templateExercises?.find((entry) => entry.id === editingTemplateExerciseId)
        : undefined;
      const pendingMediaAssetId =
        form.exerciseSource === 'new' && pendingNewExerciseMediaFile
          ? await createPendingExerciseMedia({
              file: pendingNewExerciseMediaFile,
              fileName: pendingNewExerciseMediaFile.name,
              mimeType: pendingNewExerciseMediaFile.type,
            })
          : undefined;

      const result = await saveTemplateExercise({
        id: editingTemplateExerciseId ?? undefined,
        templateId: template.id,
        orderIndex: currentItem?.orderIndex ?? orderedTemplateExercises.length + 1,
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
        mediaAssetId: pendingMediaAssetId,
        trackingMode:
          form.exerciseSource === 'new'
            ? form.trackingMode
            : selectedExistingExercise?.trackingMode ?? 'reps_weight',
        unilateral:
          form.exerciseSource === 'new'
            ? form.unilateral
            : selectedExistingExercise?.unilateral ?? false,
      });

      if (form.exerciseSource === 'new') {
        setPendingNewExerciseMediaFile(null);
      }

      if (form.exerciseSource === 'existing' && pendingNewExerciseMediaFile) {
        await replaceExerciseMedia({
          exerciseId: result.exerciseId,
          file: pendingNewExerciseMediaFile,
          fileName: pendingNewExerciseMediaFile.name,
          mimeType: pendingNewExerciseMediaFile.type,
        });
        setPendingNewExerciseMediaFile(null);
      }

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
    const shouldDelete = window.confirm('Diese Uebung aus der Vorlage entfernen?');

    if (!shouldDelete) {
      return;
    }

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
          subtitle="Per Drag auf Touch und Desktop umsortieren. Ueber den Handle geht das auch per Tastatur."
          action={
            <button
              type="button"
              onClick={handleOpenAddTemplateExercise}
              className="flex h-10 items-center gap-2 rounded-2xl bg-lime-300/10 px-3 py-2 text-sm text-lime-200 transition hover:bg-lime-300/20"
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
                    className={`space-y-3 rounded-[28px] transition ${
                      activeTemplateExerciseId ? 'bg-lime-300/[0.03] p-1 ring-1 ring-lime-300/15' : ''
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
                        onDelete={handleDeleteTemplateExercise}
                      />
                    ))}
                  </div>
                </SortableContext>
                <DragOverlay>
                  {activeTemplateExercise ? (
                    <div className="w-[min(100vw-40px,32rem)] rounded-3xl border border-lime-300/35 bg-zinc-900/95 p-4 shadow-soft ring-2 ring-lime-300/20 backdrop-blur">
                      <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-lime-200/90">
                        <GripVertical size={14} />
                        <span>Loslassen zum Ablegen</span>
                      </div>
                      <div className="flex min-w-0 gap-3">
                        <div className="rounded-2xl border border-lime-300/30 bg-lime-300/10 p-2 text-lime-200">
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
              <div className="rounded-3xl border border-dashed border-white/10 bg-zinc-950/35 px-4 py-5 text-sm text-zinc-400">
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
              className="rounded-2xl border border-white/10 px-3 py-2 text-sm text-zinc-300 transition hover:bg-white/5"
            >
              Programme
            </Link>
          }
        >
          {(programs?.length ?? 0) === 0 ? (
            <div className="rounded-3xl border border-dashed border-white/10 bg-zinc-950/35 px-4 py-5 text-sm text-zinc-400">
              Lege zuerst ein Programm mit Wochen an, damit du Wochen-Overrides pflegen kannst.
            </div>
          ) : orderedTemplateExercises.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-white/10 bg-zinc-950/35 px-4 py-5 text-sm text-zinc-400">
              Fuege zuerst eine Template-Uebung hinzu. Danach kannst du hier die Progression je Woche editieren.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <select
                  value={selectedProgramId}
                  onChange={(event) => setSelectedProgramId(event.target.value)}
                  className="w-full rounded-3xl border border-white/10 bg-zinc-950/45 px-4 py-4 text-sm text-zinc-50 outline-none transition focus:border-lime-300/40"
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
                  className="w-full rounded-3xl border border-white/10 bg-zinc-950/45 px-4 py-4 text-sm text-zinc-50 outline-none transition focus:border-lime-300/40"
                >
                  {orderedTemplateExercises.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.orderIndex}. {nameById[item.exerciseId] ?? 'Unbekannte Uebung'}
                    </option>
                  ))}
                </select>
              </div>

              {selectedProgressionTemplateExercise ? (
                <div className="rounded-3xl bg-zinc-950/45 p-4 text-sm text-zinc-400">
                  <p className="font-semibold text-zinc-100">
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
                        className="rounded-3xl border border-white/10 bg-zinc-950/45 p-4"
                      >
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-zinc-50">
                              W{week.weekNumber}
                              {week.label ? ` · ${week.label}` : ''}
                            </p>
                            <p className="mt-1 text-xs text-zinc-500">
                              Leer lassen = Basiswerte der Template-Uebung verwenden
                            </p>
                          </div>
                          {hasSavedRule ? (
                            <span className="rounded-2xl bg-lime-300/10 px-3 py-2 text-xs font-medium text-lime-200">
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
                              placeholder="Ziel-Wdh"
                              className="w-full rounded-3xl border border-white/10 bg-zinc-900 px-4 py-4 text-sm text-zinc-50 outline-none transition focus:border-lime-300/40"
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
                              placeholder="Ziel-Sekunden"
                              className="w-full rounded-3xl border border-white/10 bg-zinc-900 px-4 py-4 text-sm text-zinc-50 outline-none transition focus:border-lime-300/40"
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
                              placeholder="Ziel-Gewicht in kg"
                              className="w-full rounded-3xl border border-white/10 bg-zinc-900 px-4 py-4 text-sm text-zinc-50 outline-none transition focus:border-lime-300/40"
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
                            placeholder="Wochen-spezifische Notiz"
                            className="w-full rounded-3xl border border-white/10 bg-zinc-900 px-4 py-4 text-sm text-zinc-50 outline-none transition placeholder:text-zinc-500 focus:border-lime-300/40"
                          />

                          <div className="grid grid-cols-2 gap-3">
                            <button
                              type="button"
                              onClick={() => handleSaveProgressionForWeek(week.id)}
                              disabled={isSavingProgressionRule}
                              className="rounded-3xl bg-lime-300 px-4 py-4 text-sm font-semibold text-zinc-950 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Wochenwerte speichern
                            </button>
                            <button
                              type="button"
                              onClick={() => handleClearProgressionForWeek(week.id)}
                              disabled={isSavingProgressionRule}
                              className="rounded-3xl bg-white/5 px-4 py-4 text-sm font-medium text-zinc-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
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
                <div className="rounded-3xl border border-dashed border-white/10 bg-zinc-950/35 px-4 py-5 text-sm text-zinc-400">
                  Dieses Programm hat noch keine Wochen. Fuege sie in der Programm-Verwaltung hinzu.
                </div>
              )}
            </div>
          )}
        </SectionCard>

        <div ref={editExerciseSectionRef}>
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
                    <ExerciseMedia
                      mediaAsset={selectedExistingExerciseMedia}
                      alt={selectedExistingExercise.name}
                      className="mb-4 h-40 w-full"
                      imageClassName="h-full w-full"
                    />
                    <p className="font-semibold text-zinc-100">{selectedExistingExercise.name}</p>
                    <p className="mt-2">
                      Tracking: {selectedExistingExercise.trackingMode} ·{' '}
                      {selectedExistingExercise.unilateral ? 'unilateral' : 'beidseitig'}
                    </p>
                    {selectedExistingExercise.instructions ? (
                      <p className="mt-2">{selectedExistingExercise.instructions}</p>
                    ) : null}
                    <div className="mt-4 flex flex-wrap gap-2">
                      <label className="rounded-2xl border border-white/10 px-3 py-2 text-sm text-zinc-300 transition hover:bg-white/5">
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
                          className="rounded-2xl border border-rose-400/20 px-3 py-2 text-sm text-rose-200 transition hover:bg-rose-400/10 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Bild entfernen
                        </button>
                      ) : null}
                    </div>
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
                <div className="space-y-3 rounded-3xl bg-zinc-950/45 p-4">
                  <label className="block rounded-2xl border border-white/10 px-3 py-3 text-sm text-zinc-300 transition hover:bg-white/5">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0] ?? null;
                        setPendingNewExerciseMediaFile(file);
                        setMediaError(null);
                        event.target.value = '';
                      }}
                    />
                    {pendingNewExerciseMediaFile ? 'Bild ersetzen' : 'Bild fuer neue Uebung waehlen'}
                  </label>
                  <ExerciseMedia
                    blob={pendingNewExerciseMediaFile ?? undefined}
                    alt={form.exerciseName || 'Neue Uebung'}
                    className="h-40 w-full"
                    imageClassName="h-full w-full"
                  />
                  {pendingNewExerciseMediaFile ? (
                    <button
                      type="button"
                      onClick={() => setPendingNewExerciseMediaFile(null)}
                      className="rounded-2xl border border-white/10 px-3 py-2 text-sm text-zinc-300 transition hover:bg-white/5"
                    >
                      Bild entfernen
                    </button>
                  ) : null}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <input
                value={form.workSetCount}
                onChange={(event) => setForm((current) => ({ ...current, workSetCount: event.target.value }))}
                inputMode="numeric"
                placeholder="Arbeitssaetze"
                className="w-full rounded-3xl border border-white/10 bg-zinc-950/45 px-4 py-4 text-sm text-zinc-50 outline-none transition placeholder:text-zinc-500 focus:border-lime-300/40"
              />
                <p className="text-xs text-zinc-500">Die Reihenfolge aenderst du oben direkt per Drag am Handle.</p>
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
                disabled={isSavingExercise || isUpdatingExerciseMedia}
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

            {mediaError ? (
              <div className="rounded-3xl border border-rose-300/20 bg-rose-300/10 px-4 py-4 text-sm text-rose-100">
                {mediaError}
              </div>
            ) : null}
          </div>
        </SectionCard>
        </div>
      </div>
    </AppShell>
  );
}
