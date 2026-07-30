import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Trash2 } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Alert } from '@/components/Alert';
import { Empty } from '@/components/Empty';
import { SectionCard } from '@/components/SectionCard';
import { Button, IconButton } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SelectField, TextArea, TextField } from '@/components/ui/Field';
import { db } from '@/db/appDb';
import { createExerciseTest, deleteExerciseTest } from '@/db/test-actions';
import { calculateAsymmetryPercent } from '@/domain/session';
import { formatDateTime } from '@/lib/format';
import { parseNumberInput } from '@/lib/number-input';

interface TestFormState {
  exerciseId: string;
  leftValue: string;
  rightValue: string;
  notes: string;
}

const emptyForm: TestFormState = {
  exerciseId: '',
  leftValue: '',
  rightValue: '',
  notes: '',
};

export function TestsPage() {
  const tests = useLiveQuery(() => db.exerciseTests.orderBy('recordedAt').reverse().toArray(), []);
  const exercises = useLiveQuery(() => db.exercises.orderBy('name').toArray(), []);
  const [form, setForm] = useState<TestFormState>(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    if (!form.exerciseId && exercises?.length) {
      setForm((current) => ({ ...current, exerciseId: exercises[0].id }));
    }
  }, [exercises, form.exerciseId]);

  const left = parseNumberInput(form.leftValue);
  const right = parseNumberInput(form.rightValue);
  const canSubmit = left.status === 'valid' && right.status === 'valid' && Boolean(form.exerciseId);
  // Vorschau, damit die Kennzahl vor dem Speichern nachvollziehbar ist.
  const previewAsymmetry =
    left.status === 'valid' && right.status === 'valid'
      ? calculateAsymmetryPercent(left.value, right.value)
      : undefined;

  async function handleSubmit() {
    if (left.status !== 'valid' || right.status !== 'valid') {
      return;
    }

    setIsSaving(true);

    try {
      await createExerciseTest({
        exerciseId: form.exerciseId,
        leftValue: left.value,
        rightValue: right.value,
        notes: form.notes,
      });
      setForm({ ...emptyForm, exerciseId: form.exerciseId });
      setShowForm(false);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Test konnte nicht gespeichert werden.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) {
      return;
    }

    setIsSaving(true);

    try {
      await deleteExerciseTest(pendingDelete.id);
      setPendingDelete(null);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Test konnte nicht gelöscht werden.');
      setPendingDelete(null);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <AppShell title="Tests" eyebrow="Kraft und Asymmetrie">
      <div className="space-y-4">
        {error ? <Alert>{error}</Alert> : null}

        <SectionCard
          title="Neuer Test"
          subtitle="Links und rechts erfassen. Die Asymmetrie wird aus der größeren Seite berechnet."
          action={
            !showForm ? (
              <Button
                size="md"
                variant="primary"
                onClick={() => setShowForm(true)}
                disabled={(exercises?.length ?? 0) === 0}
              >
                <Plus size={16} />
                Erfassen
              </Button>
            ) : undefined
          }
        >
          {(exercises?.length ?? 0) === 0 ? (
            <p className="text-sm text-content-muted">
              Lege zuerst eine Übung in der Bibliothek an.
            </p>
          ) : showForm ? (
            <div className="space-y-3">
              <SelectField
                label="Übung"
                value={form.exerciseId}
                onChange={(event) => setForm((current) => ({ ...current, exerciseId: event.target.value }))}
              >
                {(exercises ?? []).map((exercise) => (
                  <option key={exercise.id} value={exercise.id}>
                    {exercise.name}
                  </option>
                ))}
              </SelectField>

              <div className="grid grid-cols-2 gap-3">
                <TextField
                  label="Links"
                  value={form.leftValue}
                  onChange={(event) => setForm((current) => ({ ...current, leftValue: event.target.value }))}
                  inputMode="decimal"
                  error={left.status === 'invalid' ? 'Bitte eine Zahl eintragen' : undefined}
                />
                <TextField
                  label="Rechts"
                  value={form.rightValue}
                  onChange={(event) => setForm((current) => ({ ...current, rightValue: event.target.value }))}
                  inputMode="decimal"
                  error={right.status === 'invalid' ? 'Bitte eine Zahl eintragen' : undefined}
                />
              </div>

              {previewAsymmetry !== undefined ? (
                <div className="rounded-panel bg-accent-soft px-4 py-3">
                  <p className="text-sm text-accent">
                    Asymmetrie: <span className="font-semibold">{previewAsymmetry}%</span>
                  </p>
                </div>
              ) : null}

              <TextArea
                label="Notiz"
                value={form.notes}
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                rows={2}
                placeholder="Kontext, Tagesform, Messbedingungen"
              />

              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setShowForm(false);
                    setForm({ ...emptyForm, exerciseId: form.exerciseId });
                  }}
                  disabled={isSaving}
                >
                  Abbrechen
                </Button>
                <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit || isSaving}>
                  Speichern
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-content-muted">
              {tests?.length ?? 0} Tests erfasst.
            </p>
          )}
        </SectionCard>

        {(tests?.length ?? 0) > 0 ? (
          (tests ?? []).map((test) => (
            <SectionCard
              key={test.id}
              title={test.exerciseNameSnapshot}
              subtitle={`Erfasst ${formatDateTime(test.recordedAt)}`}
              action={
                <IconButton
                  label={`Test vom ${formatDateTime(test.recordedAt)} löschen`}
                  variant="danger"
                  onClick={() => setPendingDelete({ id: test.id, name: test.exerciseNameSnapshot })}
                >
                  <Trash2 size={16} />
                </IconButton>
              }
            >
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-panel bg-surface p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-content-muted">Links</p>
                  <p className="mt-2 text-2xl font-semibold text-content">{test.leftValue}</p>
                </div>
                <div className="rounded-panel bg-surface p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-content-muted">Rechts</p>
                  <p className="mt-2 text-2xl font-semibold text-content">{test.rightValue}</p>
                </div>
                <div className="rounded-panel bg-accent-soft p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-accent">Asymmetrie</p>
                  <p className="mt-2 text-2xl font-semibold text-accent">{test.asymmetryPercent}%</p>
                </div>
              </div>
              {test.notes ? <p className="mt-4 text-sm text-content-muted">{test.notes}</p> : null}
            </SectionCard>
          ))
        ) : (
          <Empty
            title="Noch keine Tests"
            description="Erfasse einen Links-Rechts-Vergleich, um Asymmetrien über die Zeit im Blick zu behalten."
          />
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Test löschen?"
        description={`Der erfasste Test für "${pendingDelete?.name}" wird entfernt. Das lässt sich nicht rückgängig machen.`}
        busy={isSaving}
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </AppShell>
  );
}
