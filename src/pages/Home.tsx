import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Play, ShieldAlert } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Empty } from '@/components/Empty';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/ui/Button';
import { DoneCard, NowCard } from '@/components/ui/StatusCard';
import { SectionCard } from '@/components/SectionCard';
import { WeekStepper } from '@/components/WeekStepper';
import { db } from '@/db/appDb';
import { loadTemplateRecency, loadWeekSummary } from '@/db/history-queries';
import { clearWeekOverride, setWeekOverride } from '@/db/settings-actions';
import { startSessionFromTemplate } from '@/db/session-actions';
import { evaluateBackupStatus } from '@/domain/backup';
import { startOfCalendarWeek } from '@/domain/calendar-week';
import { pickNextTemplate } from '@/domain/next-workout';
import { resolveWeekControl } from '@/domain/program';
import { exportDatabaseSnapshot } from '@/lib/export';
import { formatDateTime, formatNumber } from '@/lib/format';

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
  /** Übungszahl je Workout - die Unterzeile der Karten, ohne zweite Abfrage. */
  const exerciseCountByTemplateId = useLiveQuery(async () => {
    const rows = await db.workoutTemplateExercises.toArray();

    return rows.reduce<Record<string, number>>((counts, row) => {
      counts[row.templateId] = (counts[row.templateId] ?? 0) + 1;
      return counts;
    }, {});
  }, []);
  const templateRecency = useLiveQuery(() => loadTemplateRecency(), []);
  /*
   * Die Kalenderwoche, nicht die Programmwoche: `weekControl` daneben zählt
   * eine von Hand gestellte Zahl, die mit dem Datum nichts zu tun hat.
   */
  const weekSummary = useLiveQuery(
    () => loadWeekSummary(startOfCalendarWeek(new Date()).toISOString()),
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

  /*
   * Die eine Frage, die diese Seite beantwortet: was mache ich heute? Ohne
   * Ablaufplan im Datenmodell entscheidet das eine Heuristik - deshalb steht
   * ihre Begründung als Beschriftung auf der Karte und nicht im Code allein.
   */
  const nextTemplate = pickNextTemplate(templates ?? [], templateRecency ?? {});
  const otherTemplates = useMemo(
    () =>
      (templates ?? [])
        .filter((template) => template.id !== nextTemplate?.id)
        .sort((left, right) => left.name.localeCompare(right.name, 'de')),
    [templates, nextTemplate?.id],
  );
  const weekControl = resolveWeekControl(settings?.weekOverride, program, programWeeks ?? []);
  const weekHint = program?.name ?? 'Kein Programm gesetzt';
  /*
   * Drei Modi, drei Texte. Das Ternär hier kannte nur zwei und faltete 'none'
   * in "Programm" - ohne aktives Programm stand damit über der Zeile "Kein
   * Programm gesetzt" das Wort "Programm", als käme die W1 von dort. Sie kommt
   * aus dem Fallback in resolveWeekControl, und was das praktisch heißt, ist
   * die einzige Auskunft, die an dieser Stelle jemand braucht.
   */
  const weekModeHint =
    weekControl.mode === 'override'
      ? 'Override aktiv'
      : weekControl.mode === 'program'
        ? 'Programm'
        : 'Zielwerte kommen aus dem Workout';

  function describeExerciseCount(templateId: string) {
    const count = exerciseCountByTemplateId?.[templateId];

    if (typeof count !== 'number') {
      return undefined;
    }

    return count === 1 ? '1 Übung' : `${count} Übungen`;
  }

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
          <section className="rounded-card border border-warning-border bg-warning-soft px-4 py-4">
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

        {startError ? <Alert>{startError}</Alert> : null}

        {/*
          Das einzige Limettenfeld dieser Seite - "jetzt dran" gibt es genau
          einmal, sonst heben sich zwei Flächen gegenseitig auf. Die Karte ist
          selbst der Knopf: ein Tap auf irgendetwas darin startet das Training,
          und der Name des Workouts steht damit im zugänglichen Namen des
          Knopfes (worauf die e2e-Tests seit jeher zeigen).
        */}
        {nextTemplate ? (
          <NowCard
            eyebrow="Am längsten her"
            title={nextTemplate.name}
            subtitle={describeExerciseCount(nextTemplate.id)}
            onClick={() => void handleStartSession(nextTemplate.id)}
            disabled={isStartingSession}
            action={
              /*
                Tinte auf Limette, nicht Limette auf Limette: die Fläche sagt
                "jetzt dran", die Handlung braucht den Kontrast dagegen.
              */
              <span className="flex h-11 w-11 items-center justify-center rounded-control bg-accent text-accent-contrast">
                <Play size={18} />
              </span>
            }
          />
        ) : (
          <Empty
            title="Noch kein Workout"
            description="Lege zuerst ein Workout an. Danach startest du ein Training mit einem Tap."
            action={
              <Button variant="ghost" size="md" onClick={() => navigate('/templates')}>
                Zu den Workouts
              </Button>
            }
          />
        )}

        {activeSession ? (
          /*
            Der Rückweg in die laufende Einheit steht in der Leiste am unteren
            Rand, auf jeder Seite. Was bleibt, ist die Auskunft, die der
            Streifen nicht gibt: solange eine Session läuft, führt jeder
            Workout-Tap dorthin zurück statt ein zweites Training zu starten.
            Ohne den Satz wirkt das wie ein Defekt.
          */
          <p className="px-1 text-sm text-content-muted">
            Ein Training läuft bereits - die Leiste unten führt zurück. Schließe es ab oder
            brich es ab, um ein anderes Workout zu starten.
          </p>
        ) : null}

        {/*
          Waldgrün heißt "erledigt" - und darf sich deshalb wiederholen, anders
          als die Limette. Bei null Einheiten steht hier aber keine gefüllte
          Fläche: sie behauptete einen Zustand, den es nicht gibt.
        */}
        {weekSummary && weekSummary.sessionCount > 0 ? (
          <DoneCard
            eyebrow="Diese Woche"
            title={
              weekSummary.sessionCount === 1 ? '1 Einheit' : `${weekSummary.sessionCount} Einheiten`
            }
            subtitle={`${formatNumber(Math.round(weekSummary.volume))} kg Volumen`}
          >
            {weekSummary.sessions[0] ? (
              <p className="text-sm opacity-75">
                Zuletzt: {weekSummary.sessions[0].templateName} ·{' '}
                {formatDateTime(weekSummary.sessions[0].completedAt)}
              </p>
            ) : null}
          </DoneCard>
        ) : (
          <Empty
            title="Diese Woche noch nichts"
            description="Sobald du eine Einheit abschließt, steht hier, was du geschafft hast."
          />
        )}

        {/*
          Die einzige Bedienung für Programmwoche und Override - bleibt
          deshalb auf der Startseite, jetzt aber als schmale Zeile statt als
          halbe Kachel neben der wichtigsten Karte.
        */}
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

        {/*
          Nur, wenn es sie gibt: mit einem einzigen Workout trägt die Karte
          eine leere Liste und eine Zahl, die schon oben steht.
        */}
        {otherTemplates.length > 0 ? (
          <SectionCard
            title="Weitere Workouts"
            subtitle={`${templates?.length ?? 0} vorbereitete Einheiten`}
          >
            <div className="grid gap-2">
              {otherTemplates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => void handleStartSession(template.id)}
                  disabled={isStartingSession}
                  className="flex min-h-touch items-center justify-between gap-3 rounded-panel border border-line bg-surface px-4 py-3 text-left transition hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-app disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-content">
                      {template.name}
                    </span>
                    <span className="mt-0.5 block text-sm text-content-muted">
                      {describeExerciseCount(template.id) ?? template.notes}
                    </span>
                  </span>
                  <Play size={18} className="shrink-0 text-content-muted" />
                </button>
              ))}
            </div>
          </SectionCard>
        ) : null}
      </div>
    </AppShell>
  );
}
