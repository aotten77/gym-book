import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronRight, Play } from 'lucide-react';
import { ActiveSessionHint } from '@/components/ActiveSessionHint';
import { Alert } from '@/components/Alert';
import { UnitKindIcon } from '@/components/icons/UnitKindIcon';
import { RunLogSheet } from '@/components/RunLogSheet';
import { Sheet } from '@/components/ui/Sheet';
import { db } from '@/db/appDb';
import {
  loadTemplateExerciseCounts,
  loadTemplateMinutes,
  loadTemplateRecency,
} from '@/db/history-queries';
import { loadUpcomingPlan } from '@/db/plan-queries';
import { startSessionFromTemplate } from '@/db/session-actions';
import { navigateToStartedSession } from '@/lib/session-navigation';
import { pickTodayPlan } from '@/domain/plan';
import { toDateInputValue } from '@/domain/program';
import {
  buildTodayUnitOptions,
  filterNowOptions,
  SHORT_WORKOUT_MAX_MINUTES,
  type NowFilter,
  type TodayUnitOption,
} from '@/domain/today-units';
import { formatNumber, formatRunDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/store/ui-store';

const FILTERS: { value: NowFilter; label: string }[] = [
  { value: 'all', label: 'Alle' },
  { value: 'short', label: 'Kurz' },
  { value: 'mobility', label: 'Mobility' },
  { value: 'strength', label: 'Kraft' },
];

const ROW_CLASSES =
  'flex min-h-[3.625rem] w-full items-center gap-3 rounded-control border border-line bg-surface-raised px-3 py-2 text-left hover:bg-surface disabled:opacity-60';

const SECTION_LABEL_CLASSES = 'text-xs font-semibold uppercase tracking-wide text-content-muted';

/**
 * „Jetzt trainieren": von jedem Tab aus eine Einheit wählen, unabhängig vom
 * Plan. Ersetzt das `TodayUnitSheet`, das nur an der früheren Programmseite hing - eine
 * spontane Schreibtisch-Mobility soll nicht erst dort gesucht werden müssen.
 *
 * Gestartet wird ohne `planEntryId`, außer bei einem heute geplanten offenen
 * Eintrag (wie Home): jedes andere Workout verknüpft die Zuordnungsregel
 * selbst. Jede Zeile ist ein Knopf; die Marken sind Zierde.
 *
 * Läuft schon eine Session, entfallen die Startoptionen: jeder Tap führte
 * sonst stumm in die laufende Einheit zurück (`startSessionFromTemplate`
 * startet keine zweite). Stattdessen steht die Rückkehr da, ehrlich als
 * solche beschriftet und ohne Fokus-Sheet - man liest erst, wo man war.
 *
 * Das `RunLogSheet` wohnt hier, nicht in der AppShell: wer es öffnen kann,
 * besitzt es (Home, Plan, Laufdetail tun es genauso), und der Zustand „Lauf
 * erfassen" ist nur eine Folge dieses Sheets. Schließen und Öffnen laufen in
 * einem Zug - nie zwei Sheets übereinander.
 */
export function NowSheet() {
  const navigate = useNavigate();
  const location = useLocation();
  const open = useUiStore((state) => state.isNowSheetOpen);
  const setOpen = useUiStore((state) => state.setNowSheetOpen);
  const [filter, setFilter] = useState<NowFilter>('all');
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [runSheetOpen, setRunSheetOpen] = useState(false);

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

  // Bei jedem Öffnen frisch: Filter zurück auf „Alle", nach Fehler oder Start nichts gesperrt.
  useEffect(() => {
    if (open) {
      setFilter('all');
      setIsStarting(false);
      setStartError(null);
    }
  }, [open]);

  const today = new Date();
  const todayKey = toDateInputValue(today);

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
    () => (open ? loadUpcomingPlan(todayKey) : Promise.resolve(undefined)),
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
    upcoming !== undefined;

  const plannedToday = upcoming
    ? pickTodayPlan(upcoming.entries, upcoming.links, todayKey).todayOpen
    : [];
  const { planned, others } = buildTodayUnitOptions({
    templates: templates ?? [],
    plannedToday,
    recency: recency ?? {},
    minutesByTemplate: minutesByTemplate ?? {},
    exerciseCountByTemplate: exerciseCounts ?? {},
    today,
  });

  // Der erste Termin ist „jetzt dran" und damit die einzige Lime-Fläche; er
  // bleibt vom Filter unberührt, ein Termin ist keine Auswahl.
  const [first, ...furtherPlanned] = planned;
  const visibleFurther = filterNowOptions(furtherPlanned, filter);
  const visibleOthers = filterNowOptions(others, filter);
  const quick = visibleOthers.filter(
    (option) => option.minutes > 0 && option.minutes <= SHORT_WORKOUT_MAX_MINUTES,
  );
  const quickIds = new Set(quick.map((option) => option.templateId));
  const rest = visibleOthers.filter((option) => !quickIds.has(option.templateId));
  const nothingToShow = !first && visibleFurther.length === 0 && visibleOthers.length === 0;

  async function handleStart(option: TodayUnitOption) {
    setIsStarting(true);

    try {
      const sessionId = await startSessionFromTemplate(
        option.templateId,
        option.planEntryId ? { planEntryId: option.planEntryId } : {},
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

  function renderRow(option: TodayUnitOption) {
    return (
      <li key={option.templateId}>
        <button
          type="button"
          className={ROW_CLASSES}
          disabled={isStarting}
          onClick={() => void handleStart(option)}
        >
          <UnitKindIcon kind={option.kind} size={20} className="shrink-0 text-content-secondary" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold text-content">{option.name}</span>
            <span className="block truncate text-sm text-content-muted">{option.lastTrained}</span>
          </span>
        </button>
      </li>
    );
  }

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
                to={`/session/${activeSession.id}`}
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
                  onClick={() => void handleStart(first)}
                  className="flex min-h-[3.625rem] w-full items-center gap-3 rounded-control bg-highlight px-3 py-2 text-left text-highlight-contrast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold uppercase tracking-wide">
                      Heute geplant
                    </span>
                    <span className="block truncate font-semibold">{first.name}</span>
                  </span>
                  <Play size={20} aria-hidden="true" className="shrink-0" />
                </button>
              ) : null}

              {visibleFurther.length > 0 ? (
                <ul className="space-y-2">{visibleFurther.map(renderRow)}</ul>
              ) : null}

              <div role="radiogroup" aria-label="Filter" className="flex flex-wrap gap-2">
                {FILTERS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    role="radio"
                    aria-checked={filter === item.value}
                    onClick={() => setFilter(item.value)}
                    className={cn(
                      'min-h-touch rounded-full border px-4 text-sm font-semibold',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                      filter === item.value
                        ? 'border-transparent bg-accent text-accent-contrast'
                        : 'border-line bg-surface-raised text-content-secondary hover:bg-surface',
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {quick.length > 0 ? (
                <section className="space-y-2">
                  <h3 className={SECTION_LABEL_CLASSES}>Kurz &amp; spontan</h3>
                  <ul className="grid grid-cols-2 gap-2">
                    {quick.map((option) => (
                      <li key={option.templateId}>
                        <button
                          type="button"
                          disabled={isStarting}
                          onClick={() => void handleStart(option)}
                          className="flex min-h-[4.5rem] w-full flex-col justify-between gap-1 rounded-control border border-line bg-surface-raised px-3 py-2 text-left hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
                        >
                          <span className="flex items-start gap-2">
                            <UnitKindIcon
                              kind={option.kind}
                              size={16}
                              className="mt-0.5 shrink-0 text-content-secondary"
                            />
                            <span className="min-w-0 break-words font-semibold text-content">
                              {option.name}
                            </span>
                          </span>
                          <span className="text-sm text-content-muted">
                            {formatNumber(option.minutes)} min · {formatNumber(option.exerciseCount)}{' '}
                            {option.exerciseCount === 1 ? 'Übung' : 'Übungen'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {rest.length > 0 ? (
                <section className="space-y-2">
                  <h3 className={SECTION_LABEL_CLASSES}>
                    {quick.length > 0 ? 'Weitere Workouts' : 'Workouts'}
                  </h3>
                  <ul className="space-y-2">{rest.map(renderRow)}</ul>
                </section>
              ) : null}

              {nothingToShow ? (
                <p className="text-sm text-content-muted">Kein Workout passt zu diesem Filter.</p>
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
      <RunLogSheet open={runSheetOpen} onClose={() => setRunSheetOpen(false)} />
    </>
  );
}
