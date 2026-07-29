import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, Play, RotateCcw } from 'lucide-react';
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
import { resolveWeekControl } from '@/domain/program';
import { formatDateTime } from '@/lib/format';

export default function Home() {
  const navigate = useNavigate();
  const [isUpdatingWeek, setIsUpdatingWeek] = useState(false);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
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
      // Haeufigster Fall: das Template zeigt auf eine Uebung, die es nicht
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
    <AppShell title="Gym Book" eyebrow="Offline-First Training">
      <div className="space-y-4">
        {/*
          Bei zwei gleich breiten Spalten reicht der Platz nicht fuer Label
          plus drei 44px-Buttons - sie liefen ueber den Kartenrand und lagen
          dann unter der Vorlagen-Karte, ausserhalb der Klickflaeche.
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
            backLabel="Eine Woche zurueck"
            forwardLabel="Eine Woche vor"
            onStepBack={() => handleStepWeek(-1)}
            onStepForward={() => handleStepWeek(1)}
            disabled={!program || isUpdatingWeek}
            onReset={handleClearWeek}
            resetLabel="Wochen-Override zuruecksetzen"
            resetDisabled={!settings?.weekOverride || isUpdatingWeek}
          />
          <StatCard
            label="Vorlagen"
            value={templateCountLabel}
            hint="Materialisiert beim Start in eine Session"
          />
        </section>

        <SectionCard
          title="Heute im Fokus"
          subtitle="Schneller Einstieg fuer verschwitzte Haende und kurze Aufmerksamkeit."
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
                  Solange eine Session laeuft, fuehrt jeder Vorlagen-Tap dorthin
                  zurueck. Das muss sichtbar sein, sonst wirkt die App defekt.
                */}
                <p className="px-1 text-sm text-content-muted">
                  Ein Training laeuft bereits. Schliesse es ab oder brich es ab, um eine andere
                  Vorlage zu starten.
                </p>
              </div>
            ) : (
              <Empty
                title="Keine aktive Session"
                description="Starte direkt aus einer Vorlage. Der Session-Stand bleibt lokal gespeichert."
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
                  title="Noch keine Vorlage"
                  description="Lege zuerst eine Trainingsvorlage an. Danach kannst du Sessions mit einem Tap starten."
                  action={
                    <button
                      type="button"
                      onClick={() => navigate('/templates')}
                      className="min-h-touch inline-flex items-center justify-center rounded-control border border-line px-4 py-2 text-sm text-content-secondary transition hover:bg-surface-raised"
                    >
                      Zu den Vorlagen
                    </button>
                  }
                />
              )}
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Letzter Abschluss"
          subtitle="Historie bleibt stabil, auch wenn du spaeter Templates aenderst."
          action={
            <Button variant="ghost" size="md" onClick={() => navigate('/history')}>
              Historie
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
              description="Sobald du eine Session abschliesst, taucht sie hier als schneller Ruecksprung auf."
              className="border-transparent bg-surface text-left"
            />
          )}
        </SectionCard>
      </div>
    </AppShell>
  );
}
