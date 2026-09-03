import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ClipboardCopy,
  Download,
  FileSpreadsheet,
  HardDrive,
  Megaphone,
  Upload,
  Volume2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { Alert } from '@/components/Alert';
import { BandLevelsSection } from '@/components/BandLevelsSection';
import { LibraryImportSection } from '@/components/LibraryImportSection';
import { Button } from '@/components/ui/Button';
import { TextField, ToggleField } from '@/components/ui/Field';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SectionCard } from '@/components/SectionCard';
import { WeekStepper } from '@/components/WeekStepper';
import { bootstrapAppData, seedSampleData } from '@/db/bootstrap';
import { formatDateTime, formatNumber } from '@/lib/format';
import { playTimerChimeFromGesture, primeTimerSound } from '@/lib/sound';
import { isTimerSpeechSupported, speakTimerAnnouncementFromGesture } from '@/lib/speech';
import { formatBytes, readStorageStatus, requestPersistentStorage, type StorageStatus } from '@/lib/storage';
import { isScreenWakeLockSupported } from '@/lib/wake-lock';
import { db } from '@/db/appDb';
import {
  applyNordicCurlTrackingFix,
  applyProgramWeekFix,
  describeDataFixes,
  NORDIC_CURL_NAME,
} from '@/db/data-fix-actions';
import { setProgramActiveWeek, setProgramStartDate } from '@/db/program-actions';
import {
  clearWeekOverride,
  setActiveProgram,
  setKeepScreenAwakeEnabled,
  setTimerSoundEnabled,
  setWeekOverride,
} from '@/db/settings-actions';
import { resolveWeekControl, suggestProgramStart } from '@/domain/program';
import {
  SET_TIMER_FINAL_CUE_MIN_SECONDS,
  SET_TIMER_HALF_CUE_MIN_SECONDS,
  setTimerCueSpeech,
  setTimerCueVibrationPattern,
} from '@/domain/set-timer-cues';
import {
  copyAnalysisSnapshot,
  type DatabaseSnapshot,
  exportAnalysisSnapshot,
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
  const [storageStatus, setStorageStatus] = useState<StorageStatus | null>(null);
  const [isRequestingPersistence, setIsRequestingPersistence] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [isExportingAnalysis, setIsExportingAnalysis] = useState(false);
  const [isCopyingAnalysis, setIsCopyingAnalysis] = useState(false);
  const [analysisMessage, setAnalysisMessage] = useState<string | null>(null);
  const [soundError, setSoundError] = useState<string | null>(null);
  const [screenAwakeError, setScreenAwakeError] = useState<string | null>(null);
  const [showNordicFixDialog, setShowNordicFixDialog] = useState(false);
  const [showWeekFixDialog, setShowWeekFixDialog] = useState(false);
  const [weekFixDate, setWeekFixDate] = useState('');
  const [dataFixMessage, setDataFixMessage] = useState<string | null>(null);
  const [dataFixError, setDataFixError] = useState<string | null>(null);
  const [isFixing, setIsFixing] = useState(false);

  const refreshStorageStatus = useCallback(async () => {
    setStorageStatus(await readStorageStatus());
  }, []);

  useEffect(() => {
    void refreshStorageStatus();
  }, [refreshStorageStatus]);

  async function handleRequestPersistence() {
    setIsRequestingPersistence(true);

    try {
      await requestPersistentStorage();
      await refreshStorageStatus();
    } finally {
      setIsRequestingPersistence(false);
    }
  }

  async function handleExport() {
    setIsExporting(true);

    try {
      const result = await exportDatabaseSnapshot({ preferShare: true });
      setExportMessage(
        result === 'cancelled'
          ? 'Sicherung abgebrochen - es wurde nichts gespeichert.'
          : 'Sicherung erstellt.',
      );
      await refreshStorageStatus();
    } catch (error) {
      setExportMessage(
        error instanceof Error ? error.message : 'Sicherung konnte nicht erstellt werden.',
      );
    } finally {
      setIsExporting(false);
    }
  }

  /*
   * Der Analyse-Export ist keine Sicherung: er lässt Bilder, Ids und alles
   * Unfertige weg. Deshalb fasst er `lastBackupAt` nicht an - und deshalb wird
   * hier auch nicht der Speicherstatus neu gelesen wie beim Backup.
   */
  async function handleAnalysisExport() {
    setIsExportingAnalysis(true);

    try {
      const result = await exportAnalysisSnapshot({ preferShare: true });
      setAnalysisMessage(
        result === 'cancelled'
          ? 'Analyse-Export abgebrochen.'
          : 'Analyse-Export erstellt (sessions.csv, progression.csv, tests.csv, meta.json).',
      );
    } catch (error) {
      setAnalysisMessage(
        error instanceof Error ? error.message : 'Analyse-Export konnte nicht erstellt werden.',
      );
    } finally {
      setIsExportingAnalysis(false);
    }
  }

  /*
   * Bewusst ohne `async`/`await` vor dem Aufruf: WebKit gibt die
   * Zwischenablage nur innerhalb der Nutzergeste frei, und ein `await` davor
   * beendet sie. Die ausführliche Begründung steht an `copyAnalysisSnapshot`.
   * Das `setIsCopyingAnalysis(true)` ist synchron und deshalb unkritisch.
   */
  function handleCopyAnalysis() {
    setIsCopyingAnalysis(true);

    copyAnalysisSnapshot()
      .then(() => {
        setAnalysisMessage('Analyse kopiert - jetzt im Gespräch einfügen.');
      })
      .catch((error: unknown) => {
        setAnalysisMessage(
          error instanceof Error
            ? error.message
            : 'Kopieren in die Zwischenablage fehlgeschlagen.',
        );
      })
      .finally(() => {
        setIsCopyingAnalysis(false);
      });
  }

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
      // Alle Tabellen leeren statt die Datenbank zu löschen: die
      // Schemaversion und offene Live-Queries bleiben so intakt.
      await db.transaction('rw', db.tables, async () => {
        await Promise.all(db.tables.map((table) => table.clear()));
      });
      await bootstrapAppData();
      setShowResetDialog(false);
      setSeedMessage(null);
      setProgramError(null);
    } catch (error) {
      setProgramError(error instanceof Error ? error.message : 'Zurücksetzen fehlgeschlagen.');
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
  /*
   * Der Status der Datenkorrekturen kommt aus dem Bestand, nicht aus einem
   * gespeicherten Häkchen: nach dem Restore einer alten Sicherung ist eine
   * Korrektur wieder fällig, und ein "schon erledigt" würde dann lügen. Die
   * Live-Query hält ihn nebenbei aktuell, sobald eine Korrektur gelaufen ist.
   */
  const dataFixes = useLiveQuery(() => describeDataFixes(), []);
  const pendingSummary = pendingImport ? summarizeDatabaseSnapshot(pendingImport.snapshot) : null;
  const weekControl = resolveWeekControl(settings?.weekOverride, activeProgram, programWeeks ?? []);
  const effectiveWeekLabel = `W${weekControl.effectiveWeek}`;
  const isManualWeek = weekControl.mode === 'override';

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
      // die falsche Datei wählt, hat sonst keinen Weg zurück.
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
      const next = Math.min(weekControl.maxWeek, Math.max(1, weekControl.effectiveWeek + direction));
      await setWeekOverride(next);
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
      const next = Math.min(weekControl.maxWeek, Math.max(1, activeProgram.activeWeek + direction));
      await setProgramActiveWeek(activeProgram.id, next);
      setProgramError(null);
    } catch (error) {
      setProgramError(error instanceof Error ? error.message : 'Programm-Woche konnte nicht aktualisiert werden.');
    } finally {
      setIsSavingProgram(false);
    }
  }

  async function handleStartDateChange(startedOn: string) {
    if (!activeProgram) {
      return;
    }

    setIsSavingProgram(true);

    try {
      await setProgramStartDate(activeProgram.id, startedOn);
      setProgramError(null);
    } catch (error) {
      setProgramError(
        error instanceof Error ? error.message : 'Startdatum konnte nicht gespeichert werden.',
      );
    } finally {
      setIsSavingProgram(false);
    }
  }

  /**
   * Der Schalter zwischen abgeleiteter und von Hand gesetzter Woche.
   *
   * Eingeschaltet friert er die gerade wirksame Woche ein - das ist die
   * einzige Zahl, die der Nutzer in dem Moment gemeint haben kann. Vorher
   * entstand ein Override als Nebenwirkung jedes Tipps auf die Pfeile, und
   * genau so blieb er unbemerkt für Wochen stehen.
   */
  async function handleToggleManualWeek(manual: boolean) {
    setIsSavingProgram(true);

    try {
      await (manual ? setWeekOverride(weekControl.effectiveWeek) : clearWeekOverride());
      setProgramError(null);
    } catch (error) {
      setProgramError(error instanceof Error ? error.message : 'Woche konnte nicht umgestellt werden.');
    } finally {
      setIsSavingProgram(false);
    }
  }

  async function runDataFix(action: () => Promise<string>) {
    setIsFixing(true);

    try {
      setDataFixMessage(await action());
      setDataFixError(null);
    } catch (error) {
      setDataFixMessage(null);
      setDataFixError(error instanceof Error ? error.message : 'Korrektur fehlgeschlagen.');
    } finally {
      setIsFixing(false);
      setShowNordicFixDialog(false);
      setShowWeekFixDialog(false);
    }
  }

  async function handleToggleTimerSound(enabled: boolean) {
    /*
     * Noch innerhalb der Geste freischalten: nach dem `await` unten wäre der
     * Kontext für den Browser kein Ergebnis einer Berührung mehr.
     */
    if (enabled) {
      primeTimerSound();
    }

    try {
      await setTimerSoundEnabled(enabled);
      setSoundError(null);
    } catch (error) {
      setSoundError(
        error instanceof Error ? error.message : 'Einstellung konnte nicht gespeichert werden.',
      );
    }
  }

  function handleTestSetTimerCue() {
    // Spüren und hören, was der Satz später tut - deshalb beide Kanäle.
    if (typeof navigator.vibrate === 'function') {
      navigator.vibrate(setTimerCueVibrationPattern('half'));
    }

    speakTimerAnnouncementFromGesture(setTimerCueSpeech('half'));
  }

  async function handleToggleKeepScreenAwake(enabled: boolean) {
    try {
      await setKeepScreenAwakeEnabled(enabled);
      setScreenAwakeError(null);
    } catch (error) {
      setScreenAwakeError(
        error instanceof Error ? error.message : 'Einstellung konnte nicht gespeichert werden.',
      );
    }
  }

  return (
    <AppShell title="Einstellungen">
      <div className="space-y-4">
        <SectionCard title="App-Status" subtitle="Alle Daten liegen ausschließlich auf diesem Gerät.">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-panel bg-surface p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-content-muted">Programmwoche</p>
              <p className="mt-2 text-2xl font-semibold text-content">
                {effectiveWeekLabel}
              </p>
              <p className="mt-1 text-sm text-content-muted">
                {weekControl.mode === 'override'
                  ? 'Von Hand gesetzt'
                  : weekControl.mode === 'derived'
                    ? 'Läuft mit dem Kalender'
                    : activeProgram?.name ?? 'Kein Programm gesetzt'}
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
          subtitle="Programm und aktive Woche bestimmen die Zielwerte, mit denen ein Training startet."
          action={
            <Link
              to="/programs/manage"
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
                className="select-control min-h-touch w-full rounded-panel border border-line bg-surface px-4 py-4 text-base text-content outline-none transition focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
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

            {/*
              Das Startdatum ist die eigentliche Antwort auf "welche Woche ist
              gerade": von hier zählt die Programmwoche mit dem Kalender weiter,
              ohne dass jemand etwas weiterschalten muss.
            */}
            <TextField
              label="Programmstart"
              type="date"
              hint={
                activeProgram?.startedOn
                  ? `Woche ${formatNumber(weekControl.derivedWeek ?? 1)} läuft - gezählt ab dem Montag dieser Woche.`
                  : 'Ohne Startdatum bleibt es bei der Programm-Woche, die du von Hand weiterschaltest.'
              }
              value={activeProgram?.startedOn ?? ''}
              onChange={(event) => void handleStartDateChange(event.target.value)}
              disabled={!activeProgram || isSavingProgram}
            />

            <ToggleField
              label="Woche von Hand setzen"
              hint="Aus: die Woche läuft mit dem Kalender. An: die eingestellte Woche gilt, bis du sie zurücknimmst."
              checked={isManualWeek}
              onCheckedChange={(manual) => void handleToggleManualWeek(manual)}
              disabled={!activeProgram || isSavingProgram}
            />

            {isManualWeek ? (
              <WeekStepper
                label="Aktive Woche"
                week={weekControl.effectiveWeek}
                hint={
                  <p className="mt-1 text-sm text-content-muted">
                    Override
                    {weekControl.derivedWeek
                      ? ` · nach Kalender wäre es W${weekControl.derivedWeek}`
                      : ''}
                  </p>
                }
                backLabel="Override-Woche zurück"
                forwardLabel="Override-Woche vor"
                onStepBack={() => handleStepActiveWeek(-1)}
                onStepForward={() => handleStepActiveWeek(1)}
                disabled={!activeProgram || isSavingProgram}
                onReset={handleResetWeekOverride}
                resetLabel="Wochen-Override zurücksetzen"
                resetDisabled={!settings?.weekOverride || isSavingProgram}
              />
            ) : (
              <div className="rounded-panel border border-line bg-surface p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-content-muted">Aktive Woche</p>
                <p className="mt-2 text-2xl font-semibold text-content">{effectiveWeekLabel}</p>
                <p className="mt-1 text-sm text-content-muted">
                  {weekControl.mode === 'derived' ? 'Läuft mit dem Kalender' : 'Programm-Woche'}
                </p>
              </div>
            )}

            {/*
              Bleibt auch mit Startdatum bedienbar: sie ist die Zahl, die ohne
              Datum gilt, und sie steht in den Programmdaten - nicht in den
              Einstellungen dieses Geräts.
            */}
            <WeekStepper
              label="Programm-Woche"
              week={activeProgram?.activeWeek ?? 1}
              hint={
                <p className="mt-1 text-sm text-content-muted">
                  {activeProgram?.startedOn
                    ? 'Wirkt nur ohne Startdatum und ohne Override.'
                    : 'Wirkt, solange keine Woche von Hand gesetzt ist.'}
                </p>
              }
              backLabel="Programm-Woche zurück"
              forwardLabel="Programm-Woche vor"
              onStepBack={() => handleStepProgramWeek(-1)}
              onStepForward={() => handleStepProgramWeek(1)}
              disabled={!activeProgram || isSavingProgram}
            />

            {programError ? (
              <div className="rounded-panel border border-danger-border bg-danger-soft px-4 py-4 text-sm text-danger">
                {programError}
              </div>
            ) : null}
          </div>
        </SectionCard>

        <SectionCard
          title="Signale"
          subtitle="Womit sich Pausen- und Satz-Timer melden - beim Ablauf und, bei Sätzen auf Zeit, schon vorher."
        >
          <div className="space-y-4">
            <ToggleField
              label="Ton beim Ablauf der Timer"
              hint="Zusätzlich zur Vibration. Steht das iPhone auf lautlos, bleibt der Ton aus - die Vibration nicht."
              checked={settings?.timerSoundEnabled !== false}
              onCheckedChange={(enabled) => void handleToggleTimerSound(enabled)}
            />

            <p className="text-sm text-content-muted">
              Gemeldet wird nur, was gerade abläuft. Lag die App länger im
              Hintergrund, bleibt der Ton beim Zurückwechseln aus - dort wäre er
              kein Hinweis mehr.
            </p>

            <Button
              type="button"
              variant="secondary"
              onClick={() => void playTimerChimeFromGesture()}
              disabled={settings?.timerSoundEnabled === false}
            >
              <Volume2 size={18} />
              Ton testen
            </Button>

            {soundError ? <Alert variant="error">{soundError}</Alert> : null}

            {/*
              Hier steht bewusst kein Schalter für die Zwischenansagen: ob
              gesprochen werden soll, entscheidet sich im Satz, am zweiten
              Startknopf. Eine Voreinstellung hier änderte still, was der
              gewöhnliche Startknopf tut. Die Probe bleibt trotzdem, denn "kann
              dieses Gerät überhaupt vorlesen" fragt man vor dem ersten Satz.
            */}
            <p className="text-sm text-content-muted">
              {isTimerSpeechSupported()
                ? `Sätze auf Zeit lassen sich still starten oder mit gesprochenen Ansagen - dafür steht neben dem Startknopf ein zweiter mit einem Megafon. Angesagt werden die Halbzeit (ab ${SET_TIMER_HALF_CUE_MIN_SECONDS} Sekunden), die letzten zehn (ab ${SET_TIMER_FINAL_CUE_MIN_SECONDS}) - sonst lägen beide Ansagen fast aufeinander - und das Ende, kurz nach dem Ton.`
                : 'Dieses Gerät kann nichts vorlesen - der Knopf für Ansagen bleibt im Satz deshalb abgeblendet.'}
            </p>

            <Button
              type="button"
              variant="secondary"
              onClick={handleTestSetTimerCue}
              disabled={!isTimerSpeechSupported()}
            >
              <Megaphone size={18} />
              Ansage testen
            </Button>
          </div>
        </SectionCard>

        <SectionCard
          title="Bildschirm"
          subtitle="Was passiert, während eine Einheit läuft."
        >
          <div className="space-y-4">
            <ToggleField
              label="Bildschirm während der Einheit anlassen"
              hint="Verhindert, dass das iPhone mitten in einem Satz auf Zeit abschaltet. Zum Sperren zwischendurch reicht die Seitentaste - nach dem Entsperren gilt die Einstellung wieder."
              checked={settings?.keepScreenAwakeEnabled !== false}
              onCheckedChange={(enabled) => void handleToggleKeepScreenAwake(enabled)}
              disabled={!isScreenWakeLockSupported()}
            />

            <p className="text-sm text-content-muted">
              {isScreenWakeLockSupported()
                ? 'Ein abgeschaltetes Display friert die App ein: Timer melden sich dann erst beim Entsperren, und der Ton bleibt aus. Die Sperre endet mit der Einheit.'
                : 'Dieses Gerät kennt die nötige Schnittstelle nicht - unter iOS gibt es sie ab Version 16.4.'}
            </p>

            {screenAwakeError ? <Alert variant="error">{screenAwakeError}</Alert> : null}
          </div>
        </SectionCard>

        {/*
          Sichtbar machen, was sonst unsichtbar schiefgeht: ohne dauerhaften
          Speicher darf der Browser die Datenbank räumen. Gegen das Löschen
          der Homescreen-App hilft allerdings auch das nicht - nur eine
          Sicherung.
        */}
        <SectionCard
          title="Speicher"
          subtitle="Alle Trainingsdaten liegen ausschließlich auf diesem Gerät."
        >
          <div className="grid gap-3">
            <div className="flex items-start gap-3 rounded-panel bg-surface p-4">
              <HardDrive size={18} className="mt-0.5 shrink-0 text-content-muted" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-content">
                  {!storageStatus?.supported
                    ? 'Speicherstatus nicht verfügbar'
                    : storageStatus.persisted
                      ? 'Dauerhaft gesichert'
                      : 'Nicht als dauerhaft markiert'}
                </p>
                <p className="mt-1 text-sm text-content-muted">
                  {!storageStatus?.supported
                    ? 'Dieser Browser gibt keine Auskunft über seinen Speicher.'
                    : storageStatus.persisted
                      ? 'Der Browser räumt die Datenbank nicht von sich aus weg.'
                      : 'Der Browser darf die Datenbank bei Speicherdruck entfernen.'}
                </p>
                {storageStatus?.supported ? (
                  <p className="mt-1 text-sm text-content-muted">
                    Belegt: {formatBytes(storageStatus.usageBytes)} von{' '}
                    {formatBytes(storageStatus.quotaBytes)}
                  </p>
                ) : null}
              </div>
            </div>

            {storageStatus?.supported && !storageStatus.persisted ? (
              <Button
                variant="ghost"
                onClick={() => void handleRequestPersistence()}
                disabled={isRequestingPersistence}
              >
                {isRequestingPersistence ? 'Wird angefragt...' : 'Dauerhaften Speicher anfordern'}
              </Button>
            ) : null}

            <p className="rounded-panel border border-line bg-surface px-4 py-3 text-sm text-content-muted">
              Wichtig: Löschst du die App vom Homescreen, entfernt iOS auch ihre Daten. Davor
              schützt nur eine Sicherung.
            </p>
          </div>
        </SectionCard>

        <BandLevelsSection />

        <LibraryImportSection />

        {/*
          Korrekturen an Daten, die schon auf dem Gerät liegen. Bewusst keine
          Automatik beim Start: beide deuten Trainingsdaten um, und das gehört
          bestätigt. Erledigt ist erledigt - die Knöpfe blenden sich ab, sobald
          im Bestand nichts mehr zu tun ist.
        */}
        <SectionCard
          title="Datenkorrekturen"
          subtitle="Einmalige Eingriffe in vorhandene Daten - jeder mit Rückfrage."
        >
          <div className="space-y-4">
            <div className="rounded-panel border border-line bg-surface p-4">
              <p className="font-medium text-content">{NORDIC_CURL_NAME} auf Wiederholungen</p>
              <p className="mt-1 text-sm text-content-muted">
                Als Zeitübung belohnt die Erfassung statisches Halten - gezählt werden sollen
                saubere Wiederholungen. Bereits geloggte Sekunden bleiben erhalten und stehen in
                der Übungsansicht als Altdaten.
              </p>
              <p className="mt-2 text-sm text-content-muted">
                {dataFixes === undefined
                  ? 'Wird geprüft...'
                  : dataFixes.nordicCurlOnTime > 0
                    ? `${formatNumber(dataFixes.nordicCurlOnTime)} Übung wird noch auf Zeit erfasst · ${formatNumber(dataFixes.nordicCurlSecondsLogs)} Sätze mit Sekunden.`
                    : 'Nichts zu tun - die Übung wird nicht (mehr) auf Zeit erfasst.'}
              </p>
              <Button
                variant="ghost"
                fullWidth
                className="mt-3"
                disabled={isFixing || !dataFixes?.nordicCurlOnTime}
                onClick={() => setShowNordicFixDialog(true)}
              >
                Erfassung umstellen
              </Button>
            </div>

            <div className="rounded-panel border border-line bg-surface p-4">
              <p className="font-medium text-content">Programmwoche aus dem Startdatum</p>
              <p className="mt-1 text-sm text-content-muted">
                Eine von Hand gesetzte Woche gilt, bis sie zurückgenommen wird - steht sie auf 1,
                startet jede Einheit als Woche 1 und die wochenabhängigen Vorgaben greifen nie.
                Diese Korrektur setzt das Startdatum und nimmt die Übersteuerung zurück.
              </p>
              <p className="mt-2 text-sm text-content-muted">
                {dataFixes === undefined
                  ? 'Wird geprüft...'
                  : !dataFixes.activeProgramId
                    ? 'Kein aktives Programm - erst eines auswählen.'
                    : dataFixes.hasWeekOverride
                      ? `Aktuell fest auf W${formatNumber(dataFixes.weekOverride ?? 1)}.`
                      : 'Nichts zu tun - es ist keine Woche von Hand gesetzt.'}
              </p>
              <Button
                variant="ghost"
                fullWidth
                className="mt-3"
                disabled={isFixing || !dataFixes?.activeProgramId || !dataFixes.hasWeekOverride}
                onClick={() => {
                  setWeekFixDate(
                    dataFixes?.activeProgramStartedOn ??
                      (activeProgram ? suggestProgramStart(activeProgram) : ''),
                  );
                  setShowWeekFixDialog(true);
                }}
              >
                Startdatum setzen
              </Button>
            </div>

            {dataFixMessage ? <Alert variant="success">{dataFixMessage}</Alert> : null}
            {dataFixError ? <Alert variant="error">{dataFixError}</Alert> : null}
          </div>
        </SectionCard>

        <SectionCard title="Backup" subtitle="Sichern und Wiederherstellen laufen vollständig auf diesem Gerät.">
          <div className="grid gap-3">
            <div className="rounded-panel bg-surface p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-content-muted">Letzte Sicherung</p>
              <p className="mt-2 text-sm text-content">
                {settings?.lastBackupAt ? formatDateTime(settings.lastBackupAt) : 'Noch nie gesichert'}
              </p>
            </div>

            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={isExporting}
              className="flex items-center justify-between rounded-panel bg-accent px-4 py-4 text-left text-accent-contrast transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <div>
                <p className="text-sm font-semibold">
                  {isExporting ? 'Sicherung läuft...' : 'Sicherung erstellen'}
                </p>
                <p className="mt-1 text-sm text-accent-contrast/80">
                  Über das Teilen-Menü in Dateien oder iCloud ablegen. Enthalten sind Templates,
                  Sessions, Logs, Tests und Settings.
                </p>
              </div>
              <Download size={18} />
            </button>

            {exportMessage ? (
              <div className="rounded-panel border border-line bg-surface px-4 py-3 text-sm text-content-secondary">
                {exportMessage}
              </div>
            ) : null}

            {/* Steht neben der Sicherung und sieht bewusst anders aus: die
                Sicherung ist die Aktion dieser Karte und behält die eine
                Akzentfläche. */}
            <button
              type="button"
              onClick={() => void handleAnalysisExport()}
              disabled={isExportingAnalysis}
              className="flex items-center justify-between rounded-panel border border-line bg-surface-raised px-4 py-4 text-left transition hover:border-accent-border hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              <div>
                <p className="font-medium text-content-secondary">
                  {isExportingAnalysis ? 'Analyse-Export läuft...' : 'Analyse-Export'}
                </p>
                <p className="mt-1 text-sm text-content-muted">
                  Ein ZIP mit vier kleinen Dateien zum Auswerten: eine Zeile je Einheit, Übung und
                  Seite, dazu die Tests. Ohne Bilder, ohne Ids, ohne leere Sätze - und deshalb{' '}
                  <span className="font-medium">keine Sicherung</span>.
                </p>
              </div>
              <FileSpreadsheet size={18} className="text-content-muted" />
            </button>

            {/* Derselbe Inhalt, kürzerer Weg. Auf dem Telefon ist das Archiv
                der Umweg - sichern, App wechseln, Anhang suchen -, und ein ZIP
                wird am anderen Ende oft nicht ausgepackt. Das Gegenstück sitzt
                im Bibliotheks-Import, der neben dem Dateipicker längst ein
                Textfeld hat. */}
            <button
              type="button"
              onClick={handleCopyAnalysis}
              disabled={isCopyingAnalysis}
              className="flex items-center justify-between rounded-panel border border-line bg-surface-raised px-4 py-4 text-left transition hover:border-accent-border hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              <div>
                <p className="font-medium text-content-secondary">
                  {isCopyingAnalysis ? 'Wird kopiert...' : 'Analyse kopieren'}
                </p>
                <p className="mt-1 text-sm text-content-muted">
                  Dieselben vier Dateien als Text in der Zwischenablage - zum Einfügen in ein
                  Gespräch, ohne Datei und ohne Anhang.
                </p>
              </div>
              <ClipboardCopy size={18} className="text-content-muted" />
            </button>

            {analysisMessage ? (
              <div className="rounded-panel border border-line bg-surface px-4 py-3 text-sm text-content-secondary">
                {analysisMessage}
              </div>
            ) : null}

            <input
              ref={fileInputRef}
              aria-label="Backup-Datei auswählen"
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
                <p className="font-medium text-content-secondary">JSON-Restore auswählen</p>
                <p className="mt-1 text-sm text-content-muted">
                  Liest einen Export ein, prüft das Schema und zeigt vor dem Restore eine Vorschau.
                </p>
              </div>
              <Upload size={18} className="text-content-muted" />
            </button>

            {pendingImport && pendingSummary ? (
              <div className="rounded-panel border border-warning-border bg-warning-soft p-4">
                <p className="text-sm font-semibold text-warning">
                  Restore bereit: {pendingImport.fileName}
                </p>
                <p className="mt-1 text-sm text-content-secondary">
                  Der Import ersetzt den aktuellen lokalen Datenbestand vollständig. Vom bisherigen
                  Stand wird vorher automatisch ein Backup heruntergeladen.
                </p>
                {/* Das Exportdatum ist der einzige Weg zu erkennen, ob es die
                    gemeinte Datei ist. */}
                <p className="mt-2 text-sm text-content-secondary">
                  Erstellt am {formatDateTime(pendingImport.snapshot.exportedAt)} ·{' '}
                  {pendingSummary.exercises} Übungen · {pendingSummary.mediaAssets} Bilder
                </p>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-panel bg-surface p-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-content-muted">Templates</p>
                    <p className="mt-2 text-xl font-semibold text-content">{pendingSummary.templates}</p>
                  </div>
                  <div className="rounded-panel bg-surface p-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-content-muted">Sessions</p>
                    <p className="mt-2 text-xl font-semibold text-content">{pendingSummary.sessions}</p>
                  </div>
                  <div className="rounded-panel bg-surface p-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-content-muted">Set-Logs</p>
                    <p className="mt-2 text-xl font-semibold text-content">{pendingSummary.setLogs}</p>
                  </div>
                  <div className="rounded-panel bg-surface p-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-content-muted">Tests</p>
                    <p className="mt-2 text-xl font-semibold text-content">{pendingSummary.tests}</p>
                  </div>
                </div>

                <div className="mt-4 flex gap-3">
                  <button
                    type="button"
                    onClick={handleConfirmImport}
                    disabled={isImporting}
                    className="flex-1 rounded-panel bg-accent px-4 py-3 text-sm font-medium text-accent-contrast transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isImporting ? 'Import läuft...' : 'Import bestätigen'}
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
              <div className="rounded-panel border border-success-border bg-success-soft px-4 py-4 text-sm text-success">
                {importSuccess}
              </div>
            ) : null}

            {importError ? (
              <div className="rounded-panel border border-danger-border bg-danger-soft px-4 py-4 text-sm text-danger">
                {importError}
              </div>
            ) : null}
          </div>
        </SectionCard>

        <SectionCard title="Medien" subtitle="Bilder werden genauso lokal gespeichert wie alles andere.">
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
              Legt ein Programm mit acht Wochen, drei Übungen, einem Workout und einem bereits
              abgeschlossenen Training an. Nur möglich, solange die Bibliothek leer ist.
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
          title="Alle Daten löschen"
          subtitle="Setzt die App auf den Auslieferungszustand zurück."
        >
          <div className="space-y-3">
            <p className="text-sm text-content-muted">
              Entfernt Programme, Workouts, Übungen, Trainings, Tests und Bilder von diesem Gerät.
              Exportiere vorher ein Backup, wenn du die Daten behalten willst.
            </p>
            <Button variant="danger" fullWidth onClick={() => setShowResetDialog(true)}>
              Lokale Daten löschen
            </Button>
          </div>
        </SectionCard>
      </div>

      <ConfirmDialog
        open={showNordicFixDialog}
        title={`${NORDIC_CURL_NAME} auf Wiederholungen umstellen?`}
        description="Die Übung wird künftig mit Wiederholungen und Gewicht erfasst. Bereits geloggte Sekunden bleiben unverändert stehen und werden in der Übungsansicht als Altdaten gekennzeichnet - umgerechnet wird nichts."
        confirmLabel="Umstellen"
        destructive={false}
        busy={isFixing}
        onConfirm={() =>
          void runDataFix(async () => {
            const changed = await applyNordicCurlTrackingFix();

            return changed > 0
              ? `${NORDIC_CURL_NAME} wird jetzt mit Wiederholungen erfasst.`
              : `${NORDIC_CURL_NAME} war bereits umgestellt.`;
          })
        }
        onCancel={() => setShowNordicFixDialog(false)}
      />

      <ConfirmDialog
        open={showWeekFixDialog}
        title="Programmwoche aus dem Startdatum?"
        description="Die von Hand gesetzte Woche wird zurückgenommen. Ab dann zählt die Programmwoche kalendarisch ab dem Montag des Startdatums - übersteuern lässt sie sich weiterhin jederzeit."
        confirmLabel="Übernehmen"
        destructive={false}
        busy={isFixing}
        onConfirm={() =>
          void runDataFix(async () => {
            if (!dataFixes?.activeProgramId) {
              throw new Error('Kein aktives Programm.');
            }

            await applyProgramWeekFix(dataFixes.activeProgramId, weekFixDate);

            return 'Startdatum gesetzt, die Woche läuft wieder mit dem Kalender.';
          })
        }
        onCancel={() => setShowWeekFixDialog(false)}
      >
        <TextField
          label="Programmstart"
          type="date"
          hint="Vorgeschlagen ist der Montag der Woche, in der das Programm angelegt wurde."
          value={weekFixDate}
          onChange={(event) => setWeekFixDate(event.target.value)}
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={showResetDialog}
        title="Wirklich alle Daten löschen?"
        description="Sämtliche Programme, Workouts, Übungen, Trainings, Tests und Bilder werden aus dieser Installation entfernt. Ohne Backup lässt sich das nicht rückgängig machen."
        confirmLabel="Alles löschen"
        busy={isResetting}
        onConfirm={handleResetAllData}
        onCancel={() => setShowResetDialog(false)}
      />
    </AppShell>
  );
}
