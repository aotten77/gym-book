import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { LibraryImportSection } from '@/components/LibraryImportSection';
import { SectionCard } from '@/components/SectionCard';
import { Button } from '@/components/ui/Button';
import { DoneRow } from '@/components/ui/StatusCard';
import { db } from '@/db/appDb';
import { loadSyncActivitySince } from '@/db/history-queries';
import { listLibraryImports } from '@/db/library-import-actions';
import { describeSyncStatus } from '@/domain/sync-status';
import { copyAnalysisSnapshot, exportAnalysisSnapshot } from '@/lib/export';
import { formatDateTime, formatNumber, formatShortDate } from '@/lib/format';

function describeImportCounts(log: {
  createdExercises: number;
  updatedExercises: number;
  createdTemplates: number;
  updatedTemplates: number;
  createdAssignments: number;
  updatedAssignments: number;
  createdPlanEntries?: number;
  updatedPlanEntries?: number;
}) {
  const workouts = log.createdTemplates + log.updatedTemplates;
  const exercises = log.createdExercises + log.updatedExercises;
  const assignments = log.createdAssignments + log.updatedAssignments;
  const entries = (log.createdPlanEntries ?? 0) + (log.updatedPlanEntries ?? 0);
  const parts: string[] = [];

  if (workouts > 0) {
    parts.push(`${formatNumber(workouts)} ${workouts === 1 ? 'Workout' : 'Workouts'}`);
  }

  if (exercises > 0) {
    parts.push(`${formatNumber(exercises)} ${exercises === 1 ? 'Übung' : 'Übungen'}`);
  }

  if (assignments > 0) {
    parts.push(`${formatNumber(assignments)} ${assignments === 1 ? 'Zuordnung' : 'Zuordnungen'}`);
  }

  if (entries > 0) {
    parts.push(`${formatNumber(entries)} ${entries === 1 ? 'Termin' : 'Termine'}`);
  }

  return parts.length > 0 ? parts.join(', ') : 'keine Änderungen';
}

/**
 * Der Abgleich mit dem claude.ai-Projekt: von dort kommt das Import-JSON, dorthin
 * geht der Stand per "Analyse kopieren". Ein Tap, dann einfügen - deshalb ein
 * eigener Ort statt zweier Knöpfe tief in den Einstellungen. Die Seite liest
 * nur; geschrieben wird über `copyAnalysisSnapshot` und den Import.
 */
export function SyncPage() {
  const [isCopying, setIsCopying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const settings = useLiveQuery(() => db.appSettings.get('app-settings'), []);
  const lastCopiedAt = settings?.lastAnalysisCopiedAt;
  const activity = useLiveQuery(() => loadSyncActivitySince(lastCopiedAt), [lastCopiedAt]);
  const imports = useLiveQuery(() => listLibraryImports(5), []);

  const status = describeSyncStatus({
    lastCopiedAt,
    sessionsCompletedAt: activity?.sessionsCompletedAt ?? [],
    runDates: activity?.runDates ?? [],
    testRecordedAt: activity?.testRecordedAt ?? [],
  });
  const subtitle = lastCopiedAt
    ? `Zuletzt kopiert am ${formatDateTime(lastCopiedAt)}. ${status.text}`
    : status.text;

  /*
   * Bewusst ohne `async`/`await` vor dem Aufruf: WebKit gibt die
   * Zwischenablage nur innerhalb der Nutzergeste frei, und ein `await` davor
   * beendet sie. Die ausführliche Begründung steht an `copyAnalysisSnapshot`.
   * Das `setIsCopying(true)` ist synchron und deshalb unkritisch.
   */
  function handleCopyAnalysis() {
    setIsCopying(true);

    copyAnalysisSnapshot()
      .then(() => {
        setMessage('Analyse kopiert - jetzt im Gespräch einfügen.');
      })
      .catch((error: unknown) => {
        setMessage(
          error instanceof Error
            ? error.message
            : 'Kopieren in die Zwischenablage fehlgeschlagen.',
        );
      })
      .finally(() => {
        setIsCopying(false);
      });
  }

  /*
   * Der Analyse-Export ist keine Sicherung: er lässt Bilder, Ids und alles
   * Unfertige weg und fasst deshalb `lastBackupAt` nicht an.
   */
  async function handleShareZip() {
    setIsExporting(true);

    try {
      const result = await exportAnalysisSnapshot({ preferShare: true });
      setMessage(result === 'cancelled' ? 'Analyse-Export abgebrochen.' : 'Analyse-Export erstellt.');
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Analyse-Export konnte nicht erstellt werden.',
      );
    } finally {
      setIsExporting(false);
    }
  }

  const [latestImport, ...olderImports] = imports ?? [];

  return (
    <AppShell title="Abgleich">
      <div className="space-y-4">
        <SectionCard title="Stand an Claude senden" subtitle={subtitle}>
          <div className="space-y-3">
            <Button variant="primary" fullWidth onClick={handleCopyAnalysis} disabled={isCopying}>
              {isCopying ? 'Wird kopiert...' : 'Analyse kopieren'}
            </Button>

            {message ? (
              <div
                role="status"
                className="rounded-panel border border-line bg-surface px-4 py-3 text-sm text-content-secondary"
              >
                {message}
              </div>
            ) : null}

            <Button variant="ghost" fullWidth onClick={() => void handleShareZip()} disabled={isExporting}>
              {isExporting ? 'ZIP wird erstellt...' : 'Als ZIP teilen'}
            </Button>
          </div>
        </SectionCard>

        <LibraryImportSection />

        {latestImport ? (
          <section className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-content-muted">
              Letzte Importe
            </h2>
            <DoneRow
              icon={<Check size={16} aria-hidden />}
              title={`${formatShortDate(new Date(latestImport.importedAt))} · ${describeImportCounts(latestImport)}`}
            />
            {olderImports.map((log) => (
              <div
                key={log.id}
                className="flex items-center justify-between gap-3 rounded-panel border border-line bg-surface px-4 py-3 text-sm"
              >
                <span className="min-w-0 truncate">{formatShortDate(new Date(log.importedAt))}</span>
                <span className="shrink-0 text-xs text-content-muted">{describeImportCounts(log)}</span>
              </div>
            ))}
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}
