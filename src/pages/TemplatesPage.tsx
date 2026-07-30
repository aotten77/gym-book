import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronRight, Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { SectionCard } from '@/components/SectionCard';
import { db } from '@/db/appDb';
import { createTemplate } from '@/db/template-actions';

export function TemplatesPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const templates = useLiveQuery(() => db.workoutTemplates.toArray(), []);
  const templateExercises = useLiveQuery(() => db.workoutTemplateExercises.toArray(), []);
  const exercises = useLiveQuery(() => db.exercises.toArray(), []);

  const exerciseNameById = Object.fromEntries((exercises ?? []).map((item) => [item.id, item.name]));

  async function handleCreateTemplate() {
    if (!name.trim()) {
      return;
    }

    setIsSaving(true);

    try {
      const templateId = await createTemplate({ name, notes });
      setName('');
      setNotes('');
      navigate(`/templates/${templateId}`);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <AppShell title="Workouts">
      <div className="space-y-4">
        <SectionCard
          title="Neues Workout"
          subtitle="Erst benennen, dann im Detail mit Übungen füllen."
          action={
            <div className="flex h-10 w-10 items-center justify-center rounded-control bg-accent-soft text-accent">
              <Plus size={18} />
            </div>
          }
        >
          <div className="space-y-3">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-label="z. B. Einheit B" placeholder="z. B. Einheit B"
              className="w-full rounded-panel border border-line bg-surface px-4 py-4 text-base text-content outline-none transition placeholder:text-content-muted focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
            />
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              aria-label="Kurznotiz für Fokus, Ziel oder Belastungssteuerung" placeholder="Kurznotiz für Fokus, Ziel oder Belastungssteuerung"
              rows={3}
              className="w-full rounded-panel border border-line bg-surface px-4 py-4 text-base text-content outline-none transition placeholder:text-content-muted focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent"
            />
            <button
              type="button"
              onClick={handleCreateTemplate}
              disabled={!name.trim() || isSaving}
              className="w-full rounded-panel bg-accent px-4 py-4 text-sm font-semibold text-accent-contrast transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Workout anlegen
            </button>
          </div>
        </SectionCard>

        {(templates ?? []).map((template) => {
          const items = (templateExercises ?? [])
            .filter((item) => item.templateId === template.id)
            .sort((left, right) => left.orderIndex - right.orderIndex);

          return (
            <SectionCard
              key={template.id}
              title={template.name}
              subtitle={`${items.length} Übungen`}
              action={
                <Link
                  to={`/templates/${template.id}`}
                  className="min-h-touch inline-flex items-center justify-center rounded-control border border-line px-3 py-2 text-sm text-content-secondary transition hover:bg-surface-raised"
                >
                  Bearbeiten
                </Link>
              }
            >
              <div className="space-y-3">
                {items.length > 0 ? (
                  items.map((item) => (
                    <Link
                      key={item.id}
                      to={`/templates/${template.id}`}
                      className="flex items-center justify-between rounded-panel border border-line bg-surface px-4 py-4"
                    >
                      <div>
                        <p className="text-sm font-semibold text-content">
                          {item.orderIndex}. {exerciseNameById[item.exerciseId] ?? 'Unbekannte Übung'}
                        </p>
                        <p className="mt-1 text-sm text-content-muted">
                          {item.targetReps ? `${item.workSetCount} x ${item.targetReps} Wdh` : null}
                          {item.targetReps && item.targetSeconds ? ' · ' : null}
                          {item.targetSeconds ? `${item.workSetCount} x ${item.targetSeconds}s` : null}
                          {item.targetWeight ? ` · ${item.targetWeight} kg` : ''}
                        </p>
                      </div>
                      <ChevronRight size={18} className="text-content-muted" />
                    </Link>
                  ))
                ) : (
                  <div className="rounded-panel border border-dashed border-line bg-surface px-4 py-5 text-sm text-content-muted">
                    Noch keine Übungen hinterlegt. Im Detailscreen kannst du bestehende Übungen
                    referenzieren oder neue anlegen.
                  </div>
                )}
              </div>
            </SectionCard>
          );
        })}
      </div>
    </AppShell>
  );
}
