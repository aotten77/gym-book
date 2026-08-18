import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, ChevronDown, ChevronUp, ImageOff, ImagePlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Alert } from '@/components/Alert';
import { Empty } from '@/components/Empty';
import { ExerciseMedia } from '@/components/ExerciseMedia';
import { ProgressChart } from '@/components/ProgressChart';
import { SectionCard } from '@/components/SectionCard';
import { Button, IconButton } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SelectField, TextArea, TextField } from '@/components/ui/Field';
import { db } from '@/db/appDb';
import {
  createExercise,
  deleteExercise,
  getExerciseUsage,
  updateExercise,
  type ExerciseInput,
} from '@/db/exercise-actions';
import { loadExerciseExecutions, loadExercisesTrainedSince } from '@/db/history-queries';
import { clearExerciseMedia, replaceExerciseMedia } from '@/db/media-actions';
import { loadTestsForExercise } from '@/db/test-actions';
import { startOfCalendarWeek } from '@/domain/calendar-week';
import type { Exercise, LoadKind, TrackingMode } from '@/domain/models';
import { buildProgressSeries, progressMetricFor } from '@/domain/progress';
import { supportsLoad } from '@/domain/tracking';
import { formatDateTime, formatLoadLabel, formatNumber } from '@/lib/format';
import { isSupportedMediaType } from '@/lib/media';

const TRACKING_MODE_LABELS: Record<TrackingMode, string> = {
  reps_weight: 'Wiederholungen + Gewicht',
  time: 'Zeit',
  time_weight: 'Zeit + Gewicht',
};

const emptyForm: ExerciseInput = {
  name: '',
  instructions: '',
  tempo: '',
  trackingMode: 'reps_weight',
  loadKind: 'weight',
  tracksHeight: false,
  unilateral: false,
};

