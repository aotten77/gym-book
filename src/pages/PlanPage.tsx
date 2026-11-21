import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDown, ArrowUp, ChevronRight, Play, ShieldAlert } from 'lucide-react';
import { Alert } from '@/components/Alert';
import { AppShell } from '@/components/AppShell';
import { PlanEntrySheet } from '@/components/PlanEntrySheet';
import { RunLogSheet } from '@/components/RunLogSheet';
import { TimelineUnitRow, type TimelineEntryAction } from '@/components/TimelineUnitRow';
import { TimelineWeek } from '@/components/TimelineWeek';
import { WeekSheet } from '@/components/WeekSheet';
import { db } from '@/db/appDb';
import { countTemplatesWithWeekdays } from '@/db/data-fix-actions';
import {
  loadActiveSessionProgress,
  loadCompletedSessionsBetween,
  loadEarliestTimelineDate,
  loadRunsBetween,
  loadSessionVolumes,
  loadTemplateExerciseCounts,
  loadTemplateMinutes,
  loadTemplateRecency,
  loadTestsBetween,
} from '@/db/history-queries';
import { loadLastPlanDate, loadPlanBetween } from '@/db/plan-queries';
import { startSessionFromTemplate } from '@/db/session-actions';
import { evaluateBackupStatus } from '@/domain/backup';
import { parseLocalDate, startOfCalendarWeek } from '@/domain/calendar-week';
import type { PlanEntry, ProgramWeek } from '@/domain/models';
import { pickNextTemplate } from '@/domain/next-workout';
import { planEntryState } from '@/domain/plan';
import { resolveWeekControl, toDateInputValue } from '@/domain/program';
import {
  buildCalendarWeeks,
  describeCalendarUnitDetail,
  pickTodayNowEntryId,
  shiftWindow,
  TIMELINE_LOAD_STEP_WEEKS,
  timelineFirstMonday,
  timelineLastMonday,
  timelineWeekCount,
  type CalendarWeekDay,
} from '@/domain/training-calendar';
import { useTodayKey } from '@/hooks/useTodayKey';
import { exportDatabaseSnapshot } from '@/lib/export';
import { formatNumber } from '@/lib/format';
import { navigateToStartedSession } from '@/lib/session-navigation';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/store/ui-store';

const HEAD_LINE =
  'flex min-h-touch items-center gap-3 rounded-panel border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

/**
 * Wie viel die untere Leiste vom Bild verdeckt: das untere Padding der
 * AppShell, das genau dafür da ist - mit Session-Streifen höher, dazu der
 * Home-Indicator (`env(safe-area-inset-bottom)`). Gelesen statt nachgerechnet,
 * damit es nicht von der AppShell wegdriftet.
 */
function bottomReserveOf(element: HTMLElement): number {
  const shell = element.closest<HTMLElement>('[data-app-shell]');

  return shell ? Number.parseFloat(getComputedStyle(shell).paddingBottom) || 0 : 0;
}

/**
 * Der Container, der die Seite scrollt. Im Hochformat das Dokument; im
 * Querformat dreht `index.css` die App um 90 Grad, und dann scrollt das Kind
 * von `#root` - `window.scrollBy` täte dort nichts.
 */
function scrollContainerOf(element: HTMLElement): HTMLElement {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);

    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
  }

  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/**
 * Die Lage eines Elements im Layout, über die `offsetTop`-Kette: unabhängig
 * vom Scrollstand und von Transformationen. `getBoundingClientRect` misst im
 * gedrehten Querformat die physische Achse - dort liefe „nach unten“ über x.
 */
function layoutTop(element: HTMLElement): number {
  let top = 0;

  for (let node: HTMLElement | null = element; node; node = node.offsetParent as HTMLElement | null) {
    top += node.offsetTop;
  }

  return top;
}

/** Wo ein Element im sichtbaren Ausschnitt seines Scroll-Containers steht, in Layout-Koordinaten. */
function visibleTop(element: HTMLElement): number {
  const container = scrollContainerOf(element);

  return layoutTop(element) - layoutTop(container) - container.scrollTop;
}

