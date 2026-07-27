import { useRef, useState, type ChangeEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Download, Upload } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { SectionCard } from '@/components/SectionCard';
import { db } from '@/db/appDb';
import {
  type DatabaseSnapshot,
  exportDatabaseSnapshot,
  parseDatabaseSnapshot,
  restoreDatabaseSnapshot,
  summarizeDatabaseSnapshot,
} from '@/lib/export';

interface PendingImportState {
  fileName: string;
  snapshot: DatabaseSnapshot;
}

export function SettingsPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingImport, setPendingImport] = useState<PendingImportState | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const settings = useLiveQuery(() => db.appSettings.get('app-settings'), []);
  const counts = useLiveQuery(async () => ({
    templates: await db.workoutTemplates.count(),
    sessions: await db.workoutSessions.count(),
    tests: await db.exerciseTests.count(),
    mediaAssets: await db.mediaAssets.count(),
  }), []);
  const pendingSummary = pendingImport ? summarizeDatabaseSnapshot(pendingImport.snapshot) : null;

  async function handleImportFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const snapshot = parseDatabaseSnapshot(await file.text());
      setPendingImport({
        fileName: file.name,
        snapshot,
      });
      setImportError(null);
      setImportSuccess(null);
    } catch (error) {
      setPendingImport(null);
      setImportSuccess(null);
      setImportError(
        error instanceof Error ? error.message : 'Die Import-Datei konnte nicht verarbeitet werden.',
      );
    } finally {
      event.target.value = '';
    }
  }

  async function handleConfirmImport() {
    if (!pendingImport) {
      return;
    }

    setIsImporting(true);

    try {
      await restoreDatabaseSnapshot(pendingImport.snapshot);
      setImportSuccess(`Import aus ${pendingImport.fileName} erfolgreich eingespielt.`);
      setImportError(null);
      setPendingImport(null);
    } catch (error) {
      setImportSuccess(null);
      setImportError(
        error instanceof Error ? error.message : 'Der Restore konnte nicht abgeschlossen werden.',
      );
    } finally {
      setIsImporting(false);
    }
  }

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

        <SectionCard title="Backup" subtitle="Export und validierter Restore laufen komplett lokal in IndexedDB.">
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

            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              onChange={handleImportFileChange}
              className="hidden"
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center justify-between rounded-3xl border border-white/10 bg-white/[0.04] px-4 py-4 text-left transition hover:border-lime-300/30 hover:bg-white/[0.07]"
            >
              <div>
                <p className="font-medium text-zinc-200">JSON-Restore auswaehlen</p>
                <p className="mt-1 text-sm text-zinc-400">
                  Liest einen Export ein, prueft das Schema und zeigt vor dem Restore eine Vorschau.
                </p>
              </div>
              <Upload size={18} className="text-zinc-500" />
            </button>

            {pendingImport && pendingSummary ? (
              <div className="rounded-3xl border border-amber-300/20 bg-amber-300/10 p-4">
                <p className="text-sm font-semibold text-amber-100">
                  Restore bereit: {pendingImport.fileName}
                </p>
                <p className="mt-1 text-sm text-amber-50/80">
                  Der Import ersetzt den aktuellen lokalen Datenbestand vollstaendig.
                </p>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-3xl bg-black/15 p-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-amber-100/60">Templates</p>
                    <p className="mt-2 text-xl font-semibold text-amber-50">{pendingSummary.templates}</p>
                  </div>
                  <div className="rounded-3xl bg-black/15 p-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-amber-100/60">Sessions</p>
                    <p className="mt-2 text-xl font-semibold text-amber-50">{pendingSummary.sessions}</p>
                  </div>
                  <div className="rounded-3xl bg-black/15 p-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-amber-100/60">Set-Logs</p>
                    <p className="mt-2 text-xl font-semibold text-amber-50">{pendingSummary.setLogs}</p>
                  </div>
                  <div className="rounded-3xl bg-black/15 p-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-amber-100/60">Tests</p>
                    <p className="mt-2 text-xl font-semibold text-amber-50">{pendingSummary.tests}</p>
                  </div>
                </div>

                <div className="mt-4 flex gap-3">
                  <button
                    type="button"
                    onClick={handleConfirmImport}
                    disabled={isImporting}
                    className="flex-1 rounded-3xl bg-lime-300 px-4 py-3 text-sm font-medium text-zinc-950 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isImporting ? 'Import laeuft...' : 'Import bestaetigen'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingImport(null)}
                    disabled={isImporting}
                    className="flex-1 rounded-3xl border border-white/10 px-4 py-3 text-sm font-medium text-zinc-200 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Abbrechen
                  </button>
                </div>
              </div>
            ) : null}

            {importSuccess ? (
              <div className="rounded-3xl border border-lime-300/20 bg-lime-300/10 px-4 py-4 text-sm text-lime-100">
                {importSuccess}
              </div>
            ) : null}

            {importError ? (
              <div className="rounded-3xl border border-rose-300/20 bg-rose-300/10 px-4 py-4 text-sm text-rose-100">
                {importError}
              </div>
            ) : null}
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
