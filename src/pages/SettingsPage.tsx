import { useRef, useState, type ChangeEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Download, Minus, Plus, RotateCcw, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { Alert } from '@/components/Alert';
import { Button, IconButton } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SectionCard } from '@/components/SectionCard';
import { bootstrapAppData, seedSampleData } from '@/db/bootstrap';
import { formatDateTime } from '@/lib/format';
import { db } from '@/db/appDb';
import { setProgramActiveWeek } from '@/db/program-actions';
import { clearWeekOverride, setActiveProgram, setWeekOverride } from '@/db/settings-actions';
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
  const [isSavingProgram, setIsSavingProgram] = useState(false);
  const [programError, setProgramError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [isSeeding, setIsSeeding] = useState(false);
  const [seedMessage, setSeedMessage] = useState<string | null>(null);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  async function handleSeedSampleData() {
    setIsSeeding(true);

    try {
      await seedSampleData();
      setSeedMessage('Beispieldaten wurden geladen.');
      setProgramError(null);
    } catch (error) {
      setProgramError(
        error instanceof Error ? error.message : 'Beispieldaten konnten nicht geladen werden.',
      );
      setSeedMessage(null);
    } finally {
      setIsSeeding(false);
    }
  }

  async function handleResetAllData() {
    setIsResetting(true);

    try {
      // Alle Tabellen leeren statt die Datenbank zu loeschen: die
      // Schemaversion und offene Live-Queries bleiben so intakt.
      await db.transaction('rw', db.tables, async () => {
        await Promise.all(db.tables.map((table) => table.clear()));
      });
      await bootstrapAppData();
      setShowResetDialog(false);
      setSeedMessage(null);
      setProgramError(null);
    } catch (error) {
      setProgramError(error instanceof Error ? error.message : 'Zuruecksetzen fehlgeschlagen.');
      setShowResetDialog(false);
    } finally {
      setIsResetting(false);
    }
  }
  const settings = useLiveQuery(() => db.appSettings.get('app-settings'), []);
  const programs = useLiveQuery(async () => {
    const items = await db.programs.toArray();
    return items.sort((a, b) => a.name.localeCompare(b.name));
  }, []);
  const activeProgram = useLiveQuery(async () => {
    const appSettings = await db.appSettings.get('app-settings');

    if (!appSettings?.activeProgramId) {
      return undefined;
    }

    return db.programs.get(appSettings.activeProgramId);
  }, []);
  const programWeeks = useLiveQuery(async () => {
    const appSettings = await db.appSettings.get('app-settings');

    if (!appSettings?.activeProgramId) {
      return [];
    }

    const weeks = await db.programWeeks.where('programId').equals(appSettings.activeProgramId).toArray();
    return weeks.sort((left, right) => left.weekNumber - right.weekNumber);
  }, []);
  const counts = useLiveQuery(async () => ({
    exercises: await db.exercises.count(),
    templates: await db.workoutTemplates.count(),
    sessions: await db.workoutSessions.count(),
    tests: await db.exerciseTests.count(),
    mediaAssets: await db.mediaAssets.count(),
  }), []);
  const pendingSummary = pendingImport ? summarizeDatabaseSnapshot(pendingImport.snapshot) : null;
  const maxProgramWeek = Math.max(
    1,
    ...(programWeeks ?? []).map((week) => week.weekNumber),
    activeProgram?.activeWeek ?? 1,
  );
  const effectiveWeek = settings?.weekOverride ?? activeProgram?.activeWeek ?? 1;
  const effectiveWeekLabel = `W${effectiveWeek}`;

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
      // Sicherheitsnetz: der Restore leert alle Tabellen. Wer versehentlich
      // die falsche Datei waehlt, hat sonst keinen Weg zurueck.
      await exportDatabaseSnapshot();
      await restoreDatabaseSnapshot(pendingImport.snapshot);
      setImportSuccess(
        `Import aus ${pendingImport.fileName} erfolgreich eingespielt. Ein Backup des vorherigen Stands wurde heruntergeladen.`,
      );
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

  async function handleProgramChange(programId: string) {
    setIsSavingProgram(true);

    try {
      await setActiveProgram(programId);
      setProgramError(null);
    } catch (error) {
      setProgramError(error instanceof Error ? error.message : 'Programm konnte nicht gesetzt werden.');
    } finally {
      setIsSavingProgram(false);
    }
  }

  async function handleStepActiveWeek(direction: -1 | 1) {
    if (!activeProgram) {
      return;
    }

    setIsSavingProgram(true);

    try {
      const base = settings?.weekOverride ?? activeProgram.activeWeek;
      const next = Math.min(maxProgramWeek, Math.max(1, base + direction));

      if (settings?.weekOverride) {
        await setWeekOverride(next);
      } else {
        await setWeekOverride(next);
      }

      setProgramError(null);
    } catch (error) {
      setProgramError(error instanceof Error ? error.message : 'Woche konnte nicht aktualisiert werden.');
    } finally {
      setIsSavingProgram(false);
    }
  }

  async function handleResetWeekOverride() {
    setIsSavingProgram(true);

    try {
      await clearWeekOverride();
      setProgramError(null);
    } catch (error) {
      setProgramError(error instanceof Error ? error.message : 'Override konnte nicht entfernt werden.');
    } finally {
      setIsSavingProgram(false);
    }
  }

  async function handleStepProgramWeek(direction: -1 | 1) {
    if (!activeProgram) {
      return;
    }

    setIsSavingProgram(true);

    try {
      const next = Math.min(maxProgramWeek, Math.max(1, activeProgram.activeWeek + direction));
      await setProgramActiveWeek(activeProgram.id, next);
      setProgramError(null);
    } catch (error) {
      setProgramError(error instanceof Error ? error.message : 'Programm-Woche konnte nicht aktualisiert werden.');
    } finally {
      setIsSavingProgram(false);
    }
  }

  return (
    <AppShell title="Settings" eyebrow="System">
      <div className="space-y-4">
        <SectionCard title="App-Status" subtitle="Lokale Daten liegen komplett in IndexedDB.">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-panel bg-surface p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-content-muted">Programmwoche</p>
              <p className="mt-2 text-2xl font-semibold text-content">
                {effectiveWeekLabel}
              </p>
              <p className="mt-1 text-sm text-content-muted">
                {settings?.weekOverride ? 'Override aktiv' : activeProgram?.name ?? 'Kein Programm gesetzt'}
              </p>
            </div>
            <div className="rounded-panel bg-surface p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-content-muted">Export-Schema</p>
              <p className="mt-2 text-2xl font-semibold text-content">
                v{settings?.exportSchemaVersion ?? 1}
              </p>
            </div>
            <div className="rounded-panel bg-surface p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-content-muted">Sessions</p>
              <p className="mt-2 text-2xl font-semibold text-content">{counts?.sessions ?? 0}</p>
            </div>
            <div className="rounded-panel bg-surface p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-content-muted">Tests</p>
              <p className="mt-2 text-2xl font-semibold text-content">{counts?.tests ?? 0}</p>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Programm"
          subtitle="Programm-Auswahl und Week-Steuerung beeinflussen die Progression, die beim Session-Start materialisiert wird."
          action={
            <Link
              to="/programs"
              className="min-h-touch inline-flex items-center justify-center rounded-control border border-line px-3 py-2 text-sm text-content-secondary transition hover:bg-surface-raised"
            >
              Verwalten
            </Link>
          }
        >
          <div className="space-y-4">
            {(programs?.length ?? 0) > 0 ? (
              <select
                aria-label="Aktives Programm"
                value={settings?.activeProgramId ?? ''}
                onChange={(event) => handleProgramChange(event.target.value)}
                disabled={isSavingProgram}
                className="w-full rounded-panel border border-line bg-surface px-4 py-4 text-sm text-content outline-none transition focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                {programs?.map((program) => (
                  <option key={program.id} value={program.id}>
                    {program.name}
                  </option>
                ))}
              </select>
            ) : (
              <div className="rounded-panel border border-dashed border-line bg-surface px-4 py-5 text-sm text-content-muted">
                Noch kein Programm vorhanden. Lege zuerst ein Programm in der Programm-Verwaltung an.
              </div>
            )}

            <div className="rounded-panel border border-line bg-surface p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-content-muted">Aktive Woche</p>
                  <p className="mt-2 text-2xl font-semibold text-content">{effectiveWeekLabel}</p>
                  <p className="mt-1 text-sm text-content-muted">
                    {settings?.weekOverride ? 'Override' : 'Programm'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <IconButton label="Override-Woche zurueck" onClick={() => handleStepActiveWeek(-1)} disabled={!activeProgram || isSavingProgram}>
                    <Minus size={18} />
                  </IconButton>
                  <IconButton label="Override-Woche vor" onClick={() => handleStepActiveWeek(1)} disabled={!activeProgram || isSavingProgram}>
                    <Plus size={18} />
                  </IconButton>
                  <IconButton label="Wochen-Override zuruecksetzen" onClick={handleResetWeekOverride} disabled={!settings?.weekOverride || isSavingProgram}>
                    <RotateCcw size={18} />
                  </IconButton>
                </div>
              </div>
            </div>

            <div className="rounded-panel border border-line bg-surface p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-content-muted">Programm-Woche</p>
                  <p className="mt-2 text-2xl font-semibold text-content">
                    W{activeProgram?.activeWeek ?? 1}
                  </p>
                  <p className="mt-1 text-sm text-content-muted">
                    Wirkt nur, wenn keine Override-Woche aktiv ist.
                  </p>
                </div>
                <div className="flex gap-2">
                  <IconButton label="Programm-Woche zurueck" onClick={() => handleStepProgramWeek(-1)} disabled={!activeProgram || isSavingProgram}>
                    <Minus size={18} />
                  </IconButton>
                  <IconButton label="Programm-Woche vor" onClick={() => handleStepProgramWeek(1)} disabled={!activeProgram || isSavingProgram}>
                    <Plus size={18} />
                  </IconButton>
                </div>
              </div>
            </div>

            {programError ? (
              <div className="rounded-panel border border-rose-300/20 bg-rose-300/10 px-4 py-4 text-sm text-rose-100">
                {programError}
              </div>
            ) : null}
          </div>
        </SectionCard>

        <SectionCard title="Backup" subtitle="Export und validierter Restore laufen komplett lokal in IndexedDB.">
          <div className="grid gap-3">
            <button
              type="button"
              onClick={() => exportDatabaseSnapshot()}
              className="flex items-center justify-between rounded-panel bg-accent px-4 py-4 text-left text-accent-contrast transition hover:brightness-105"
            >
              <div>
                <p className="text-sm font-semibold">JSON-Export herunterladen</p>
                <p className="mt-1 text-sm text-accent-contrast/80">
                  Enthalten sind Templates, Sessions, Logs, Tests und Settings.
                </p>
              </div>
              <Download size={18} />
            </button>

            <input
              ref={fileInputRef}
              aria-label="Backup-Datei auswaehlen"
              type="file"
              accept="application/json"
              onChange={handleImportFileChange}
              className="hidden"
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center justify-between rounded-panel border border-line bg-surface-raised px-4 py-4 text-left transition hover:border-accent-border hover:bg-surface-hover"
            >
              <div>
                <p className="font-medium text-content-secondary">JSON-Restore auswaehlen</p>
                <p className="mt-1 text-sm text-content-muted">
                  Liest einen Export ein, prueft das Schema und zeigt vor dem Restore eine Vorschau.
                </p>
              </div>
              <Upload size={18} className="text-content-muted" />
            </button>

            {pendingImport && pendingSummary ? (
              <div className="rounded-panel border border-amber-300/20 bg-amber-300/10 p-4">
                <p className="text-sm font-semibold text-amber-100">
                  Restore bereit: {pendingImport.fileName}
                </p>
                <p className="mt-1 text-sm text-amber-50/80">
                  Der Import ersetzt den aktuellen lokalen Datenbestand vollstaendig. Vom bisherigen
                  Stand wird vorher automatisch ein Backup heruntergeladen.
                </p>
                {/* Das Exportdatum ist der einzige Weg zu erkennen, ob es die
                    gemeinte Datei ist. */}
                <p className="mt-2 text-sm text-amber-50/80">
                  Erstellt am {formatDateTime(pendingImport.snapshot.exportedAt)} ·{' '}
                  {pendingSummary.exercises} Uebungen · {pendingSummary.mediaAssets} Bilder
                </p>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-panel bg-black/15 p-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-amber-100/60">Templates</p>
                    <p className="mt-2 text-xl font-semibold text-amber-50">{pendingSummary.templates}</p>
                  </div>
                  <div className="rounded-panel bg-black/15 p-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-amber-100/60">Sessions</p>
                    <p className="mt-2 text-xl font-semibold text-amber-50">{pendingSummary.sessions}</p>
                  </div>
                  <div className="rounded-panel bg-black/15 p-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-amber-100/60">Set-Logs</p>
                    <p className="mt-2 text-xl font-semibold text-amber-50">{pendingSummary.setLogs}</p>
                  </div>
                  <div className="rounded-panel bg-black/15 p-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-amber-100/60">Tests</p>
                    <p className="mt-2 text-xl font-semibold text-amber-50">{pendingSummary.tests}</p>
                  </div>
                </div>

                <div className="mt-4 flex gap-3">
                  <button
                    type="button"
                    onClick={handleConfirmImport}
                    disabled={isImporting}
                    className="flex-1 rounded-panel bg-accent px-4 py-3 text-sm font-medium text-accent-contrast transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isImporting ? 'Import laeuft...' : 'Import bestaetigen'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingImport(null)}
                    disabled={isImporting}
                    className="flex-1 rounded-panel border border-line px-4 py-3 text-sm font-medium text-content-secondary transition hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Abbrechen
                  </button>
                </div>
              </div>
            ) : null}

            {importSuccess ? (
              <div className="rounded-panel border border-accent-border bg-accent-soft px-4 py-4 text-sm text-lime-100">
                {importSuccess}
              </div>
            ) : null}

            {importError ? (
              <div className="rounded-panel border border-rose-300/20 bg-rose-300/10 px-4 py-4 text-sm text-rose-100">
                {importError}
              </div>
            ) : null}
          </div>
        </SectionCard>

        <SectionCard title="Medien" subtitle="Lokale Uploads kommen auf dasselbe Persistenzmodell.">
          <p className="text-sm text-content-muted">
            Aktuell liegen {counts?.mediaAssets ?? 0} Medienobjekte in der Datenbank. Bilder bleiben lokal in
            IndexedDB und gehen mit in Export und Restore.
          </p>
        </SectionCard>

        <SectionCard
          title="Beispieldaten"
          subtitle="Ein durchgespieltes Programm zum Ausprobieren - bewusst nicht beim ersten Start."
        >
          <div className="space-y-3">
            <p className="text-sm text-content-muted">
              Legt ein Programm mit acht Wochen, drei Uebungen, einer Vorlage und einer bereits
              abgeschlossenen Session an. Nur moeglich, solange die Bibliothek leer ist.
            </p>
            <Button
              variant="ghost"
              fullWidth
              onClick={handleSeedSampleData}
              disabled={isSeeding || (counts?.exercises ?? 0) > 0}
            >
              {isSeeding ? 'Wird geladen...' : 'Beispieldaten laden'}
            </Button>
            {seedMessage ? <Alert variant="success">{seedMessage}</Alert> : null}
          </div>
        </SectionCard>

        <SectionCard
          title="Alle Daten loeschen"
          subtitle="Setzt die App auf den Auslieferungszustand zurueck."
        >
          <div className="space-y-3">
            <p className="text-sm text-content-muted">
              Entfernt Programme, Vorlagen, Uebungen, Sessions, Tests und Bilder aus IndexedDB.
              Exportiere vorher ein Backup, wenn du die Daten behalten willst.
            </p>
            <Button variant="danger" fullWidth onClick={() => setShowResetDialog(true)}>
              Lokale Daten loeschen
            </Button>
          </div>
        </SectionCard>
      </div>

      <ConfirmDialog
        open={showResetDialog}
        title="Wirklich alle Daten loeschen?"
        description="Saemtliche Programme, Vorlagen, Uebungen, Sessions, Tests und Bilder werden aus dieser Installation entfernt. Ohne Backup laesst sich das nicht rueckgaengig machen."
        confirmLabel="Alles loeschen"
        busy={isResetting}
        onConfirm={handleResetAllData}
        onCancel={() => setShowResetDialog(false)}
      />
    </AppShell>
  );
}
