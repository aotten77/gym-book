import { useState } from 'react';
import { ChevronDown, ChevronRight, ChevronUp } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Alert } from '@/components/Alert';
import { PlanEntrySheet } from '@/components/PlanEntrySheet';
import { PlanSeriesSheet } from '@/components/PlanSeriesSheet';
import { RunLogSheet } from '@/components/RunLogSheet';
import { UnitKindIcon } from '@/components/icons/UnitKindIcon';
import { Button, IconButton } from '@/components/ui/Button';
import { db } from '@/db/appDb';
import { countTemplatesWithWeekdays } from '@/db/data-fix-actions';
import { loadSessionVolumes } from '@/db/history-queries';
import { movePlanEntryInDay } from '@/db/plan-actions';
import { loadPlanBetween } from '@/db/plan-queries';
import { startSessionFromTemplate } from '@/db/session-actions';
import { navigateToStartedSession } from '@/lib/session-navigation';
import type { PlanEntry } from '@/domain/models';
import { planEntryState } from '@/domain/plan';
import { toDateInputValue } from '@/domain/program';
import {
  describeCalendarUnitDetail,
  describeWeekRange,
  type CalendarUnit,
  type CalendarWeek,
} from '@/domain/training-calendar';
import { formatRunDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/store/ui-store';

interface PlanWeekSectionProps {
  /** Die im Raster gewählte Woche; die Liste hat keine eigenen Pfeile. */
  week: CalendarWeek;
}

const ROW_BASE =
  'flex min-h-[3.625rem] w-full min-w-0 flex-1 items-center gap-3 rounded-panel px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

/**
 * Die Tagesliste: Plan und Wirklichkeit einer Kalenderwoche zusammen. Jede
 * Zeile ist selbst das Tippziel (Link oder Knopf) und trägt deshalb nur
 * Zier-Marken; geschrieben wird über die Sheets und `startSessionFromTemplate`.
 */
export function PlanWeekSection({ week }: PlanWeekSectionProps) {
  const navigate = useNavigate();
  const setNowSheetOpen = useUiStore((state) => state.setNowSheetOpen);
  const fromDay = week.key;
  const toDay = toDateInputValue(week.end);
  const todayKey = toDateInputValue(new Date());
  // Heute, wenn es in der Woche liegt; den Montag, wenn die Woche künftig ist;
  // sonst heute - eine Serie ab Montag legte mittwochs zwei Termine in die Vergangenheit.
  const seriesStart = todayKey >= fromDay && todayKey <= toDay ? todayKey : fromDay > todayKey ? fromDay : todayKey;

  const [editing, setEditing] = useState<PlanEntry | undefined>(undefined);
  const [entryDefaultDate, setEntryDefaultDate] = useState(todayKey);
  const [entrySheetOpen, setEntrySheetOpen] = useState(false);
  const [seriesOpen, setSeriesOpen] = useState(false);
  const [runSheetOpen, setRunSheetOpen] = useState(false);
  const [runEntryId, setRunEntryId] = useState<string | undefined>(undefined);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  // Die Verweise (offen/belegt/erledigt) kommen aus derselben Abfrage wie überall.
  const plan = useLiveQuery(() => loadPlanBetween(fromDay, toDay), [fromDay, toDay]);
  const links = plan?.links ?? {};

  const sessionIds = week.days.flatMap((day) =>
    day.units.flatMap((unit) => (unit.ref.type === 'session' ? [unit.ref.sessionId] : [])),
  );
  const volumes = useLiveQuery(() => loadSessionVolumes(sessionIds), [sessionIds.join()]);
  const exerciseCounts = useLiveQuery(async () => {
    const rows = await db.workoutTemplateExercises.toArray();

    return rows.reduce<Record<string, number>>((counts, row) => {
      counts[row.templateId] = (counts[row.templateId] ?? 0) + 1;
      return counts;
    }, {});
  }, []);

  /*
   * Solange ein Workout noch feste Wochentage trägt, fehlen deren Termine hier -
   * die Umwandlung ist eine Datenkorrektur in den Einstellungen, kein `upgrade()`.
   * Ohne diesen Hinweis sähe ein leerer Plan aus wie "nichts geplant".
   */
  const templatesWithWeekdays = useLiveQuery(() => countTemplatesWithWeekdays(), []);
  const hasUnmigratedWeekdays = (templatesWithWeekdays ?? 0) > 0;

  function openEntry(entry: PlanEntry | undefined, defaultDate: string) {
    setEditing(entry);
    setEntryDefaultDate(defaultDate);
    setEntrySheetOpen(true);
  }

  async function handleStart(entry: PlanEntry) {
    if (!entry.templateId || isStarting) {
      return;
    }

    setIsStarting(true);
    setActionError(null);

    try {
      const sessionId = await startSessionFromTemplate(entry.templateId, { planEntryId: entry.id });

      navigateToStartedSession(navigate, sessionId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Session konnte nicht gestartet werden.');
      setIsStarting(false);
    }
  }

  async function handleMove(entry: PlanEntry, direction: -1 | 1) {
    setActionError(null);

    try {
      await movePlanEntryInDay(entry.id, direction);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Der Termin ließ sich nicht verschieben.');
    }
  }

  function renderUnit(unit: CalendarUnit, isToday: boolean, key: string) {
    const entryState = unit.planEntryId ? planEntryState(unit.planEntryId, links) : undefined;
    const detail = describeCalendarUnitDetail(unit, {
      volumeKg: unit.ref.type === 'session' ? volumes?.[unit.ref.sessionId] : undefined,
      exerciseCount:
        unit.ref.type === 'entry' && unit.ref.entry.templateId
          ? exerciseCounts?.[unit.ref.entry.templateId]
          : undefined,
    });
    const done = unit.state === 'erledigt';
    const startMark =
      isToday && unit.ref.type === 'entry' ? (unit.kind === 'run' ? 'Eintragen' : 'Starten') : undefined;
    const className = cn(
      ROW_BASE,
      done ? 'bg-success text-success-contrast' : 'border border-line bg-surface',
    );
    const content = (
      <>
        <UnitKindIcon
          kind={unit.kind}
          size={24}
          className={cn('shrink-0', done ? 'text-success-contrast' : 'text-content-secondary')}
        />
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-sm font-semibold', done ? '' : 'text-content')}>
            {unit.name}
          </span>
          {detail ? (
            <span className={cn('block truncate text-xs', done ? 'opacity-75' : 'text-content-muted')}>
              {detail}
            </span>
          ) : null}
        </span>
        {startMark ? (
          <span
            className="shrink-0 rounded-control bg-accent px-3 py-1 text-xs font-semibold text-accent-contrast"
          >
            {startMark}
          </span>
        ) : (
          <ChevronRight size={18} aria-hidden="true" className="shrink-0 opacity-60" />
        )}
      </>
    );
    const anchors = {
      'data-day-unit': unit.kind,
      'data-unit-state': unit.state,
      'data-plan-entry': unit.planEntryId,
      'data-plan-entry-state': entryState,
    };
    const ref = unit.ref;

    if (ref.type === 'session') {
      return (
        <Link key={key} to={`/history/session/${ref.sessionId}`} className={className} {...anchors}>
          {content}
        </Link>
      );
    }

    if (ref.type === 'run') {
      return (
        <Link key={key} to={`/runs/${ref.runId}`} className={className} {...anchors}>
          {content}
        </Link>
      );
    }

    if (ref.type === 'test') {
      return (
        <Link key={key} to="/tests" className={className} {...anchors}>
          {content}
        </Link>
      );
    }

    if (ref.type === 'active-session') {
      return (
        <Link key={key} to={`/session/${ref.sessionId}`} className={className} {...anchors}>
          {content}
        </Link>
      );
    }

    const entry = ref.entry;

    return (
      <button
        key={key}
        type="button"
        disabled={isStarting}
        className={className}
        {...anchors}
        onClick={() => {
          if (!isToday) {
            openEntry(entry, entry.date);
          } else if (entry.kind === 'workout') {
            void handleStart(entry);
          } else {
            setRunEntryId(entry.id);
            setRunSheetOpen(true);
          }
        }}
      >
        {content}
      </button>
    );
  }

  const weekLabel = `Woche ${describeWeekRange(week.start, week.end)}${
    week.programWeek ? ` · W${week.programWeek.number}` : ''
  }`;

  return (
    <section data-plan-week={fromDay} aria-label="Termine der Woche" className="space-y-3">
      <div className="min-w-0 px-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-content-muted">Termine</p>
        <p className="truncate text-sm font-semibold text-content">{weekLabel}</p>
      </div>

      {hasUnmigratedWeekdays ? (
        <Link
          to="/settings"
          data-plan-weekday-hint=""
          className="min-h-touch flex items-center justify-between gap-3 rounded-panel border border-line bg-surface px-4 py-3 text-sm text-content-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span className="min-w-0">
            Feste Wochentage noch nicht umgewandelt – in den Einstellungen umwandeln
          </span>
          <ChevronRight size={18} className="shrink-0 text-content-muted" aria-hidden="true" />
        </Link>
      ) : null}

      {week.days.map((day) => {
        const entryUnits = day.units.filter((unit) => unit.ref.type === 'entry');
        const canMove = !day.isToday && !day.isPast && entryUnits.length >= 2;

        return (
          <div key={day.key} data-plan-day={day.key} className="space-y-2">
            <div className="flex items-center gap-2 px-1">
              <p className="text-xs font-semibold text-content-muted">{formatRunDate(day.key)}</p>
              {day.isToday ? (
                <span className="rounded-control bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-contrast">
                  Heute
                </span>
              ) : null}
              {day.units.length === 0 ? (
                <span className="text-xs text-content-muted">frei</span>
              ) : null}
            </div>

            {day.units.map((unit, index) => {
              const entryIndex = entryUnits.indexOf(unit);
              const key = `${unit.planEntryId ?? unit.ref.type}-${index}`;
              const row = renderUnit(unit, day.isToday, key);

              if (!canMove || entryIndex < 0 || unit.ref.type !== 'entry') {
                return row;
              }

              const entry = unit.ref.entry;

              return (
                <div key={key} className="flex items-stretch gap-2">
                  {row}
                  <div className="flex shrink-0 gap-1">
                    <IconButton
                      label="Früher am Tag"
                      disabled={entryIndex === 0}
                      onClick={() => void handleMove(entry, -1)}
                    >
                      <ChevronUp size={18} aria-hidden="true" />
                    </IconButton>
                    <IconButton
                      label="Später am Tag"
                      disabled={entryIndex === entryUnits.length - 1}
                      onClick={() => void handleMove(entry, 1)}
                    >
                      <ChevronDown size={18} aria-hidden="true" />
                    </IconButton>
                  </div>
                </div>
              );
            })}

            {day.isToday ? (
              <Button variant="primary" size="md" fullWidth onClick={() => setNowSheetOpen(true)}>
                + Einheit
              </Button>
            ) : !day.isPast ? (
              <Button
                variant="ghost"
                size="md"
                fullWidth
                aria-label={`+ Termin am ${formatRunDate(day.key)} hinzufügen`}
                onClick={() => openEntry(undefined, day.key)}
              >
                + Termin
              </Button>
            ) : null}
          </div>
        );
      })}

      {actionError ? <Alert>{actionError}</Alert> : null}

      <Button variant="ghost" size="md" fullWidth onClick={() => setSeriesOpen(true)}>
        Serie anlegen
      </Button>

      <RunLogSheet
        open={runSheetOpen}
        initialPlanEntryId={runEntryId}
        onClose={() => setRunSheetOpen(false)}
      />
      <PlanEntrySheet
        open={entrySheetOpen}
        entry={editing}
        defaultDate={entryDefaultDate}
        onClose={() => setEntrySheetOpen(false)}
      />
      <PlanSeriesSheet
        open={seriesOpen}
        defaultStartDate={seriesStart}
        onClose={() => setSeriesOpen(false)}
      />
    </section>
  );
}
