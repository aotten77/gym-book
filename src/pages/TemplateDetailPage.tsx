import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ChevronDown,
  ChevronUp,
  ImageOff,
  Link2,
  Pencil,
  Play,
  Plus,
  Trash2,
  Unlink,
} from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Alert } from '@/components/Alert';
import { Empty } from '@/components/Empty';
import { Button, IconButton } from '@/components/ui/Button';
import { CheckboxField } from '@/components/ui/Field';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { NowCard } from '@/components/ui/StatusCard';
import { Sheet } from '@/components/ui/Sheet';
import { ExerciseMedia } from '@/components/ExerciseMedia';
import { ExerciseTargetFields } from '@/components/ExerciseTargetFields';
import { formatNumber, formatTrackingMode } from '@/lib/format';
import { optionalNumberInput, toInputValue } from '@/lib/number-input';
import { SectionCard } from '@/components/SectionCard';
import { SupersetBlock } from '@/components/SupersetBlock';
import { TemplateProgressionSection } from '@/components/TemplateProgressionSection';
import { db } from '@/db/appDb';
import { clearExerciseMedia, replaceExerciseMedia } from '@/db/media-actions';
import { startSessionFromTemplate } from '@/db/session-actions';
import {
  deleteTemplate,
  deleteTemplateExercise,
  groupTemplateExerciseWithPrevious,
  reorderTemplateExercises,
  saveTemplateExercise,
  ungroupTemplateExercise,
  updateTemplate,
} from '@/db/template-actions';
import { prefillTargetReps } from '@/domain/exercise-defaults';
import type { MediaAsset, WorkoutTemplateExercise } from '@/domain/models';
import { describeRepRange } from '@/domain/session-summary';
import { buildSupersetBlocks, moveSupersetBlock, moveWithinGroup } from '@/domain/superset';

interface TemplateExerciseFormState {
  exerciseId: string;
  workSetCount: string;
  includeWarmup: boolean;
  targetReps: string;
  targetRepsMax: string;
  targetSeconds: string;
  targetWeight: string;
  targetBandId: string;
  targetHeightCm: string;
  restSeconds: string;
  notes: string;
}

const defaultFormState: TemplateExerciseFormState = {
  exerciseId: '',
  workSetCount: '3',
  includeWarmup: true,
  targetReps: '',
  targetRepsMax: '',
  targetSeconds: '',
  targetWeight: '',
  targetBandId: '',
  targetHeightCm: '',
  restSeconds: '',
  notes: '',
};

function buildFormState(item?: WorkoutTemplateExercise): TemplateExerciseFormState {
  if (!item) {
    return defaultFormState;
  }

  return {
    exerciseId: item.exerciseId,
    workSetCount: String(item.workSetCount),
    // Altdaten ohne den Schlüssel behalten ihr Warmup.
    includeWarmup: item.includeWarmup !== false,
    targetReps: toInputValue(item.targetReps),
    targetRepsMax: toInputValue(item.targetRepsMax),
    targetSeconds: toInputValue(item.targetSeconds),
    targetWeight: toInputValue(item.targetWeight),
    targetBandId: item.targetBandId ?? '',
    targetHeightCm: toInputValue(item.targetHeightCm),
    restSeconds: toInputValue(item.restSeconds),
    notes: item.notes ?? '',
  };
}

