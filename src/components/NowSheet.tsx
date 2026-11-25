import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronRight, Play } from 'lucide-react';
import { ActiveSessionHint } from '@/components/ActiveSessionHint';
import { Alert } from '@/components/Alert';
import { UnitKindIcon } from '@/components/icons/UnitKindIcon';
import { RunLogSheet } from '@/components/RunLogSheet';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Sheet } from '@/components/ui/Sheet';
import { db } from '@/db/appDb';
import {
  loadTemplateExerciseCounts,
  loadTemplateMinutes,
  loadTemplateRecency,
} from '@/db/history-queries';
import { loadUpcomingPlan } from '@/db/plan-queries';
import { loadRestrictionSummaries } from '@/db/restriction-queries';
import { startSessionFromTemplate } from '@/db/session-actions';
import {
  activeSessionPath,
  navigateToGuidedStart,
  navigateToStartedSession,
} from '@/lib/session-navigation';
import type { PlanEntry } from '@/domain/models';
import { PLAN_SHIFT_WINDOW_DAYS, planEntryState, shiftDateKey } from '@/domain/plan';
import { toDateInputValue } from '@/domain/program';
import {
  buildNowSections,
  describePlanDay,
  nowStartMode,
  type TodayUnitOption,
} from '@/domain/today-units';
import { formatNumber, formatRunDate } from '@/lib/format';
import { useUiStore } from '@/store/ui-store';

const ROW_CLASSES =
  'flex min-h-[3.625rem] w-full items-center gap-3 rounded-control border border-line bg-surface-raised px-3 py-2 text-left hover:bg-surface disabled:opacity-60';

const SECTION_LABEL_CLASSES = 'text-xs font-semibold uppercase tracking-wide text-content-muted';

/**
 * „Jetzt trainieren": von jedem Tab aus eine Einheit wählen, unabhängig vom
 * Plan. Ersetzt das `TodayUnitSheet`, das nur an der früheren Programmseite hing - eine
 * spontane Schreibtisch-Mobility soll nicht erst dort gesucht werden müssen.
 *
 * Oben der erste offene Termin von heute (Lime), dann „Nachholen" (offene
 * Termine der letzten Tage), „Spontan" (was ab heute nirgends im Plan steht)
 * und „Geplant" (je Workout der nächste offene Termin). Ein Training an einem
 * anderen Tag als dem seines Termins ist zusätzlich, außer man sagt es: liegt
 * der Termin im Fenster um heute, fragt ein Dialog „vorziehen/nachholen oder
 * zusätzlich?". Still verknüpft wird nur ein Termin von heute
 * (`pickPlanEntryForStart`). Jede Zeile ist ein Knopf; die Marken sind Zierde.
 *
 * Läuft schon eine Session, entfallen die Startoptionen: jeder Tap führte
 * sonst stumm in die laufende Einheit zurück (`startSessionFromTemplate`
 * startet keine zweite). Stattdessen steht die Rückkehr da, ehrlich als
 * solche beschriftet und ohne Fokus-Sheet - man liest erst, wo man war.
 *
 * Das `RunLogSheet` wohnt hier, nicht in der AppShell: wer es öffnen kann,
 * besitzt es (Plan, Laufdetail tun es genauso), und der Zustand „Lauf
 * erfassen" ist nur eine Folge dieses Sheets. Schließen und Öffnen laufen in
 * einem Zug - nie zwei Sheets übereinander.
 */
