import { useLiveQuery } from 'dexie-react-hooks';
import { Download, Upload } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { SectionCard } from '@/components/SectionCard';
import { db } from '@/db/appDb';
import { exportDatabaseSnapshot } from '@/lib/export';

export function SettingsPage() {
  const settings = useLiveQuery(() => db.appSettings.get('app-settings'), []);
  const counts = useLiveQuery(async () => ({
    templates: await db.workoutTemplates.count(),
    sessions: await db.workoutSessions.count(),
    tests: await db.exerciseTests.count(),
    mediaAssets: await db.mediaAssets.count(),
  }), []);

  return (
    <AppShell title="Settings" eyebrow="System">
      <div className="space-y-4">
        <SectionCard title="App-Status" subtitle="Lokale Daten liegen komplett in IndexedDB.">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-3xl bg-zinc-950/45 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Programmwoche</p>
              <p className="mt-2 text-2xl font-semibold text-zinc-50">
                {settings?.weekOverride ?? 'auto'}
              </p>
            </div>
            <div className="rounded-3xl bg-zinc-950/45 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Export-Schema</p>
              <p className="mt-2 text-2xl font-semibold text-zinc-50">
                v{settings?.exportSchemaVersion ?? 1}
              </p>
            </div>
            <div className="rounded-3xl bg-zinc-950/45 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Sessions</p>
              <p className="mt-2 text-2xl font-semibold text-zinc-50">{counts?.sessions ?? 0}</p>
            </div>
            <div className="rounded-3xl bg-zinc-950/45 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Tests</p>
              <p className="mt-2 text-2xl font-semibold text-zinc-50">{counts?.tests ?? 0}</p>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Backup" subtitle="Export ist bereits aktiv, Import folgt in der naechsten Runde.">
          <div className="grid gap-3">
            <button
              type="button"
              onClick={() => exportDatabaseSnapshot()}
              className="flex items-center justify-between rounded-3xl bg-lime-300 px-4 py-4 text-left text-zinc-950 transition hover:brightness-105"
            >
              <div>
                <p className="text-sm font-semibold">JSON-Export herunterladen</p>
                <p className="mt-1 text-sm text-zinc-700">
                  Enthalten sind Templates, Sessions, Logs, Tests und Settings.
                </p>
              </div>
              <Download size={18} />
            </button>

            <div className="flex items-center justify-between rounded-3xl border border-dashed border-white/10 bg-zinc-950/35 px-4 py-4 text-sm text-zinc-400">
              <div>
                <p className="font-medium text-zinc-200">Import vorbereiten</p>
                <p className="mt-1">Validierter Restore mit Medien-Pruefung ist als naechster Baustein vorgesehen.</p>
              </div>
              <Upload size={18} className="text-zinc-500" />
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Medien" subtitle="Lokale Uploads kommen auf dasselbe Persistenzmodell.">
          <p className="text-sm text-zinc-400">
            Aktuell liegen {counts?.mediaAssets ?? 0} Medienobjekte in der Datenbank. Der Upload-Flow selbst ist der
            naechste logische Schritt auf dieser Basis.
          </p>
        </SectionCard>
      </div>
    </AppShell>
  );
}
