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
    <AppShell title="Vorlagen" eyebrow="Plan">
      <div className="space-y-4">
        <SectionCard
          title="Neue Vorlage"
          subtitle="Direkt in Dexie anlegen und anschliessend im Detail mit Uebungen befuellen."
          action={
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-lime-300/10 text-lime-200">
              <Plus size={18} />
            </div>
          }
        >
          <div className="space-y-3">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="z. B. Einheit B"
              className="w-full rounded-3xl border border-white/10 bg-zinc-950/45 px-4 py-4 text-sm text-zinc-50 outline-none transition placeholder:text-zinc-500 focus:border-lime-300/40"
            />
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Kurznotiz fuer Fokus, Ziel oder Belastungssteuerung"
              rows={3}
              className="w-full rounded-3xl border border-white/10 bg-zinc-950/45 px-4 py-4 text-sm text-zinc-50 outline-none transition placeholder:text-zinc-500 focus:border-lime-300/40"
            />
            <button
              type="button"
              onClick={handleCreateTemplate}
              disabled={!name.trim() || isSaving}
              className="w-full rounded-3xl bg-lime-300 px-4 py-4 text-sm font-semibold text-zinc-950 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Vorlage anlegen
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
              subtitle={`${items.length} Uebungen · Session wird beim Start materialisiert`}
              action={
                <Link
                  to={`/templates/${template.id}`}
                  className="rounded-2xl border border-white/10 px-3 py-2 text-sm text-zinc-300 transition hover:bg-white/5"
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
                      className="flex items-center justify-between rounded-3xl border border-white/10 bg-zinc-950/45 px-4 py-4"
                    >
                      <div>
                        <p className="text-sm font-semibold text-zinc-50">
                          {item.orderIndex}. {exerciseNameById[item.exerciseId] ?? 'Unbekannte Uebung'}
                        </p>
                        <p className="mt-1 text-sm text-zinc-400">
                          {item.targetReps ? `${item.workSetCount} x ${item.targetReps} Wdh` : null}
                          {item.targetReps && item.targetSeconds ? ' · ' : null}
                          {item.targetSeconds ? `${item.workSetCount} x ${item.targetSeconds}s` : null}
                          {item.targetWeight ? ` · ${item.targetWeight} kg` : ''}
                        </p>
                      </div>
                      <ChevronRight size={18} className="text-zinc-600" />
                    </Link>
                  ))
                ) : (
                  <div className="rounded-3xl border border-dashed border-white/10 bg-zinc-950/35 px-4 py-5 text-sm text-zinc-400">
                    Noch keine Uebungen hinterlegt. Im Detailscreen kannst du bestehende Uebungen
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
