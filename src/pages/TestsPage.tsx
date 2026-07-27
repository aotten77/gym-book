import { useLiveQuery } from 'dexie-react-hooks';
import { AppShell } from '@/components/AppShell';
import { SectionCard } from '@/components/SectionCard';
import { db } from '@/db/appDb';
import { formatDateTime } from '@/lib/format';

export function TestsPage() {
  const tests = useLiveQuery(() => db.exerciseTests.orderBy('recordedAt').reverse().toArray(), []);

  return (
    <AppShell title="Tests" eyebrow="Assessment">
      <div className="space-y-4">
        {(tests ?? []).map((test) => (
          <SectionCard
            key={test.id}
            title={test.exerciseNameSnapshot}
            subtitle={`Erfasst ${formatDateTime(test.recordedAt)}`}
          >
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-3xl bg-zinc-950/45 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Links</p>
                <p className="mt-2 text-2xl font-semibold text-zinc-50">{test.leftValue}</p>
              </div>
              <div className="rounded-3xl bg-zinc-950/45 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Rechts</p>
                <p className="mt-2 text-2xl font-semibold text-zinc-50">{test.rightValue}</p>
              </div>
              <div className="rounded-3xl bg-lime-300/10 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-lime-200/70">Asymmetrie</p>
                <p className="mt-2 text-2xl font-semibold text-lime-200">{test.asymmetryPercent}%</p>
              </div>
            </div>
            {test.notes ? <p className="mt-4 text-sm text-zinc-400">{test.notes}</p> : null}
          </SectionCard>
        ))}
      </div>
    </AppShell>
  );
}
