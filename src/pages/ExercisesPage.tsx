import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronDown, ChevronUp, Dumbbell, Pencil, Plus, Trash2 } from 'lucide-react';
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
import { loadExerciseExecutions } from '@/db/history-queries';
import { clearExerciseMedia, replaceExerciseMedia } from '@/db/media-actions';
import { loadTestsForExercise } from '@/db/test-actions';
import type { Exercise, TrackingMode } from '@/domain/models';
import { buildProgressSeries, progressMetricFor } from '@/domain/progress';
import { formatDateTime, formatLoadLabel } from '@/lib/format';
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
  unilateral: false,
};

function ExerciseDetail({ exercise }: { exercise: Exercise }) {
  const executions = useLiveQuery(() => loadExerciseExecutions(exercise.id), [exercise.id]);
  const tests = useLiveQuery(() => loadTestsForExercise(exercise.id), [exercise.id]);
  const media = useLiveQuery(
    async () => (exercise.mediaAssetId ? db.mediaAssets.get(exercise.mediaAssetId) : undefined),
    [exercise.mediaAssetId],
  );

  const points = buildProgressSeries(executions ?? [], exercise.trackingMode);
  const metric = progressMetricFor(exercise.trackingMode);
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
            <ProgressChart points={points} unit={metric.unit} label={metric.label} />
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
                  Links {test.leftValue} · Rechts {test.rightValue} · Asymmetrie{' '}
                  {test.asymmetryPercent}%
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
  const [form, setForm] = useState<ExerciseInput>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<
    { exercise: Exercise; templateNames: string[]; sessionCount: number } | null
  >(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
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
  }

  async function handleSubmit() {
    setIsSaving(true);

    try {
      if (editingId) {
        await updateExercise(editingId, form);
      } else {
        await createExercise(form);
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

  async function handleMediaChange(exerciseId: string, file: File | undefined) {
    if (!file) {
      return;
    }

    if (!isSupportedMediaType(file.type)) {
      setError('Nur JPG, PNG, GIF und WebP werden unterstützt.');
      return;
    }

    try {
      await replaceExerciseMedia({
        exerciseId,
        file,
        fileName: file.name,
        mimeType: file.type,
      });
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Bild konnte nicht gespeichert werden.');
    }
  }

  const canDelete = pendingDelete?.templateNames.length === 0;

  return (
    <AppShell title="Übungen" eyebrow="Bibliothek">
      <div className="space-y-4">
        {error ? <Alert>{error}</Alert> : null}

        <SectionCard
          title={editingId ? 'Übung bearbeiten' : 'Neue Übung'}
          subtitle="Stammdaten gelten für alle Vorlagen. Laufende und vergangene Sessions bleiben unverändert."
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
            description="Lege deine erste Übung an. Sie steht danach in allen Vorlagen und Sessions zur Auswahl."
          />
        ) : null}

        {(exercises ?? []).map((exercise) => {
          const isExpanded = expandedId === exercise.id;

          return (
            <SectionCard
              key={exercise.id}
              title={exercise.name}
              subtitle={`${TRACKING_MODE_LABELS[exercise.trackingMode]}${
                exercise.unilateral ? ' · links/rechts' : ''
              }`}
              action={
                <div className="flex gap-2">
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
              }
            >
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="md"
                    variant="ghost"
                    onClick={() => setExpandedId(isExpanded ? null : exercise.id)}
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    {isExpanded ? 'Verlauf ausblenden' : 'Verlauf anzeigen'}
                  </Button>

                  <label className="inline-flex min-h-touch cursor-pointer items-center justify-center gap-2 rounded-control border border-line px-4 text-sm font-medium text-content-secondary transition hover:bg-surface-raised focus-within:ring-2 focus-within:ring-accent">
                    <Dumbbell size={16} />
                    {exercise.mediaAssetId ? 'Bild ersetzen' : 'Bild wählen'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      aria-label={`Bild für ${exercise.name} wählen`}
                      className="sr-only"
                      onChange={(event) => {
                        void handleMediaChange(exercise.id, event.target.files?.[0]);
                        event.target.value = '';
                      }}
                    />
                  </label>

                  {exercise.mediaAssetId ? (
                    <Button
                      size="md"
                      variant="ghost"
                      onClick={() => void clearExerciseMedia(exercise.id)}
                    >
                      Bild entfernen
                    </Button>
                  ) : null}
                </div>

                {isExpanded ? <ExerciseDetail exercise={exercise} /> : null}
              </div>
            </SectionCard>
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
                  ? ` Die ${pendingDelete.sessionCount} bereits protokollierten Ausführungen bleiben in der Historie erhalten.`
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
