import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, Play, RotateCcw, ShieldAlert } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Empty } from '@/components/Empty';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/ui/Button';
import { SectionCard } from '@/components/SectionCard';
import { StatCard } from '@/components/StatCard';
import { WeekStepper } from '@/components/WeekStepper';
import { db } from '@/db/appDb';
import { clearWeekOverride, setWeekOverride } from '@/db/settings-actions';
import { startSessionFromTemplate } from '@/db/session-actions';
import { evaluateBackupStatus } from '@/domain/backup';
import { resolveWeekControl } from '@/domain/program';
import { exportDatabaseSnapshot } from '@/lib/export';
import { formatDateTime } from '@/lib/format';

export default function Home() {
  const navigate = useNavigate();
  const [isUpdatingWeek, setIsUpdatingWeek] = useState(false);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const templates = useLiveQuery(() => db.workoutTemplates.toArray(), []);
  const settings = useLiveQuery(() => db.appSettings.get('app-settings'), []);
  const program = useLiveQuery(async () => {
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
  const activeSession = useLiveQuery(
    () => db.workoutSessions.where('status').equals('active').first(),
    [],
  );
  const lastCompletedSession = useLiveQuery(
    async () => {
      return db.workoutSessions.orderBy('completedAt').reverse().filter((item) => item.status === 'completed').first();
    },
    [],
  );

  const completedSessionDates = useLiveQuery(
    async () => {
      const sessions = await db.workoutSessions.where('status').equals('completed').toArray();
      return sessions.map((item) => item.completedAt).filter((value): value is string => Boolean(value));
    },
    [],
  );
  const backupStatus = evaluateBackupStatus({
    lastBackupAt: settings?.lastBackupAt,
    completedSessionDates: completedSessionDates ?? [],
    now: new Date().toISOString(),
  });

  async function handleBackup() {
    setIsBackingUp(true);

    try {
      const result = await exportDatabaseSnapshot({ preferShare: true });
      setBackupError(result === 'cancelled' ? 'Sicherung abgebrochen - es wurde nichts gespeichert.' : null);
    } catch (error) {
      setBackupError(
        error instanceof Error ? error.message : 'Sicherung konnte nicht erstellt werden.',
      );
    } finally {
      setIsBackingUp(false);
    }
  }

  const templateCountLabel = useMemo(() => `${templates?.length ?? 0}`, [templates]);
  const weekControl = resolveWeekControl(settings?.weekOverride, program, programWeeks ?? []);
  const weekHint = program?.name ?? 'Programm in /programme anlegen';
  const weekModeHint = weekControl.mode === 'override' ? 'Override aktiv' : 'Programm';

  async function handleStartSession(templateId: string) {
    setIsStartingSession(true);

    try {
      const sessionId = await startSessionFromTemplate(templateId);
      setStartError(null);
      navigate(`/session/${sessionId}`);
    } catch (error) {
      // Häufigster Fall: das Template zeigt auf eine Übung, die es nicht
      // mehr gibt. Ohne Meldung wirkt der Tap einfach wirkungslos.
      setStartError(
        error instanceof Error ? error.message : 'Session konnte nicht gestartet werden.',
      );
      setIsStartingSession(false);
    }
  }

  async function handleStepWeek(direction: -1 | 1) {
    if (!program) {
      return;
    }

    setIsUpdatingWeek(true);

    try {
      const next = Math.min(weekControl.maxWeek, Math.max(1, weekControl.effectiveWeek + direction));
      await setWeekOverride(next);
    } finally {
      setIsUpdatingWeek(false);
    }
  }

  async function handleClearWeek() {
    setIsUpdatingWeek(true);

    try {
      await clearWeekOverride();
    } finally {
      setIsUpdatingWeek(false);
    }
  }

  return (
    <AppShell title="Gym Book">
      <div className="space-y-4">
        {/*
          Der Trainingsverlauf liegt ausschließlich auf diesem Gerät. Löscht man die
          Web-App vom Homescreen, nimmt iOS den kompletten Speicher-Container
          mit - ohne Vorwarnung und ohne Wiederherstellung. Deshalb die
          Erinnerung genau dann, wenn ungesicherte Trainings existieren.
        */}
        {backupStatus.needsReminder ? (
          <section className="rounded-card border border-warning/20 bg-warning-soft px-4 py-4">
            <div className="flex items-start gap-3">
              <ShieldAlert size={18} className="mt-0.5 shrink-0 text-warning" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-warning">
                  {backupStatus.unsavedSessionCount === 1
                    ? '1 Training ist nicht gesichert'
                    : `${backupStatus.unsavedSessionCount} Trainings sind nicht gesichert`}
                </p>
                <p className="mt-1 text-sm text-content-secondary">
                  {typeof backupStatus.daysSinceBackup === 'number'
                    ? `Letzte Sicherung vor ${backupStatus.daysSinceBackup} Tagen.`
                    : 'Es gibt noch keine Sicherung.'}{' '}
                  Deine Daten liegen nur auf diesem Gerät.
                </p>
                {backupError ? <Alert className="mt-3">{backupError}</Alert> : null}
                <Button
                  variant="primary"
                  size="md"
                  className="mt-3"
                  onClick={() => void handleBackup()}
                  disabled={isBackingUp}
                >
                  {isBackingUp ? 'Sichert...' : 'Jetzt sichern'}
                </Button>
              </div>
            </div>
          </section>
        ) : null}

        {/*
          Bei zwei gleich breiten Spalten reicht der Platz nicht für Label
          plus drei 44px-Buttons - sie liefen über den Kartenrand und lagen
          dann unter der Workout-Karte, außerhalb der Klickfläche.
        */}
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <WeekStepper
            label="Aktive Woche"
            week={weekControl.effectiveWeek}
            hint={
              <>
                <p className="mt-2 text-sm text-content-muted">{weekHint}</p>
                <p className="mt-1 text-xs text-content-muted">{weekModeHint}</p>
              </>
            }
            backLabel="Eine Woche zurück"
            forwardLabel="Eine Woche vor"
            onStepBack={() => handleStepWeek(-1)}
            onStepForward={() => handleStepWeek(1)}
            disabled={!program || isUpdatingWeek}
            onReset={handleClearWeek}
            resetLabel="Wochen-Override zurücksetzen"
            resetDisabled={!settings?.weekOverride || isUpdatingWeek}
          />
          <StatCard
            label="Workouts"
            value={templateCountLabel}
            hint="Vorbereitete Trainingseinheiten"
          />
        </section>

        <SectionCard
          title="Heute im Fokus"
          subtitle="Schneller Einstieg für verschwitzte Hände und kurze Aufmerksamkeit."
        >
          <div className="space-y-3">
            {startError ? <Alert>{startError}</Alert> : null}

            {activeSession ? (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => navigate(`/session/${activeSession.id}`)}
                  className="flex w-full items-center justify-between rounded-panel bg-accent px-4 py-4 text-left text-accent-contrast transition hover:brightness-105 focus-visible:ring-2 focus-visible:ring-lime-300/70"
                >
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-accent-contrast/80">Aktive Session</p>
                    <p className="mt-2 text-lg font-semibold">{activeSession.templateNameSnapshot}</p>
                    <p className="mt-1 text-sm text-accent-contrast/80">
                      Gestartet {formatDateTime(activeSession.startedAt)}
                    </p>
                  </div>
                  <RotateCcw size={18} />
                </button>
                {/*
                  Solange eine Session läuft, führt jeder Workout-Tap dorthin
                  zurück. Das muss sichtbar sein, sonst wirkt die App defekt.
                */}
                <p className="px-1 text-sm text-content-muted">
                  Ein Training läuft bereits. Schließe es ab oder brich es ab, um ein anderes
                  Workout zu starten.
                </p>
              </div>
            ) : (
              <Empty
                title="Keine aktive Session"
                description="Starte direkt aus einem Workout. Der Stand bleibt lokal gespeichert."
              />
            )}

            <div className="grid gap-3">
              {(templates?.length ?? 0) > 0 ? (
                (templates ?? []).map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => void handleStartSession(template.id)}
                    disabled={isStartingSession}
                    className="flex items-center justify-between rounded-panel border border-line bg-surface-raised px-4 py-4 text-left transition hover:border-accent-border hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-lime-300/70 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <div>
                      <p className="text-sm font-semibold text-content">{template.name}</p>
                      <p className="mt-1 text-sm text-content-muted">{template.notes}</p>
                    </div>
                    <div className="flex h-11 w-11 items-center justify-center rounded-control bg-accent-soft text-accent">
                      <Play size={18} />
                    </div>
                  </button>
                ))
              ) : (
                <Empty
                  title="Noch kein Workout"
                  description="Lege zuerst ein Workout an. Danach startest du ein Training mit einem Tap."
                  action={
                    <button
                      type="button"
                      onClick={() => navigate('/templates')}
                      className="min-h-touch inline-flex items-center justify-center rounded-control border border-line px-4 py-2 text-sm text-content-secondary transition hover:bg-surface-raised"
                    >
                      Zu den Workouts
                    </button>
                  }
                />
              )}
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Letzter Abschluss"
          subtitle="Bleibt unverändert, auch wenn du das Workout später bearbeitest."
          action={
            <Button variant="ghost" size="md" onClick={() => navigate('/history')}>
              Verlauf
            </Button>
          }
        >
          {lastCompletedSession ? (
            <div className="rounded-panel bg-surface p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-content-muted">Zuletzt beendet</p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold text-content">
                    {lastCompletedSession.templateNameSnapshot}
                  </p>
                  <p className="mt-1 text-sm text-content-muted">
                    {formatDateTime(lastCompletedSession.completedAt)}
                  </p>
                </div>
                <ArrowRight className="text-content-muted" size={18} />
              </div>
            </div>
          ) : (
            <Empty
              title="Noch kein Abschluss"
              description="Sobald du eine Session abschließt, taucht sie hier als schneller Rücksprung auf."
              className="border-transparent bg-surface text-left"
            />
          )}
        </SectionCard>
      </div>
    </AppShell>
  );
}