function TemplateExerciseMeta({
  item,
  exerciseName,
  bandName,
  mediaAsset,
}: {
  item: WorkoutTemplateExercise;
  exerciseName: string;
  /** Name des Ziel-Bands, aufgelöst aus dem Katalog. */
  bandName?: string;
  mediaAsset?: MediaAsset;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      {/*
        Der Platzhalter liegt außen herum: `ExerciseMedia` rendert ohne Bild
        `null`, und ohne festen Rahmen sprängen die Zeilen je nachdem, ob eine
        Übung ein Bild hat.
      */}
      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-control border border-line bg-surface-raised text-content-muted">
        {mediaAsset ? (
          <ExerciseMedia
            mediaAsset={mediaAsset}
            alt=""
            className="h-full w-full rounded-none border-0"
            imageClassName="h-full w-full"
          />
        ) : (
          <ImageOff size={18} aria-hidden="true" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-semibold text-content">
          {item.orderIndex}. {exerciseName}
        </p>
        <p className="mt-1 text-sm text-content-muted">
          {item.targetReps
            ? `${item.workSetCount} x ${describeRepRange(item.targetReps, item.targetRepsMax)} Wdh`
            : null}
          {item.targetReps && item.targetSeconds ? ' · ' : null}
          {item.targetSeconds ? `${item.workSetCount} x ${item.targetSeconds}s` : null}
          {item.targetHeightCm ? ` · ${formatNumber(item.targetHeightCm)} cm` : ''}
          {item.targetWeight ? ` · ${formatNumber(item.targetWeight)} kg` : ''}
          {bandName ? ` · ${bandName}` : ''}
          {item.restSeconds ? ` · Pause ${item.restSeconds}s` : ''}
        </p>
        {item.notes ? <p className="mt-2 text-sm text-content-muted">{item.notes}</p> : null}
      </div>
    </div>
  );
}

interface TemplateExerciseCardProps {
  item: WorkoutTemplateExercise;
  exerciseName: string;
  bandName?: string;
  mediaAsset?: MediaAsset;
  isBusy: boolean;
  isFirst: boolean;
  isLast: boolean;
  /** Ob die Übung zu einem Supersatz gehört. */
  isSupersetMember: boolean;
  /** Ob es eine Vorgängerin gibt, mit der sich verbinden lässt. */
  canGroupWithPrevious: boolean;
  onMove: (templateExerciseId: string, direction: -1 | 1) => void;
  onEdit: (templateExerciseId: string) => void;
  onDelete: (templateExerciseId: string, exerciseName: string) => void;
  onGroupWithPrevious: (templateExerciseId: string) => void;
  onUngroup: (templateExerciseId: string) => void;
}

/*
 * Sortiert wird über Pfeile, nicht per Drag: die alte Drag-Geste sprang schon
 * bei acht Pixeln an und veränderte beim Scrollen versehentlich die
 * Reihenfolge.
 */
function TemplateExerciseCard({
  item,
  exerciseName,
  bandName,
  mediaAsset,
  isBusy,
  isFirst,
  isLast,
  isSupersetMember,
  canGroupWithPrevious,
  onMove,
  onEdit,
  onDelete,
  onGroupWithPrevious,
  onUngroup,
}: TemplateExerciseCardProps) {
  /*
   * Innerhalb eines Supersatzes sortieren diese Pfeile nur die Gruppe - den
   * Block als Ganzes bewegen die Pfeile in seiner Kopfzeile. Ohne den Zusatz
   * hießen zwei Pfeilpaare auf demselben Bildschirm gleich.
   */
  const moveScopeLabel = isSupersetMember ? ' im Supersatz' : '';

  return (
    <div className="rounded-panel border border-line bg-surface p-3 transition hover:border-accent-border hover:bg-surface-sunken">
      {/*
        Bild und Name bekommen die ganze Breite. Vorher standen Sortierpfeile,
        Bild, Name und zwei Knöpfe in einer Zeile - auf einem Telefon blieben
        dem Namen rund 120px, also "Nordic Curl" über drei Zeilen, und ein Wort
        wie "Abduktorenmaschine" lief unter die Knöpfe. Alle Aktionen stehen
        jetzt in einer eigenen Reihe darunter.
      */}
      <TemplateExerciseMeta
        item={item}
        exerciseName={exerciseName}
        bandName={bandName}
        mediaAsset={mediaAsset}
      />

      {/*
        Fünf Trefferflächen à 44px messen mit den Lücken 236px, und auf einem
        320px-Gerät ist die Karte innen 228px breit - eine Reihe geht sich dort
        nicht aus, ab 390px schon. Deshalb gap-1 statt gap-2 und kein
        Trennstrich, und die Gruppierung trägt die Position: links alles zur
        Lage in der Liste, rechts Bearbeiten und Entfernen. Bricht es doch um,
        hält `ml-auto` die zweite Zeile rechtsbündig unter der ersten.
      */}
      <div className="mt-3 flex flex-wrap items-center gap-1">
        <div className="flex items-center gap-1">
          <IconButton
            label={`${exerciseName}${moveScopeLabel} nach oben`}
            onClick={() => onMove(item.id, -1)}
            disabled={isBusy || isFirst}
          >
            <ChevronUp size={16} />
          </IconButton>
          <IconButton
            label={`${exerciseName}${moveScopeLabel} nach unten`}
            onClick={() => onMove(item.id, 1)}
            disabled={isBusy || isLast}
          >
            <ChevronDown size={16} />
          </IconButton>

          {/*
            Verbinden steht bei den Pfeilen, weil es dasselbe meint: die Lage
            in der Liste. Nur das Icon - die Beschriftung stand auf jeder Zeile
            und war damit das Breiteste an einer Karte, die sonst aus
            Trefferflächen besteht. Den Namen trägt weiterhin `label`, sonst
            hießen in einer Vorlesereihe alle Knöpfe gleich.
          */}
          {isSupersetMember ? (
            <IconButton
              label={`${exerciseName} aus dem Supersatz lösen`}
              onClick={() => onUngroup(item.id)}
              disabled={isBusy}
            >
              <Unlink size={16} />
            </IconButton>
          ) : (
            <IconButton
              label={`${exerciseName} mit voriger Übung verbinden`}
              onClick={() => onGroupWithPrevious(item.id)}
              disabled={isBusy || !canGroupWithPrevious}
            >
              <Link2 size={16} />
            </IconButton>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <IconButton
            label={`${exerciseName} bearbeiten`}
            onClick={() => onEdit(item.id)}
            disabled={isBusy}
          >
            <Pencil size={16} />
          </IconButton>
          <IconButton
            label={`${exerciseName} aus Workout entfernen`}
            variant="danger"
            onClick={() => onDelete(item.id, exerciseName)}
            disabled={isBusy}
          >
            <Trash2 size={16} />
          </IconButton>
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
  const [templateName, setTemplateName] = useState('');
  const [templateNotes, setTemplateNotes] = useState('');
  const [editingTemplateExerciseId, setEditingTemplateExerciseId] = useState<string | null>(null);
  /*
   * Die Form lag früher als Abschnitt am Seitenende, und "Bearbeiten" scrollte
   * dorthin - an den vier Wochen der Progression vorbei, und zurück fand man
   * die Übung nur durch Suchen. Sie liegt jetzt im Sheet über der Liste, wie
   * die Übung in der laufenden Einheit: Schließen bringt einen an dieselbe
   * Stelle zurück, weil die Liste darunter nie bewegt wurde.
   */
  const [isExerciseSheetOpen, setIsExerciseSheetOpen] = useState(false);
  const [form, setForm] = useState<TemplateExerciseFormState>(defaultFormState);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [isSavingExercise, setIsSavingExercise] = useState(false);
  const [isUpdatingExerciseMedia, setIsUpdatingExerciseMedia] = useState(false);
  const [isReorderingExercises, setIsReorderingExercises] = useState(false);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
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
  const bandLevels = useLiveQuery(() => db.bandLevels.orderBy('orderIndex').toArray(), []);

  const bandNameById = Object.fromEntries((bandLevels ?? []).map((band) => [band.id, band.name]));
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
  const templateBlocks = useMemo(
    () => buildSupersetBlocks(orderedTemplateExercises),
    [orderedTemplateExercises],
  );
  /*
   * Was der Plan kostet, in den zwei Zahlen, die heute ableitbar sind. Eine
   * geschätzte Dauer stünde hier gern - sie bräuchte aber `materializeSession`
   * und die Schätzlogik der laufenden Einheit und ist deshalb ein eigenes
   * Vorhaben, kein Nebenprodukt einer Farbanpassung.
   */
  const plannedWorkSetCount = orderedTemplateExercises.reduce(
    (sum, item) => sum + item.workSetCount,
    0,
  );
  const selectedExistingExercise = sortedExercises.find((item) => item.id === form.exerciseId);
  const selectedExistingExerciseMedia =
    selectedExistingExercise?.mediaAssetId ? mediaAssetById[selectedExistingExercise.mediaAssetId] : undefined;
  useEffect(() => {
    setTemplateName(template?.name ?? '');
    setTemplateNotes(template?.notes ?? '');
  }, [template?.id, template?.name, template?.notes]);

  function handleEditTemplateExercise(templateExerciseId: string) {
    setEditingTemplateExerciseId(templateExerciseId);
    setIsExerciseSheetOpen(true);
  }

  function handleOpenAddTemplateExercise() {
    setEditingTemplateExerciseId(null);
    setIsExerciseSheetOpen(true);
  }

  /*
   * Schließen ist zugleich das Zurücksetzen: die Form füllt sich beim nächsten
   * Öffnen ohnehin neu aus dem Datensatz. Ein eigener Knopf dafür stand nur
   * neben dem Speichern und war der leisere von zweien, die gleich aussahen.
   */
  function handleCloseExerciseSheet() {
    setIsExerciseSheetOpen(false);
    setEditingTemplateExerciseId(null);
    setMediaError(null);
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
      const preselected = sortedExercises[0];

      setForm({
        ...defaultFormState,
        exerciseId: preselected?.id ?? '',
        // Auch die vorausgewählte Übung bringt ihre Empfehlung mit - sonst
        // hinge die Vorbelegung daran, ob jemand das Auswahlfeld anfasst.
        targetReps: prefillTargetReps(defaultFormState.targetReps, preselected),
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

  async function handleStartSession() {
    if (!template) {
      return;
    }

    setIsStartingSession(true);

    try {
      const sessionId = await startSessionFromTemplate(template.id);
      setStartError(null);
      navigate(`/session/${sessionId}`);
    } catch (error) {
      setStartError(
        error instanceof Error ? error.message : 'Session konnte nicht gestartet werden.',
      );
      setIsStartingSession(false);
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
        targetReps: optionalNumberInput(form.targetReps),
        targetRepsMax: optionalNumberInput(form.targetRepsMax),
        targetSeconds: optionalNumberInput(form.targetSeconds),
        targetWeight: optionalNumberInput(form.targetWeight),
        targetHeightCm: optionalNumberInput(form.targetHeightCm),
        targetBandId: form.targetBandId,
        restSeconds: optionalNumberInput(form.restSeconds),
        notes: form.notes,
        exerciseId: form.exerciseId,
      });

      setEditingTemplateExerciseId(null);
      setIsExerciseSheetOpen(false);
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

  /**
   * Sortiert eine geplante Übung um.
   *
   * Innerhalb eines Supersatzes bewegt sie sich nur in der Gruppe - der Block
   * als Ganzes wandert über die Pfeile in seiner Kopfzeile. Sonst zerrisse
   * jeder zweite Tap den Supersatz.
   */
  async function handleMoveTemplateExercise(templateExerciseId: string, direction: -1 | 1) {
    const item = orderedTemplateExercises.find((entry) => entry.id === templateExerciseId);

    await applyTemplateExerciseOrder(
      item?.supersetGroupId
        ? moveWithinGroup(orderedTemplateExercises, templateExerciseId, direction)
        : moveSupersetBlock(orderedTemplateExercises, templateExerciseId, direction),
    );
  }

  async function handleMoveSupersetBlock(templateExerciseId: string, direction: -1 | 1) {
    await applyTemplateExerciseOrder(
      moveSupersetBlock(orderedTemplateExercises, templateExerciseId, direction),
    );
  }

  async function handleGroupWithPrevious(templateExerciseId: string) {
    setIsReorderingExercises(true);

    try {
      await groupTemplateExerciseWithPrevious(templateExerciseId);
    } finally {
      setIsReorderingExercises(false);
    }
  }

  async function handleUngroupTemplateExercise(templateExerciseId: string) {
    setIsReorderingExercises(true);

    try {
      await ungroupTemplateExercise(templateExerciseId);
    } finally {
      setIsReorderingExercises(false);
    }
  }

  /**
   * Eine Übungszeile der Planung.
   *
   * Als Funktion und nicht inline, weil dieselbe Karte an zwei Stellen der
   * Liste steht: allein und als Mitglied eines Supersatz-Blocks.
   */
  function renderTemplateExerciseCard(
    item: WorkoutTemplateExercise,
    position: { isFirst: boolean; isLast: boolean; isSupersetMember?: boolean },
  ) {
    const mediaAssetId = exerciseById[item.exerciseId]?.mediaAssetId;

    return (
      <TemplateExerciseCard
        key={item.id}
        item={item}
        exerciseName={nameById[item.exerciseId] ?? 'Unbekannte Übung'}
        bandName={item.targetBandId ? bandNameById[item.targetBandId] : undefined}
        mediaAsset={mediaAssetId ? mediaAssetById[mediaAssetId] : undefined}
        isBusy={isReorderingExercises}
        isFirst={position.isFirst}
        isLast={position.isLast}
        isSupersetMember={position.isSupersetMember ?? false}
        canGroupWithPrevious={orderedTemplateExercises[0]?.id !== item.id}
        onMove={handleMoveTemplateExercise}
        onEdit={handleEditTemplateExercise}
        onDelete={(id, name) => setPendingDelete({ kind: 'exercise', id, name })}
        onGroupWithPrevious={(id) => void handleGroupWithPrevious(id)}
        onUngroup={(id) => void handleUngroupTemplateExercise(id)}
      />
    );
  }

  async function applyTemplateExerciseOrder(nextOrder: string[] | null) {
    if (!template || !nextOrder) {
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
      handleCloseExerciseSheet();
    }
  }

  return (
    <AppShell title={template?.name ?? 'Workout'} eyebrow="Workout">
      <div className="space-y-4">
        {startError ? <Alert>{startError}</Alert> : null}

        {/*
          Ein Plan kennt kein "erledigt" - es gibt hier nichts, was waldgrün
          werden könnte. Das eine Limettenfeld trägt deshalb nicht einen
          Zustand, sondern die Handlung, für die die ganze Seite da ist.
        */}
        {orderedTemplateExercises.length > 0 ? (
          <NowCard
            eyebrow="Bereit"
            title="Training starten"
            subtitle={`${orderedTemplateExercises.length === 1 ? '1 Übung' : `${orderedTemplateExercises.length} Übungen`} · ${plannedWorkSetCount === 1 ? '1 Satz' : `${plannedWorkSetCount} Sätze`}`}
            onClick={() => void handleStartSession()}
            disabled={isStartingSession}
            action={
              <span className="flex h-11 w-11 items-center justify-center rounded-control bg-accent text-accent-contrast">
                <Play size={18} />
              </span>
            }
          />
        ) : null}

        <SectionCard
          title="Workout-Daten"
          subtitle="Änderungen hier wirken auf künftige Trainings - bereits absolvierte bleiben, wie sie waren."
          action={
            <button
              type="button"
              onClick={() => setPendingDelete({ kind: 'template' })}
              className="min-h-touch inline-flex items-center justify-center rounded-control border border-danger-border px-3 py-2 text-sm text-danger transition hover:bg-danger-soft"
            >
              Löschen
            </button>
          }
        >
          <div className="space-y-3">
            <input
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
              aria-label="Workout-Name" placeholder="Workout-Name"
              className="w-full rounded-panel border border-line bg-surface px-4 py-4 text-base text-content outline-none transition placeholder:text-content-muted focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
            />
            <textarea
              value={templateNotes}
              onChange={(event) => setTemplateNotes(event.target.value)}
              aria-label="Notizen zur Einheit" placeholder="Notizen zur Einheit"
              rows={3}
              className="w-full rounded-panel border border-line bg-surface px-4 py-4 text-base text-content outline-none transition placeholder:text-content-muted focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
            />
            <Button
              variant="primary"
              fullWidth
              onClick={handleSaveTemplate}
              disabled={!templateName.trim() || isSavingTemplate}
            >
              Workout speichern
            </Button>
          </div>
        </SectionCard>

        <SectionCard
          title="Übungen im Workout"
          subtitle="Reihenfolge über die Pfeile - so verrutscht beim Scrollen nichts."
          action={
            /*
              Vorher standen hier zwei `flex` und ein `h-10` gegen das
              `min-h-touch` derselben Klassenkette - der Knopf maß 40px statt
              44px, je nachdem, welche Regel gewann.
            */
            <Button variant="ghost" size="md" onClick={handleOpenAddTemplateExercise}>
              <Plus size={16} />
              Hinzufügen
            </Button>
          }
        >
          <div className="space-y-3">
            {orderedTemplateExercises.length > 0 ? (
              <div className="space-y-3">
                {templateBlocks.map((block, blockIndex) => {
                  const isFirstBlock = blockIndex === 0;
                  const isLastBlock = blockIndex === templateBlocks.length - 1;

                  if (block.kind === 'single') {
                    return renderTemplateExerciseCard(block.exercise, {
                      isFirst: isFirstBlock,
                      isLast: isLastBlock,
                    });
                  }

                  return (
                    <SupersetBlock
                      key={block.groupId}
                      exerciseNames={block.exercises.map(
                        (entry) => nameById[entry.exerciseId] ?? 'Unbekannte Übung',
                      )}
                      action={
                        <div className="flex shrink-0 items-center gap-2">
                          <IconButton
                            label="Supersatz nach oben"
                            disabled={isReorderingExercises || isFirstBlock}
                            onClick={() => void handleMoveSupersetBlock(block.exercises[0].id, -1)}
                          >
                            <ChevronUp size={16} />
                          </IconButton>
                          <IconButton
                            label="Supersatz nach unten"
                            disabled={isReorderingExercises || isLastBlock}
                            onClick={() => void handleMoveSupersetBlock(block.exercises[0].id, 1)}
                          >
                            <ChevronDown size={16} />
                          </IconButton>
                        </div>
                      }
                    >
                      {block.exercises.map((item, memberIndex) =>
                        renderTemplateExerciseCard(item, {
                          isFirst: memberIndex === 0,
                          isLast: memberIndex === block.exercises.length - 1,
                          isSupersetMember: true,
                        }),
                      )}
                    </SupersetBlock>
                  );
                })}
              </div>
            ) : (
              <Empty
                title="Noch keine Übungen"
                description="Füge über „Hinzufügen“ eine Übung aus der Bibliothek hinzu, dann lässt sich das Workout starten."
              />
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
          bandLevels={bandLevels}
          activeProgramId={settings?.activeProgramId}
        />
      </div>

      <Sheet
        open={isExerciseSheetOpen}
        label={editingTemplateExerciseId ? 'Übung bearbeiten' : 'Übung hinzufügen'}
        closeLabel="Bearbeiten schließen"
        onClose={handleCloseExerciseSheet}
        header={
          <div className="min-w-0">
            <h2 className="font-display text-[21px] font-extrabold leading-[1.06] tracking-[-0.04em]">
              {editingTemplateExerciseId ? 'Übung bearbeiten' : 'Übung hinzufügen'}
            </h2>
            <p className="mt-0.5 truncate text-xs font-semibold text-content-muted">
              {editingTemplateExerciseId
                ? (selectedExistingExercise?.name ?? 'Übung aus der Bibliothek auswählen.')
                : 'Übung aus der Bibliothek auswählen.'}
            </p>
          </div>
        }
        footer={
          /*
            Der große Knopf steht im Fuß des Sheets, der am sichtbaren Viewport
            hängt - sonst schiebt iOS ihn unter die Tastatur, sobald ein
            Zahlenfeld den Fokus bekommt.
          */
          <Button
            variant="primary"
            fullWidth
            onClick={handleSaveTemplateExercise}
            disabled={isSavingExercise || isUpdatingExerciseMedia || !form.exerciseId}
          >
            {editingTemplateExerciseId ? 'Änderung speichern' : 'Übung hinzufügen'}
          </Button>
        }
      >
        <div className="space-y-4">
          {sortedExercises.length === 0 ? (
            <Empty
              title="Noch keine Übung in der Bibliothek"
              description="Lege zuerst eine Übung an - hier lassen sich nur bestehende auswählen."
              action={
                <Link
                  to="/exercises"
                  className="min-h-touch inline-flex items-center justify-center rounded-control border border-line px-4 py-2 text-sm text-content-secondary transition hover:bg-surface-raised"
                >
                  Jetzt anlegen
                </Link>
              }
            />
          ) : (
            <div className="space-y-3">
              <select
                value={form.exerciseId}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    exerciseId: event.target.value,
                    targetReps: prefillTargetReps(
                      current.targetReps,
                      sortedExercises.find((item) => item.id === event.target.value),
                    ),
                  }))
                }
                aria-label="Übung aus der Bibliothek"
                className="select-control min-h-touch w-full rounded-panel border border-line bg-surface px-4 py-4 text-base text-content outline-none transition focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
              >
                {sortedExercises.map((exercise) => (
                  <option key={exercise.id} value={exercise.id}>
                    {exercise.name}
                  </option>
                ))}
              </select>

              {selectedExistingExercise ? (
                <div className="rounded-panel bg-surface-raised p-4 text-sm text-content-muted">
                  <ExerciseMedia
                    mediaAsset={selectedExistingExerciseMedia}
                    alt={selectedExistingExercise.name}
                    className="mb-4 h-40 w-full"
                    imageClassName="h-full w-full"
                  />
                  <p className="font-semibold text-content">{selectedExistingExercise.name}</p>
                  <p className="mt-2">
                    Tracking: {formatTrackingMode(selectedExistingExercise.trackingMode)} ·{' '}
                    {selectedExistingExercise.unilateral ? 'unilateral' : 'beidseitig'}
                  </p>
                  {selectedExistingExercise.instructions ? (
                    <p className="mt-2">{selectedExistingExercise.instructions}</p>
                  ) : null}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <label className="min-h-touch inline-flex items-center justify-center rounded-control border border-line px-3 py-2 text-sm text-content-secondary transition hover:bg-surface-hover">
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
                        className="min-h-touch inline-flex items-center justify-center rounded-control border border-danger-border px-3 py-2 text-sm text-danger transition hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-50"
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
            loadKind={selectedExistingExercise?.loadKind}
            tracksHeight={selectedExistingExercise?.tracksHeight}
            bandLevels={bandLevels}
            values={form}
            onChange={(field, value) => setForm((current) => ({ ...current, [field]: value }))}
            workSetCountHint="Die Reihenfolge änderst du in der Liste mit den Pfeilen."
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

          {mediaError ? <Alert>{mediaError}</Alert> : null}
        </div>
      </Sheet>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete?.kind === 'template' ? 'Workout löschen?' : 'Übung entfernen?'}
        description={
          pendingDelete?.kind === 'template'
            ? `"${template?.name ?? ''}" wird entfernt. Bereits absolvierte Trainings bleiben im Verlauf erhalten.`
            : `"${pendingDelete?.kind === 'exercise' ? pendingDelete.name : ''}" wird aus diesem Workout entfernt. Die Übung selbst und ihr Verlauf bleiben bestehen.`
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