/**
 * Der Plan: ein Zeitstrahl über Wochen. Oben das Protokoll (nur Erledigtes),
 * in der Mitte heute, unten die Termine. Er öffnet auf der laufenden Woche.
 *
 * Termine sind hier nur lesbar. Gestartet wird nur, was heute offen ist, und
 * nur solange keine Session läuft - dann liegt die eine Lime-Fläche auf dem
 * Streifen unten, und ein heutiger Termin öffnet nur seine Anzeige.
 */
export function PlanPage() {
  const navigate = useNavigate();
  const setNowSheetOpen = useUiStore((state) => state.setNowSheetOpen);
  const todayKey = useTodayKey();
  /* Nur der lokale Tag zählt; ein Tageswechsel bei offener Seite ändert die Abhängigkeit. */
  const today = useMemo(() => parseLocalDate(todayKey) ?? new Date(), [todayKey]);
  /*
   * Der erste Montag ist ephemerer Oberflächenzustand. „Frühere Wochen“
   * schiebt ihn zurück; ein Tageswechsel lässt ihn stehen, denn nach vorn
   * folgt die Reichweite dem Tag ohnehin über `timelineLastMonday`.
   */
  const [firstMonday, setFirstMonday] = useState(() => timelineFirstMonday(today));
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [runSheetOpen, setRunSheetOpen] = useState(false);
  const [runEntryId, setRunEntryId] = useState<string | undefined>(undefined);
  const [viewedEntry, setViewedEntry] = useState<PlanEntry | undefined>(undefined);
  const [entrySheetOpen, setEntrySheetOpen] = useState(false);
  // Die Woche im Wochen-Sheet. Ansehen ist nie `weekOverride`: der eine Schreiber sind die Einstellungen.
  const [sheetWeek, setSheetWeek] = useState<string | null>(null);
  const [todayPosition, setTodayPosition] = useState<'visible' | 'above' | 'below'>('visible');
  const timelineRef = useRef<HTMLDivElement>(null);
  const hasScrolledToToday = useRef(false);
  /** Die Woche, die vor dem Nachladen oben stand, und wo sie stand. */
  const scrollAnchor = useRef<{ key: string; top: number } | null>(null);

  /*
   * Alles, was über dem Zeitstrahl steht oder seine Reichweite bestimmt. Das
   * Ergebnis ist ein Objekt, damit „noch nicht geladen“ (undefined) von „leer“
   * zu unterscheiden ist - erst danach darf die Seite auf heute springen,
   * sonst schöbe eine nachträglich erscheinende Kopfzeile alles nach unten.
   */
  const head = useLiveQuery(async () => {
    const settings = await db.appSettings.get('app-settings');
    const [program, programWeeks, completedSessions, templatesWithWeekdays, lastPlanDate, earliestDate] =
      await Promise.all([
        settings?.activeProgramId ? db.programs.get(settings.activeProgramId) : undefined,
        settings?.activeProgramId
          ? db.programWeeks.where('programId').equals(settings.activeProgramId).toArray()
          : ([] as ProgramWeek[]),
        db.workoutSessions.where('status').equals('completed').toArray(),
        countTemplatesWithWeekdays(),
        loadLastPlanDate(),
        loadEarliestTimelineDate(),
      ]);

    return {
      settings,
      program,
      programWeeks: [...programWeeks].sort((left, right) => left.weekNumber - right.weekNumber),
      completedSessionDates: completedSessions
        .map((session) => session.completedAt)
        .filter((value): value is string => Boolean(value)),
      templatesWithWeekdays,
      lastPlanDate,
      earliestDate,
    };
  }, []);
  const active = useLiveQuery(async () => ({ progress: await loadActiveSessionProgress() }), []);
  const templates = useLiveQuery(() => db.workoutTemplates.toArray(), []);
  const templateRecency = useLiveQuery(() => loadTemplateRecency(), []);
  const exerciseCounts = useLiveQuery(() => loadTemplateExerciseCounts(), []);
  const templateMinutes = useLiveQuery(() => loadTemplateMinutes(), []);

  const lastMondayKey = toDateInputValue(timelineLastMonday(today, head?.lastPlanDate));
  const range = useMemo(() => {
    const lastMonday = parseLocalDate(lastMondayKey) ?? firstMonday;
    const lastDay = new Date(lastMonday.getTime());

    lastDay.setDate(lastDay.getDate() + 6);

    const after = new Date(lastMonday.getTime());

    after.setDate(after.getDate() + 7);

    return {
      key: `${toDateInputValue(firstMonday)}/${lastMondayKey}`,
      weekCount: timelineWeekCount(firstMonday, lastMonday),
      fromDay: toDateInputValue(firstMonday),
      toDay: toDateInputValue(lastDay),
      fromIso: firstMonday.toISOString(),
      toIso: after.toISOString(),
    };
  }, [firstMonday, lastMondayKey]);
  const weekCount = range.weekCount;

  /*
   * Der ganze Zeitraum auf einmal. Das Ergebnis trägt den Zeitraum, für den es
   * geladen wurde: beim Nachladen liefert `useLiveQuery` bis zur neuen Antwort
   * noch die alte, und der Scroll-Ausgleich muss wissen, wann er fertig ist.
   */
  const timeline = useLiveQuery(async () => {
    const [plan, completedSessions, runs, tests] = await Promise.all([
      loadPlanBetween(range.fromDay, range.toDay),
      loadCompletedSessionsBetween(range.fromIso, range.toIso),
      loadRunsBetween(range.fromDay, range.toDay),
      loadTestsBetween(range.fromIso, range.toIso),
    ]);
    const volumes = await loadSessionVolumes(completedSessions.map((session) => session.id));

    return { rangeKey: range.key, plan, completedSessions, runs, tests, volumes };
  }, [range.key, range.fromIso, range.toIso]);

  const weeks = useMemo(
    () =>
      buildCalendarWeeks({
        firstMonday,
        weeks: weekCount,
        today,
        program: head?.program,
        programWeeks: head?.programWeeks ?? [],
        planEntries: timeline?.plan.entries ?? [],
        planLinks: timeline?.plan.links ?? {},
        templates: templates ?? [],
        completedSessions: timeline?.completedSessions ?? [],
        runs: timeline?.runs ?? [],
        tests: timeline?.tests ?? [],
      }),
    [firstMonday, weekCount, today, head?.program, head?.programWeeks, timeline, templates],
  );

  const ready = head !== undefined && active !== undefined && timeline !== undefined;
  const rangeLoaded = timeline?.rangeKey === range.key;
  const activeProgress = active?.progress;
  const hasActiveSession = Boolean(activeProgress);
  const currentWeekKey = toDateInputValue(startOfCalendarWeek(today));

  const backupStatus = evaluateBackupStatus({
    lastBackupAt: head?.settings?.lastBackupAt,
    completedSessionDates: head?.completedSessionDates ?? [],
    now: new Date().toISOString(),
  });
  // Liest nur. Der eine Schreiber auf `weekOverride` sind die Einstellungen.
  const weekControl = resolveWeekControl(head?.settings?.weekOverride, head?.program, head?.programWeeks ?? []);
  const showLoadEarlier = Boolean(head?.earliestDate && head.earliestDate < toDateInputValue(firstMonday));
  const nextTemplate = pickNextTemplate(templates ?? [], templateRecency ?? {});

  const findWeekElement = useCallback(
    (key: string) => timelineRef.current?.querySelector<HTMLElement>(`[data-timeline-week="${key}"]`) ?? null,
    [],
  );

  /*
   * Erst an den Anfang der laufenden Woche, dann - nur wenn heute dort unter
   * dem Bildrand bleibt (späte Tage einer vollen Woche, kleiner Bildschirm) -
   * die Heute-Zeile nach oben; `scroll-mt-16` hält sie frei vom Kopf. Gemessen
   * wird im Layout, wie beim Nachladen: so gilt es auch im Querformat.
   */
  const scrollToToday = useCallback(() => {
    findWeekElement(currentWeekKey)?.scrollIntoView({ block: 'start' });

    const todayElement = timelineRef.current?.querySelector<HTMLElement>('[data-timeline-today]');

    if (!todayElement) {
      return;
    }

    const bottom = visibleTop(todayElement) + todayElement.offsetHeight;

    if (bottom > scrollContainerOf(todayElement).clientHeight - bottomReserveOf(todayElement)) {
      todayElement.scrollIntoView({ block: 'start' });
    }
  }, [currentWeekKey, findWeekElement]);

  /* Öffnen auf heute: einmal pro Mount, sobald alles steht, was darüber liegt - ohne Animation. */
  useLayoutEffect(() => {
    if (!ready || !rangeLoaded || hasScrolledToToday.current) {
      return;
    }

    hasScrolledToToday.current = true;
    scrollToToday();
  }, [ready, rangeLoaded, scrollToToday]);

  /*
   * Scroll-Ausgleich beim Nachladen. Safari kennt kein `overflow-anchor`:
   * ohne Ausgleich rutschte die Woche, die oben stand, um vier Wochen nach
   * unten. Gemessen wird gegen die Lage vor dem Tap, und zwar bei jedem
   * Rendern, bis die Daten des neuen Zeitraums da sind - die frühen Wochen
   * wachsen erst mit ihren Einheiten. Gemessen und verschoben wird im
   * Layout und am Scroll-Container, nicht am Fenster: so gilt dasselbe im
   * gedrehten Querformat.
   */
  useLayoutEffect(() => {
    const anchor = scrollAnchor.current;

    if (!anchor) {
      return;
    }

    const element = findWeekElement(anchor.key);

    if (element) {
      const delta = visibleTop(element) - anchor.top;

      if (Math.abs(delta) >= 0.5) {
        scrollContainerOf(element).scrollTop += delta;
      }
    }

    if (rangeLoaded) {
      scrollAnchor.current = null;
    }
  }, [firstMonday, weeks, rangeLoaded, findWeekElement]);

  /* Die Pill steht, solange heute nicht im Bild ist. */
  useEffect(() => {
    if (!ready) {
      return undefined;
    }

    const element = timelineRef.current?.querySelector('[data-timeline-today]');

    if (!element || typeof IntersectionObserver === 'undefined') {
      return undefined;
    }

    // Oben oder unten über das Layout, nicht über `boundingClientRect`: im gedrehten Querformat wäre das die falsche Achse.
    const observer = new IntersectionObserver(([entry]) => {
      setTodayPosition(
        entry.isIntersecting ? 'visible' : visibleTop(entry.target as HTMLElement) < 0 ? 'above' : 'below',
      );
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, [ready, todayKey, weekCount]);

  function handleLoadEarlier() {
    const key = toDateInputValue(firstMonday);
    const element = findWeekElement(key);

    if (element) {
      scrollAnchor.current = { key, top: visibleTop(element) };
    }

    setFirstMonday(shiftWindow(firstMonday, -TIMELINE_LOAD_STEP_WEEKS));
  }

  function handleJumpToToday() {
    scrollToToday();
  }

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

  async function handleStart(entry: PlanEntry) {
    if (entry.kind === 'run') {
      setRunEntryId(entry.id);
      setRunSheetOpen(true);
      return;
    }

    if (!entry.templateId || isStarting) {
      return;
    }

    setIsStarting(true);
    setStartError(null);

    try {
      const sessionId = await startSessionFromTemplate(entry.templateId, { planEntryId: entry.id });

      navigateToStartedSession(navigate, sessionId);
    } catch (error) {
      // Häufigster Fall: das Workout zeigt auf eine Übung, die es nicht mehr
      // gibt. Ohne Meldung wirkt der Tap einfach wirkungslos.
      setStartError(error instanceof Error ? error.message : 'Session konnte nicht gestartet werden.');
      setIsStarting(false);
    }
  }

  function openEntry(entry: PlanEntry) {
    setViewedEntry(entry);
    setEntrySheetOpen(true);
  }

  function renderDay(day: CalendarWeekDay) {
    const nowEntryId = pickTodayNowEntryId(day, hasActiveSession);
    const links = timeline?.plan.links ?? {};
    const rows = day.units.map((unit, index) => {
      const ref = unit.ref;
      const detail = describeCalendarUnitDetail(unit, {
        volumeKg: ref.type === 'session' ? timeline?.volumes[ref.sessionId] : undefined,
        exerciseCount:
          ref.type === 'entry' && ref.entry.templateId ? exerciseCounts?.[ref.entry.templateId] : undefined,
        minutes: ref.type === 'entry' && ref.entry.templateId ? templateMinutes?.[ref.entry.templateId] : undefined,
        activeProgress:
          ref.type === 'active-session' && activeProgress?.sessionId === ref.sessionId ? activeProgress : undefined,
      });
      /*
       * Gestartet wird nur heute und nur ohne laufende Session. Läuft eine,
       * öffnet ein heutiger Termin nur seine Anzeige - ein Start führte sonst
       * still in die laufende Einheit zurück.
       */
      const action: TimelineEntryAction | undefined =
        ref.type !== 'entry'
          ? undefined
          : !day.isToday || hasActiveSession
            ? 'view'
            : unit.planEntryId === nowEntryId
              ? 'now'
              : 'start';

      return (
        <TimelineUnitRow
          key={`${unit.planEntryId ?? ref.type}-${index}`}
          unit={unit}
          detail={detail}
          entryState={unit.planEntryId ? planEntryState(unit.planEntryId, links) : undefined}
          action={action}
          disabled={action === 'now' || action === 'start' ? isStarting : undefined}
          onActivate={
            ref.type !== 'entry'
              ? undefined
              : action === 'view'
                ? () => openEntry(ref.entry)
                : () => void handleStart(ref.entry)
          }
        />
      );
    });

    const hasOpenEntry = day.units.some((unit) => unit.ref.type === 'entry');

    if (!day.isToday || hasOpenEntry) {
      return rows;
    }

    /*
      Heute ohne offenen Termin: kein Lime, denn nichts steht an. Die
      gestrichelte Zeile öffnet dasselbe Sheet wie der Jetzt-Knopf - auch,
      wenn heute schon etwas erledigt ist.
    */
    return [
      ...rows,
      <button
        key="today-free"
        type="button"
        data-today-free=""
        onClick={() => setNowSheetOpen(true)}
        className="flex min-h-[3.625rem] w-full min-w-0 items-center gap-3 rounded-panel border-[1.5px] border-dashed border-accent bg-surface px-3 py-2 text-left transition hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-app"
      >
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-contrast"
        >
          <Play size={16} fill="currentColor" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-content">Heute trainieren</span>
          {nextTemplate ? (
            <span className="block truncate text-xs text-content-muted">
              am längsten her: {nextTemplate.name}
            </span>
          ) : null}
        </span>
        <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-content-muted" />
      </button>,
    ];
  }

  return (
    <AppShell title="Plan">
      {ready ? (
        <div className="space-y-3">
          {/*
            Der Trainingsverlauf liegt ausschließlich auf diesem Gerät. Löscht
            man die Web-App vom Homescreen, nimmt iOS den kompletten
            Speicher-Container mit. Deshalb die Erinnerung, sobald es
            ungesicherte Trainings gibt - in Warnfarbe, nicht in Lime.
          */}
          {backupStatus.needsReminder ? (
            <div
              data-backup-reminder=""
              className={cn(HEAD_LINE, 'border-warning-border bg-warning-soft py-0 pr-1 text-warning')}
            >
              <ShieldAlert size={18} aria-hidden="true" className="shrink-0" />
              <span className="min-w-0 flex-1 py-2 font-semibold leading-tight">
                {backupStatus.unsavedSessionCount === 1
                  ? '1 Training ungesichert'
                  : `${formatNumber(backupStatus.unsavedSessionCount)} Trainings ungesichert`}
              </span>
              <button
                type="button"
                onClick={() => void handleBackup()}
                disabled={isBackingUp}
                className="flex min-h-touch min-w-touch shrink-0 items-center gap-1 rounded-control px-2 font-semibold text-warning focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
              >
                {isBackingUp ? 'Sichert…' : 'Sichern'}
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>
          ) : null}
          {backupError ? <Alert>{backupError}</Alert> : null}

          {weekControl.mode === 'override' ? (
            <div
              data-week-override=""
              className={cn(HEAD_LINE, 'border-line bg-surface py-0 pr-1 text-content-secondary')}
            >
              <span className="min-w-0 flex-1 py-2 leading-tight">
                Woche von Hand gesetzt: W{formatNumber(weekControl.effectiveWeek)}
              </span>
              <Link
                to="/settings"
                className="flex min-h-touch min-w-touch shrink-0 items-center gap-1 rounded-control px-3 font-semibold text-content hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Einstellungen
                <ChevronRight size={16} aria-hidden="true" />
              </Link>
            </div>
          ) : null}

          {/*
            Solange ein Workout noch feste Wochentage trägt, fehlen deren
            Termine im Plan - die Umwandlung ist eine Datenkorrektur in den
            Einstellungen. Ohne den Hinweis sähe ein leerer Plan aus wie
            „nichts geplant“.
          */}
          {head.templatesWithWeekdays > 0 ? (
            <Link
              to="/settings"
              data-plan-weekday-hint=""
              className={cn(HEAD_LINE, 'justify-between border-line bg-surface py-3 text-content-secondary')}
            >
              <span className="min-w-0">
                Feste Wochentage noch nicht umgewandelt – in den Einstellungen umwandeln
              </span>
              <ChevronRight size={18} className="shrink-0 text-content-muted" aria-hidden="true" />
            </Link>
          ) : null}

          {startError ? <Alert>{startError}</Alert> : null}

          {showLoadEarlier ? (
            <button
              type="button"
              data-load-earlier=""
              onClick={handleLoadEarlier}
              className="flex min-h-touch w-full items-center justify-center rounded-control border border-line px-4 text-sm text-content-secondary transition hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Frühere Wochen
            </button>
          ) : null}

          <div ref={timelineRef} data-timeline="" className="min-w-0 space-y-4">
            {weeks.map((week) => (
              <TimelineWeek
                key={week.key}
                week={week}
                onOpenWeek={setSheetWeek}
                renderDay={renderDay}
              />
            ))}
          </div>

          {todayPosition !== 'visible' ? (
            <button
              type="button"
              data-jump-today=""
              aria-label="Zu heute springen"
              onClick={handleJumpToToday}
              className={cn(
                'fixed left-1/2 z-20 flex min-h-touch -translate-x-1/2 items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-semibold text-accent-contrast shadow-soft',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-app',
                // Derselbe Abstand wie das Padding der AppShell: über der Leiste, mit Streifen höher.
                hasActiveSession
                  ? 'bottom-[calc(10.5rem+env(safe-area-inset-bottom))]'
                  : 'bottom-[calc(7rem+env(safe-area-inset-bottom))]',
              )}
            >
              {todayPosition === 'above' ? (
                <ArrowUp size={16} aria-hidden="true" />
              ) : (
                <ArrowDown size={16} aria-hidden="true" />
              )}
              Heute
            </button>
          ) : null}

          <RunLogSheet
            open={runSheetOpen}
            initialPlanEntryId={runEntryId}
            onClose={() => {
              setRunSheetOpen(false);
              setRunEntryId(undefined);
            }}
          />
          <PlanEntrySheet open={entrySheetOpen} entry={viewedEntry} onClose={() => setEntrySheetOpen(false)} />
          <WeekSheet weekKey={sheetWeek} onChangeWeek={setSheetWeek} onClose={() => setSheetWeek(null)} />
        </div>
      ) : null}
    </AppShell>
  );
}
