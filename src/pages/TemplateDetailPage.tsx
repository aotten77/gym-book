import { useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { AppShell } from '@/components/AppShell';
import { SectionCard } from '@/components/SectionCard';
import { db } from '@/db/appDb';

export function TemplateDetailPage() {
  const { templateId = '' } = useParams();
  const template = useLiveQuery(() => db.workoutTemplates.get(templateId), [templateId]);
  const templateExercises = useLiveQuery(
    () => db.workoutTemplateExercises.where('templateId').equals(templateId).sortBy('orderIndex'),
    [templateId],
  );
  const exercises = useLiveQuery(() => db.exercises.toArray(), []);

  const nameById = Object.fromEntries((exercises ?? []).map((item) => [item.id, item.name]));

  return (
    <AppShell title={template?.name ?? 'Vorlage'} eyebrow="Detail">
      <div className="space-y-4">
        <SectionCard
          title="Session-Materialisierung"
          subtitle="Diese Ansicht zeigt bereits die persistierte Template-Struktur aus Dexie."
        >
          <div className="space-y-3">
            {(templateExercises ?? []).map((item) => (
              <div key={item.id} className="rounded-3xl bg-zinc-950/45 p-4">
                <p className="text-sm font-semibold text-zinc-50">
                  {item.orderIndex}. {nameById[item.exerciseId] ?? 'Unbekannte Uebung'}
                </p>
                <p className="mt-1 text-sm text-zinc-400">
                  {item.targetReps ? `${item.workSetCount} x ${item.targetReps} Wdh` : null}
                  {item.targetReps && item.targetSeconds ? ' · ' : null}
                  {item.targetSeconds ? `${item.workSetCount} x ${item.targetSeconds}s` : null}
                  {item.targetWeight ? ` · ${item.targetWeight} kg` : ''}
                </p>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </AppShell>
  );
}