function ExerciseDetail({ exercise }: { exercise: Exercise }) {
  const executions = useLiveQuery(() => loadExerciseExecutions(exercise.id), [exercise.id]);
  const tests = useLiveQuery(() => loadTestsForExercise(exercise.id), [exercise.id]);
  const media = useLiveQuery(
    async () => (exercise.mediaAssetId ? db.mediaAssets.get(exercise.mediaAssetId) : undefined),
    [exercise.mediaAssetId],
  );
  const bandLevels = useLiveQuery(() => db.bandLevels.orderBy('orderIndex').toArray(), []);

  /*
   * Die Y-Achse einer Band-Übung ist die Position im Katalog. Sie kommt aus
   * der Reihenfolge, nicht aus `orderIndex` selbst - so bleibt die Skala
   * dicht, auch wenn im Katalog einmal eine Lücke entstanden ist.
   */
  const bandRankById = new Map((bandLevels ?? []).map((band, index) => [band.id, index + 1]));
  const bandNameByRank = new Map((bandLevels ?? []).map((band, index) => [index + 1, band.name]));
  // An der Kennzahl, nicht an der Belastungsart: eine Band-Übung, die eine
  // Höhe mitschreibt, hat cm auf der Achse und keine Bandnamen.
  const isBandChart = exercise.loadKind === 'band' && exercise.tracksHeight !== true;

  const points = buildProgressSeries(executions ?? [], exercise.trackingMode, {
    loadKind: exercise.loadKind,
    tracksHeight: exercise.tracksHeight,
    bandRank: (bandId) => bandRankById.get(bandId),
  });
  const metric = progressMetricFor(
    exercise.trackingMode,
    exercise.loadKind,
    exercise.tracksHeight,
  );
  const recent = [...(executions ?? [])].reverse().slice(0, 5);
  const recentTests = [...(tests ?? [])].reverse().slice(0, 5);

  return (
    <div className="mt-3 space-y-3 border-t border-line pt-3">
      {media ? (
        <ExerciseMedia mediaAsset={media} alt={exercise.name} className="h-40 w-full" imageClassName="h-full w-full" />
      ) : null}

      {exercise.instructions ? (
        <p className="text-sm text-content-secondary">{exercise.instructions}</p>
      ) : null}

      {exercise.tempo ? (
        <p className="text-sm text-content-muted">Tempo: {exercise.tempo}</p>
      ) : null}

      <div className="rounded-panel bg-surface p-4">
        <p className="text-xs uppercase tracking-[0.18em] text-content-muted">
          Verlauf · bester Arbeitssatz ({metric.label})
        </p>
        {points.length > 0 ? (
          <div className="mt-3">
            <ProgressChart
              points={points}
              unit={metric.unit}
              label={metric.label}
              formatValue={
                isBandChart ? (value) => bandNameByRank.get(value) ?? `Stufe ${value}` : undefined
              }
            />
          </div>
        ) : (
          <p className="mt-2 text-sm text-content-muted">
            Noch keine abgeschlossene Session mit dieser Übung.
          </p>
        )}
      </div>

      {recent.length > 0 ? (
        <div className="rounded-panel bg-surface p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-content-muted">Letzte Ausführungen</p>
          <ul className="mt-3 space-y-2">
            {recent.map((execution) => (
              <li key={execution.sessionExerciseId} className="text-sm">
                <p className="text-content-secondary">
                  {formatDateTime(execution.completedAt)} · {execution.templateName}
                </p>
                <p className="mt-0.5 text-content-muted">
                  {execution.workLogs.map((log) => formatLoadLabel(log)).join(' · ') ||
                    'Keine Arbeitssätze geloggt'}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {recentTests.length > 0 ? (
        <div className="rounded-panel bg-surface p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-content-muted">
            Tests · links/rechts
          </p>
          <ul className="mt-3 space-y-3">
            {recentTests.map((test) => (
              <li key={test.id} className="text-sm">
                <p className="text-content-secondary">{formatDateTime(test.recordedAt)}</p>
                <p className="mt-0.5 text-content-muted">
                  Links {formatNumber(test.leftValue)} · Rechts {formatNumber(test.rightValue)} ·
                  Asymmetrie {formatNumber(test.asymmetryPercent)}%
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function ExercisesPage() {
  const exercises = useLiveQuery(() => db.exercises.orderBy('name').toArray(), []);
  const bandLevels = useLiveQuery(() => db.bandLevels.orderBy('orderIndex').toArray(), []);
  const mediaAssets = useLiveQuery(() => db.mediaAssets.toArray(), []);
  const exercisesTrainedThisWeek = useLiveQuery(
    () => loadExercisesTrainedSince(startOfCalendarWeek(new Date()).toISOString()),
    [],
  );
  const mediaAssetById = Object.fromEntries((mediaAssets ?? []).map((asset) => [asset.id, asset]));
  const [form, setForm] = useState<ExerciseInput>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<
    { exercise: Exercise; templateNames: string[]; sessionCount: number } | null
  >(null);
  const [showForm, setShowForm] = useState(false);
  /*
   * Das gewählte Bild liegt bis zum Speichern nur im Formular: eine Übung,
   * die es noch nicht gibt, kann kein Bild tragen. `mediaRemoved` merkt sich
   * für den Bearbeiten-Fall, dass das vorhandene Bild weg soll.
   */
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaRemoved, setMediaRemoved] = useState(false);

  const editingExercise = editingId
    ? exercises?.find((item) => item.id === editingId)
    : undefined;
  const editingMedia = useLiveQuery(
    async () =>
      editingExercise?.mediaAssetId ? db.mediaAssets.get(editingExercise.mediaAssetId) : undefined,
    [editingExercise?.mediaAssetId],
  );
  const previewBlob = mediaFile ?? (mediaRemoved ? undefined : editingMedia?.blob);

  useEffect(() => {
    setMediaFile(null);
    setMediaRemoved(false);

    if (!editingId) {
      return;
    }

    const exercise = exercises?.find((item) => item.id === editingId);

    if (exercise) {
      setForm({
        name: exercise.name,
        instructions: exercise.instructions ?? '',
        tempo: exercise.tempo ?? '',
        trackingMode: exercise.trackingMode,
        loadKind: exercise.loadKind ?? 'weight',
        tracksHeight: exercise.tracksHeight === true,
        unilateral: exercise.unilateral,
      });
    }
    // Nur beim Wechsel der bearbeiteten Übung neu befüllen - sonst würde
    // jede Live-Query-Aktualisierung die Eingaben überschreiben.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(false);
    setMediaFile(null);
    setMediaRemoved(false);
  }

  function handleSelectMedia(file: File | undefined) {
    if (!file) {
      return;
    }

    if (!isSupportedMediaType(file.type)) {
      setError('Nur JPG, PNG, GIF und WebP werden unterstützt.');
      return;
    }

    setError(null);
    setMediaFile(file);
    setMediaRemoved(false);
  }

  function handleRemoveMedia() {
    setMediaFile(null);
    setMediaRemoved(true);
  }

  async function handleSubmit() {
    setIsSaving(true);

    try {
      if (editingId) {
        await updateExercise(editingId, form);

        if (mediaFile) {
          await replaceExerciseMedia({
            exerciseId: editingId,
            file: mediaFile,
            fileName: mediaFile.name,
            mimeType: mediaFile.type,
          });
        } else if (mediaRemoved) {
          await clearExerciseMedia(editingId);
        }
      } else {
        await createExercise(
          form,
          mediaFile
            ? { file: mediaFile, fileName: mediaFile.name, mimeType: mediaFile.type }
            : undefined,
        );
      }

      setError(null);
      resetForm();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Speichern fehlgeschlagen.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRequestDelete(exercise: Exercise) {
    try {
      const usage = await getExerciseUsage(exercise.id);
      setPendingDelete({ exercise, templateNames: usage.templateNames, sessionCount: usage.sessionCount });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Prüfung fehlgeschlagen.');
    }
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) {
      return;
    }

    setIsSaving(true);

    try {
      await deleteExercise(pendingDelete.exercise.id);
      setError(null);
      setPendingDelete(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Löschen fehlgeschlagen.');
      setPendingDelete(null);
    } finally {
      setIsSaving(false);
    }
  }

  const canDelete = pendingDelete?.templateNames.length === 0;

  return (
    <AppShell title="Übungen" eyebrow="Bibliothek">
      <div className="space-y-4">
        {error ? <Alert>{error}</Alert> : null}

        <SectionCard
          title={editingId ? 'Übung bearbeiten' : 'Neue Übung'}
          subtitle="Stammdaten gelten für alle Workouts. Laufende und vergangene Trainings bleiben unverändert."
          action={
            !showForm ? (
              <Button size="md" variant="primary" onClick={() => setShowForm(true)}>
                <Plus size={16} />
                Anlegen
              </Button>
            ) : undefined
          }
        >
          {showForm || editingId ? (
            <div className="space-y-3">
              <TextField
                label="Name"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="z. B. Front Squat"
                autoComplete="off"
              />
              <TextArea
                label="Anleitung"
                value={form.instructions}
                onChange={(event) =>
                  setForm((current) => ({ ...current, instructions: event.target.value }))
                }
                rows={3}
                placeholder="Worauf es bei der Ausführung ankommt"
              />
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  label="Tempo"
                  value={form.tempo}
                  onChange={(event) => setForm((current) => ({ ...current, tempo: event.target.value }))}
                  placeholder="3-1-1"
                  autoComplete="off"
                />
                <SelectField
                  label="Tracking"
                  value={form.trackingMode}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      trackingMode: event.target.value as TrackingMode,
                    }))
                  }
                >
                  {Object.entries(TRACKING_MODE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </SelectField>
              </div>

              {/*
                Belastungsart nur, wenn die Übung überhaupt eine Last trägt:
                bei reiner Zeit gibt es weder Kilo noch Band zu wählen.
              */}
              {supportsLoad(form.trackingMode) ? (
                <SelectField
                  label="Belastung"
                  value={form.loadKind ?? 'weight'}
                  hint={
                    form.loadKind === 'band' && (bandLevels?.length ?? 0) === 0
                      ? 'Noch keine Bänder angelegt - das machst du in den Einstellungen.'
                      : 'Band-Übungen protokollieren statt Kilo eine Stufe aus deinem Band-Katalog.'
                  }
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      loadKind: event.target.value as LoadKind,
                    }))
                  }
                >
                  <option value="weight">Gewicht in kg</option>
                  <option value="band">Band</option>
                </SelectField>
              ) : null}

              <button
                type="button"
                aria-pressed={form.unilateral}
                onClick={() => setForm((current) => ({ ...current, unilateral: !current.unilateral }))}
                className={`min-h-touch w-full rounded-panel px-4 py-3 text-sm font-medium transition ${
                  form.unilateral
                    ? 'bg-accent-soft text-accent'
                    : 'bg-surface-raised text-content-secondary hover:bg-surface-hover'
                }`}
              >
                {form.unilateral ? 'Unilateral: links/rechts getrennt' : 'Beidseitig'}
              </button>

              {/*
                Die Höhe hängt nicht am Tracking-Modus, sondern nur an diesem
                Schalter: sie ist keine Last, sondern der Weg der Übung, und
                kann deshalb neben Kilo oder Band stehen.
              */}
              <div>
                <button
                  type="button"
                  aria-pressed={form.tracksHeight === true}
                  onClick={() =>
                    setForm((current) => ({ ...current, tracksHeight: !current.tracksHeight }))
                  }
                  className={`min-h-touch w-full rounded-panel px-4 py-3 text-sm font-medium transition ${
                    form.tracksHeight
                      ? 'bg-accent-soft text-accent'
                      : 'bg-surface-raised text-content-secondary hover:bg-surface-hover'
                  }`}
                >
                  {form.tracksHeight ? 'Höhe in cm mitschreiben' : 'Ohne Höhe'}
                </button>
                <p className="mt-1.5 text-xs text-content-muted">
                  Für Übungen, bei denen die Stufe den Fortschritt trägt - etwa ein Step-Down von
                  20 auf 25 cm. Die Höhe steht neben Kilo oder Band, nicht an deren Stelle, und
                  wird dann zur Kurve im Verlauf.
                </p>
              </div>

              <div>
                <p className="mb-1.5 text-xs font-medium text-content-muted">Bild</p>

                {previewBlob ? (
                  <ExerciseMedia
                    blob={previewBlob}
                    alt={form.name.trim() ? `Bild von ${form.name.trim()}` : 'Gewähltes Bild'}
                    className="mb-2 h-40 w-full"
                    imageClassName="h-full w-full"
                  />
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <label className="inline-flex min-h-touch flex-1 cursor-pointer items-center justify-center gap-2 rounded-control border border-line px-4 text-sm font-medium text-content-secondary transition hover:bg-surface-raised focus-within:ring-2 focus-within:ring-accent">
                    <ImagePlus size={16} />
                    {previewBlob ? 'Bild ersetzen' : 'Bild wählen'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      aria-label={previewBlob ? 'Bild ersetzen' : 'Bild wählen'}
                      className="sr-only"
                      onChange={(event) => {
                        handleSelectMedia(event.target.files?.[0]);
                        event.target.value = '';
                      }}
                    />
                  </label>

                  {previewBlob ? (
                    <Button size="md" variant="ghost" onClick={handleRemoveMedia}>
                      Bild entfernen
                    </Button>
                  ) : null}
                </div>

                <p className="mt-1.5 text-xs text-content-muted">
                  JPG, PNG, GIF oder WebP - wird zusammen mit der Übung gespeichert.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Button variant="ghost" onClick={resetForm} disabled={isSaving}>
                  Abbrechen
                </Button>
                <Button
                  variant="primary"
                  onClick={handleSubmit}
                  disabled={!form.name.trim() || isSaving}
                >
                  {editingId ? 'Speichern' : 'Anlegen'}
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-content-muted">
              {exercises?.length ?? 0} Übungen in der Bibliothek.
            </p>
          )}
        </SectionCard>

        {(exercises?.length ?? 0) === 0 ? (
          <Empty
            title="Noch keine Übung"
            description="Lege deine erste Übung an. Sie steht danach in allen Workouts zur Auswahl."
          />
        ) : null}

        {/*
          Eine Zeile je Übung statt einer ganzen `SectionCard`: die Seite ist
          eine Bibliothek, durch die man scrollt, und 20 gleich große Karten
          mit je einer Überschrift lassen sich nicht überfliegen. Kein
          Limettenfeld - in einer Bibliothek ist nichts "jetzt dran"; getragen
          wird die Liste von den Bildern.
        */}
        {(exercises ?? []).map((exercise) => {
          const isExpanded = expandedId === exercise.id;
          const media = exercise.mediaAssetId ? mediaAssetById[exercise.mediaAssetId] : undefined;
          const trainedThisWeek = exercisesTrainedThisWeek?.has(exercise.id) ?? false;

          return (
            <section key={exercise.id} className="rounded-card border border-line bg-surface p-3 shadow-soft">
              <div className="flex items-start gap-3">
                {/*
                  Der Platzhalter liegt außen herum: `ExerciseMedia` rendert
                  ohne Bild `null`, und ohne festen Rahmen sprängen die Zeilen
                  je nachdem, ob eine Übung ein Bild hat.
                */}
                <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-control border border-line bg-surface-raised text-content-muted">
                  {media ? (
                    <ExerciseMedia
                      mediaAsset={media}
                      alt=""
                      className="h-full w-full rounded-none border-0"
                      imageClassName="h-full w-full"
                    />
                  ) : (
                    <ImageOff size={18} aria-hidden="true" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-sm font-semibold text-content">{exercise.name}</h2>
                  <p className="mt-0.5 text-sm text-content-muted">
                    {TRACKING_MODE_LABELS[exercise.trackingMode]}
                    {exercise.tracksHeight ? ' · Höhe' : ''}
                    {exercise.unilateral ? ' · links/rechts' : ''}
                  </p>
                  {/*
                    Waldgrün heißt erledigt - und darf sich wiederholen. Mehr
                    braucht die Bibliothek nicht: sie beantwortet "habe ich das
                    schon trainiert", nicht "was mache ich als Nächstes".
                  */}
                  {trainedThisWeek ? (
                    <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-success px-2.5 py-1 text-[11px] font-semibold text-success-contrast">
                      <Check size={12} strokeWidth={3} aria-hidden="true" />
                      Diese Woche
                    </p>
                  ) : null}
                </div>

                <div className="flex shrink-0 gap-1">
                  <IconButton
                    label={`${exercise.name} bearbeiten`}
                    onClick={() => {
                      setEditingId(exercise.id);
                      setShowForm(true);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                  >
                    <Pencil size={16} />
                  </IconButton>
                  <IconButton
                    label={`${exercise.name} löschen`}
                    variant="danger"
                    onClick={() => void handleRequestDelete(exercise)}
                  >
                    <Trash2 size={16} />
                  </IconButton>
                </div>
              </div>

              {/*
                Das Bild wird im Formular gepflegt, nicht hier: eine zweite
                Stelle dafür hieß, dass man es beim Anlegen erst nachreichen
                musste.
              */}
              <Button
                size="md"
                variant="ghost"
                className="mt-3"
                onClick={() => setExpandedId(isExpanded ? null : exercise.id)}
                aria-expanded={isExpanded}
              >
                {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                {isExpanded ? 'Verlauf ausblenden' : 'Verlauf anzeigen'}
              </Button>

              {isExpanded ? <ExerciseDetail exercise={exercise} /> : null}
            </section>
          );
        })}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={canDelete ? 'Übung löschen?' : 'Löschen nicht möglich'}
        description={
          canDelete
            ? `"${pendingDelete?.exercise.name}" wird aus der Bibliothek entfernt.${
                pendingDelete && pendingDelete.sessionCount > 0
                  ? ` Die ${pendingDelete.sessionCount} bereits protokollierten Ausführungen bleiben im Verlauf erhalten.`
                  : ''
              }`
            : `"${pendingDelete?.exercise.name}" wird noch in ${pendingDelete?.templateNames.join(', ')} verwendet. Entferne die Übung dort zuerst.`
        }
        confirmLabel={canDelete ? 'Löschen' : 'Verstanden'}
        cancelLabel={canDelete ? 'Abbrechen' : 'Schließen'}
        destructive={canDelete}
        busy={isSaving}
        onConfirm={canDelete ? handleConfirmDelete : () => setPendingDelete(null)}
        onCancel={() => setPendingDelete(null)}
      />
    </AppShell>
  );
}
