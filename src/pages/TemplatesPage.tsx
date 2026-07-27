import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { SectionCard } from '@/components/SectionCard';
import { db } from '@/db/appDb';

export function TemplatesPage() {
  const templates = useLiveQuery(() => db.workoutTemplates.toArray(), []);
  const templateExercises = useLiveQuery(() => db.workoutTemplateExercises.toArray(), []);
  const exercises = useLiveQuery(() => db.exercises.toArray(), []);

  const exerciseNameById = Object.fromEntries((exercises ?? []).map((item) => [item.id, item.name]));

  return (
    <AppShell title="Vorlagen" eyebrow="Plan">
      <div className="space-y-4">
        {(templates ?? []).map((template) => {
          const items = (templateExercises ?? [])
            .filter((item) => item.templateId === template.id)
            .sort((left, right) => left.orderIndex - right.orderIndex);

          return (
            <SectionCard
              key={template.id}
              title={template.name}
              subtitle={`${items.length} Uebungen · Session wird beim Start materialisiert`}
            >
              <div className="space-y-3">
                {items.map((item) => (
                  <Link
                    key={item.id}
                    to={`/templates/${template.id}`}
                    className="flex items-center justify-between rounded-3xl border border-white/10 bg-zinc-950/45 px-4 py-4"
                  >
                    <div>
                      <p className="text-sm font-semibold text-zinc-50">
                        {exerciseNameById[item.exerciseId] ?? 'Unbekannte Uebung'}
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
                ))}
              </div>
            </SectionCard>
          );
        })}

        <SectionCard
          title="Naechster Schritt"
          subtitle="Die Verwaltungs- und Editieroberflaeche folgt als naechste Iteration auf dieser Datenbasis."
        >
          <p className="text-sm text-zinc-400">
            Die Vorlagen kommen bereits aus Dexie. Damit koennen wir als naechstes echte CRUD-Dialoge,
            Medien-Upload und Progressions-Editoren daraufsetzen, ohne das Datenmodell umzubauen.
          </p>
        </SectionCard>
      </div>
    </AppShell>
  );
}