export function NowSheet() {
  const navigate = useNavigate();
  const location = useLocation();
  const open = useUiStore((state) => state.isNowSheetOpen);
  const setOpen = useUiStore((state) => state.setNowSheetOpen);
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [runSheetOpen, setRunSheetOpen] = useState(false);
  // Die Zeile, deren Termin an einem anderen Tag liegt - solange die Rückfrage offen ist.
  const [asking, setAsking] = useState<TodayUnitOption | null>(null);

  /*
   * Das Flag liegt global im ui-store, aber jede Seite mountet ihr eigenes
   * AppShell. Wechselt die Route bei offenem Sheet, ohne dass jemand
   * `setOpen(false)` aufruft (Zurück-Geste, ein Start, der in `/session/`
   * führt), bliebe es gesetzt und das Sheet spränge auf dem nächsten Screen
   * wieder auf. Jeder Routenwechsel schließt es deshalb. Beim ersten Mount ist
   * das ein No-op.
   */
  useEffect(() => {
    setOpen(false);
  }, [location.pathname, setOpen]);

  // Bei jedem Öffnen frisch: keine Rückfrage, nach Fehler oder Start nichts gesperrt.
  useEffect(() => {
    if (open) {
      setAsking(null);
      setIsStarting(false);
      setStartError(null);
    }
  }, [open]);

  const today = new Date();
  const todayKey = toDateInputValue(today);
  // Ab hier zählen offene Termine als nachholbar; ältere fallen still weg.
  const windowStartKey = shiftDateKey(todayKey, -PLAN_SHIFT_WINDOW_DAYS) ?? todayKey;

  const templates = useLiveQuery(
    () => (open ? db.workoutTemplates.toArray() : Promise.resolve(undefined)),
    [open],
  );
  const recency = useLiveQuery(
    () => (open ? loadTemplateRecency() : Promise.resolve(undefined)),
    [open],
  );
  const minutesByTemplate = useLiveQuery(
    () => (open ? loadTemplateMinutes() : Promise.resolve(undefined)),
    [open],
  );
  const exerciseCounts = useLiveQuery(
    () => (open ? loadTemplateExerciseCounts() : Promise.resolve(undefined)),
    [open],
  );
  const upcoming = useLiveQuery(
    () => (open ? loadUpcomingPlan(windowStartKey) : Promise.resolve(undefined)),
    [open, windowStartKey],
  );
  // Für heute gerechnet: jeder Start von hier - auch Nachholen und Vorziehen - ist heute.
  const restrictionSummaries = useLiveQuery(
    () => (open ? loadRestrictionSummaries(new Date()) : Promise.resolve(undefined)),
    [open, todayKey],
  );

  // `null` heißt „läuft keine", `undefined` „noch nicht geladen" - sonst blitzten die Startzeilen kurz auf.
  const activeSession = useLiveQuery(
    async () => (await db.workoutSessions.where('status').equals('active').first()) ?? null,
    [],
  );

  // Erst wenn alles da ist: sonst sprängen die Zeilen unter „Lauf eintragen" nach.
  const loaded =
    activeSession !== undefined &&
    templates !== undefined &&
    recency !== undefined &&
    minutesByTemplate !== undefined &&
    exerciseCounts !== undefined &&
    upcoming !== undefined &&
    restrictionSummaries !== undefined;

  const openEntries = upcoming
    ? upcoming.entries.filter(
        (entry: PlanEntry) => planEntryState(entry.id, upcoming.links) === 'offen',
      )
    : [];
  const sections = buildNowSections({
    templates: templates ?? [],
    openEntries,
    recency: recency ?? {},
    minutesByTemplate: minutesByTemplate ?? {},
    exerciseCountByTemplate: exerciseCounts ?? {},
    restrictionSummaryByTemplate: restrictionSummaries ?? {},
    today,
  });
  const { now: first, catchUp, spontaneous, planned } = sections;
  const nothingToShow =
    !first && catchUp.length === 0 && spontaneous.length === 0 && planned.length === 0;

  /** Startet die Zeile - mit `planEntryId` für genau diesen Termin, ohne als zusätzliches Training. */
  async function startOption(option: TodayUnitOption, planEntryId: string | undefined) {
    setAsking(null);

    // Eine geführte Vorlage startet nicht hier, sondern auf ihrem Start-Screen.
    if (option.guided) {
      setOpen(false);
      navigateToGuidedStart(navigate, option.templateId, { planEntryId });
      return;
    }

    setIsStarting(true);

    try {
      const sessionId = await startSessionFromTemplate(
        option.templateId,
        planEntryId ? { planEntryId } : {},
      );
      setStartError(null);
      setOpen(false);
      navigateToStartedSession(navigate, sessionId);
    } catch (error) {
      setStartError(
        error instanceof Error ? error.message : 'Session konnte nicht gestartet werden.',
      );
      setIsStarting(false);
    }
  }

  function handleTap(option: TodayUnitOption) {
    switch (nowStartMode(option, todayKey)) {
      case 'link':
        void startOption(option, option.planEntry?.id);
        return;
      case 'ask':
        setAsking(option);
        return;
      default:
        void startOption(option, undefined);
    }
  }

  function renderRow(option: TodayUnitOption, detail: string) {
    return (
      <li key={option.planEntry?.id ?? option.templateId}>
        <button
          type="button"
          className={ROW_CLASSES}
          disabled={isStarting}
          onClick={() => handleTap(option)}
        >
          <UnitKindIcon kind={option.kind} size={20} className="shrink-0 text-content-secondary" />
          {/* Umbrechen statt `truncate`: bei 320px schnitte das die Unterzeile still ab. */}
          <span className="min-w-0 flex-1">
            <span className="block break-words font-semibold text-content">{option.name}</span>
            <span className="block break-words text-sm text-content-muted">{detail}</span>
            {option.restrictionSummary ? (
              <span data-now-restrictions="" className="block break-words text-sm text-content-secondary">
                {option.restrictionSummary}
              </span>
            ) : null}
          </span>
        </button>
      </li>
    );
  }

  function spontaneousDetail(option: TodayUnitOption) {
    const parts: string[] = [];

    if (option.minutes > 0) {
      parts.push(`${formatNumber(option.minutes)} min`);
    }

    if (option.exerciseCount > 0) {
      const noun = option.exerciseCount === 1 ? 'Übung' : 'Übungen';
      parts.push(`${formatNumber(option.exerciseCount)} ${noun}`);
    }

    return [...parts, option.lastTrained].join(' · ');
  }

  function plannedDetail(option: TodayUnitOption) {
    const day = option.planEntry ? describePlanDay(option.planEntry.date, today) : '';

    return `${day === 'heute' ? 'heute geplant' : `geplant ${day}`} · ${option.lastTrained}`;
  }

  function catchUpDetail(option: TodayUnitOption) {
    const day = option.planEntry ? describePlanDay(option.planEntry.date, today) : '';

    return `von ${day} · ${option.lastTrained}`;
  }

  // Die Rückfrage: vorziehen (Termin liegt später) oder nachholen (früher) - oder zusätzlich.
  const askingDay = asking?.planEntry ? describePlanDay(asking.planEntry.date, today) : '';
  const askingAhead = asking?.planEntry ? asking.planEntry.date > todayKey : false;

  const header = (
    <div className="min-w-0">
      <h2 className="truncate font-display text-lg font-bold text-content">Jetzt trainieren</h2>
      <p className="truncate text-sm text-content-muted">
        {formatRunDate(todayKey)} · unabhängig vom Plan
      </p>
    </div>
  );

  return (
    <>
      <Sheet
        open={open}
        label="Jetzt trainieren"
        closeLabel="Auswahl schließen"
        header={header}
        onClose={() => setOpen(false)}
      >
        <div className="space-y-4">
          {startError ? <Alert variant="error">{startError}</Alert> : null}

          {loaded && activeSession ? (
            <>
              {/*
                Tinte, nicht Lime: das ist eine Aktion („zurück"), kein „jetzt
                dran". Ein Link ohne `state`, damit das Fokus-Sheet geschlossen
                bleibt; der Routenwechsel schließt dieses Sheet selbst.
              */}
              <Link
                to={activeSessionPath(activeSession)}
                className="flex min-h-[3.625rem] w-full items-center gap-3 rounded-control bg-accent px-3 py-2 text-left text-accent-contrast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-bold uppercase tracking-wide">
                    Training läuft · zurück
                  </span>
                  <span className="block truncate font-semibold">
                    {activeSession.templateNameSnapshot}
                  </span>
                </span>
                <ChevronRight size={20} aria-hidden="true" className="shrink-0" />
              </Link>
              <ActiveSessionHint />
            </>
          ) : null}

          {loaded && !activeSession ? (
            <>
              {first ? (
                <button
                  type="button"
                  disabled={isStarting}
                  onClick={() => handleTap(first)}
                  className="flex min-h-[3.625rem] w-full items-center gap-3 rounded-control bg-highlight px-3 py-2 text-left text-highlight-contrast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold uppercase tracking-wide">
                      Heute geplant
                    </span>
                    <span className="block truncate font-semibold">{first.name}</span>
                    {first.restrictionSummary ? (
                      /* Nebentext auf gefüllter Fläche: abgeschwächt, nicht umgefärbt. */
                      <span data-now-restrictions="" className="block break-words text-sm opacity-75">
                        {first.restrictionSummary}
                      </span>
                    ) : null}
                  </span>
                  <Play size={20} aria-hidden="true" className="shrink-0" />
                </button>
              ) : null}

              {catchUp.length > 0 ? (
                <section data-now-section="nachholen" className="space-y-2">
                  <h3 className={SECTION_LABEL_CLASSES}>Nachholen</h3>
                  <ul className="space-y-2">
                    {catchUp.map((option) => renderRow(option, catchUpDetail(option)))}
                  </ul>
                </section>
              ) : null}

              {spontaneous.length > 0 ? (
                <section data-now-section="spontan" className="space-y-2">
                  <h3 className={SECTION_LABEL_CLASSES}>Spontan</h3>
                  <ul className="space-y-2">
                    {spontaneous.map((option) => renderRow(option, spontaneousDetail(option)))}
                  </ul>
                </section>
              ) : null}

              {planned.length > 0 ? (
                <section data-now-section="geplant" className="space-y-2">
                  <h3 className={SECTION_LABEL_CLASSES}>Geplant</h3>
                  <ul className="space-y-2">
                    {planned.map((option) => renderRow(option, plannedDetail(option)))}
                  </ul>
                </section>
              ) : null}

              {nothingToShow ? (
                <p className="text-sm text-content-muted">Noch kein Workout angelegt.</p>
              ) : null}
            </>
          ) : null}

          {loaded ? (
            <section className="space-y-2">
              <h3 className={SECTION_LABEL_CLASSES}>Erfassen</h3>
              {/*
                Zwei Spalten à ~140px auf 320px: das Icon allein kostete 32px
                und schnitt „Lauf eintragen" ab. Beide Knöpfe tragen deshalb
                nur Text und brechen im Zweifel um, statt abzuschneiden.
              */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={ROW_CLASSES}
                  disabled={isStarting}
                  onClick={() => {
                    // Nie zwei Sheets übereinander: erst schließen, dann das Lauf-Sheet öffnen.
                    setOpen(false);
                    setRunSheetOpen(true);
                  }}
                >
                  <span className="min-w-0 flex-1 break-words font-semibold text-content">
                    Lauf eintragen
                  </span>
                </button>
                <button
                  type="button"
                  className={ROW_CLASSES}
                  disabled={isStarting}
                  onClick={() => {
                    setOpen(false);
                    navigate('/tests');
                  }}
                >
                  <span className="min-w-0 flex-1 break-words font-semibold text-content">
                    Test erfassen
                  </span>
                </button>
              </div>
            </section>
          ) : null}
        </div>
      </Sheet>
      <ConfirmDialog
        open={asking !== null}
        title={`${asking?.name ?? ''} ${askingAhead ? 'ist' : 'war'} für ${askingDay} geplant`}
        description={
          askingAhead
            ? `Vorgezogen gilt der Termin heute als erledigt und fällt am ${askingDay} weg. ` +
              'Zusätzlich trainiert bleibt der Plan, wie er ist.'
            : 'Nachgeholt gilt der Termin als erledigt. Zusätzlich trainiert bleibt er offen.'
        }
        confirmLabel={`Termin vom ${askingDay} ${askingAhead ? 'vorziehen' : 'nachholen'}`}
        destructive={false}
        secondaryAction={{
          label: 'Zusätzlich trainieren',
          onClick: () => asking && void startOption(asking, undefined),
        }}
        onConfirm={() => asking && void startOption(asking, asking.planEntry?.id)}
        onCancel={() => setAsking(null)}
      />
      <RunLogSheet open={runSheetOpen} onClose={() => setRunSheetOpen(false)} />
    </>
  );
}
