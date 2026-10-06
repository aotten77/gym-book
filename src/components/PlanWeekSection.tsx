import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Dumbbell } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Empty } from '@/components/Empty';
import { PlanEntrySheet } from '@/components/PlanEntrySheet';
import { PlanSeriesSheet } from '@/components/PlanSeriesSheet';
import { RunIcon } from '@/components/icons/RunIcon';
import { Button, IconButton } from '@/components/ui/Button';
import { DoneRow } from '@/components/ui/StatusCard';
import { db } from '@/db/appDb';
import { countTemplatesWithWeekdays } from '@/db/data-fix-actions';
import { movePlanEntryInDay } from '@/db/plan-actions';
import { loadPlanBetween } from '@/db/plan-queries';
import type { PlanEntry } from '@/domain/models';
import { describeRunTarget, planEntryName, planEntryState } from '@/domain/plan';
import { toDateInputValue } from '@/domain/program';
import { formatRunDate } from '@/lib/format';
import { cn } from '@/lib/utils';

interface PlanWeekSectionProps {
  weekStart: Date;
  /** Nur gesetzt, wenn keine Programmwoche die Woche bestimmt. */
  onShiftWeek?: (delta: -1 | 1) => void;
}

function weekEnd(weekStart: Date): Date {
  const end = new Date(weekStart.getTime());

  end.setDate(end.getDate() + 6);

  return end;
}

/**
 * Die Termine einer Kalenderwoche, nach Tagen gruppiert. Anlegen, bearbeiten,
 * verschieben und Serien laufen über Sheets; die Zeile ist das Tippziel.
 */
export function PlanWeekSection({ weekStart, onShiftWeek }: PlanWeekSectionProps) {
  const fromDay = toDateInputValue(weekStart);
  const toDay = toDateInputValue(weekEnd(weekStart));
  const todayKey = toDateInputValue(new Date());
  // Heute, wenn es in der Woche liegt, sonst deren Montag - für Termin *und*
  // Serie: eine Serie ab Montag legte mittwochs zwei Termine in die Vergangenheit.
  const defaultDate = todayKey >= fromDay && todayKey <= toDay ? todayKey : fromDay;

  const [editing, setEditing] = useState<PlanEntry | undefined>(undefined);
  const [entrySheetOpen, setEntrySheetOpen] = useState(false);
  const [seriesOpen, setSeriesOpen] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);

  const plan = useLiveQuery(() => loadPlanBetween(fromDay, toDay), [fromDay, toDay]);
  const templates = useLiveQuery(() => db.workoutTemplates.toArray(), []);
  const templateNames = useMemo(
    () =>
      (templates ?? []).reduce<Record<string, string>>((names, template) => {
        names[template.id] = template.name;
        return names;
      }, {}),
    [templates],
  );

  /*
   * Solange ein Workout noch feste Wochentage trägt, fehlen deren Termine hier -
   * die Umwandlung ist eine Datenkorrektur in den Einstellungen, kein `upgrade()`.
   * Ohne diesen Hinweis sähe ein leerer Plan aus wie "nichts geplant".
   */
  const templatesWithWeekdays = useLiveQuery(() => countTemplatesWithWeekdays(), []);
  const hasUnmigratedWeekdays = (templatesWithWeekdays ?? 0) > 0;

  const entries = plan?.entries ?? [];
  const links = plan?.links ?? {};
  const days = useMemo(() => {
    const byDay = new Map<string, PlanEntry[]>();

    for (const entry of plan?.entries ?? []) {
      byDay.set(entry.date, [...(byDay.get(entry.date) ?? []), entry]);
    }

    return [...byDay.entries()];
  }, [plan]);

  function openEntry(entry: PlanEntry | undefined) {
    setEditing(entry);
    setEntrySheetOpen(true);
  }

  async function handleMove(entry: PlanEntry, direction: -1 | 1) {
    setMoveError(null);

    try {
      await movePlanEntryInDay(entry.id, direction);
    } catch (error) {
      setMoveError(error instanceof Error ? error.message : 'Der Termin ließ sich nicht verschieben.');
    }
  }

  const rangeLabel = `${formatRunDate(fromDay)} – ${formatRunDate(toDay)}`;

  return (
    <section data-plan-week={fromDay} aria-label="Termine der Woche" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        {onShiftWeek ? (
          <IconButton label="Vorherige Woche" onClick={() => onShiftWeek(-1)}>
            <ChevronLeft size={20} aria-hidden="true" />
          </IconButton>
        ) : null}
        <div className="min-w-0 flex-1 px-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-content-muted">
            Termine
          </p>
          <p className="truncate text-sm font-semibold text-content">{rangeLabel}</p>
        </div>
        {onShiftWeek ? (
          <IconButton label="Nächste Woche" onClick={() => onShiftWeek(1)}>
            <ChevronRight size={20} aria-hidden="true" />
          </IconButton>
        ) : null}
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

      {entries.length === 0 ? (
        <Empty
          title="Keine Termine in dieser Woche"
          description="Lege einen Termin an oder eine Serie für mehrere Wochen."
        />
      ) : (
        days.map(([date, dayEntries]) => (
          <div key={date} data-plan-day={date} className="space-y-2">
            <p className="px-1 text-xs font-semibold text-content-muted">{formatRunDate(date)}</p>
            {dayEntries.map((entry, index) => {
              const state = planEntryState(entry.id, links);
              const name = planEntryName(entry, templateNames, links);
              const detail =
                entry.kind === 'run' ? describeRunTarget(entry) || entry.notes : entry.notes;
              const Icon = entry.kind === 'run' ? RunIcon : Dumbbell;
              const canMove = dayEntries.length >= 2 && state === 'offen';

              return (
                <div
                  key={entry.id}
                  data-plan-entry={entry.id}
                  data-plan-entry-state={state}
                  className="flex items-stretch gap-2"
                >
                  <button
                    type="button"
                    onClick={() => openEntry(entry)}
                    className="min-h-touch min-w-0 flex-1 rounded-panel text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {state === 'erledigt' ? (
                      <DoneRow
                        title={name}
                        meta={entry.kind === 'run' ? detail : undefined}
                        icon={<Icon size={18} aria-hidden="true" />}
                      />
                    ) : (
                      <span
                        className={cn(
                          'flex min-h-touch items-center gap-2.5 rounded-panel border border-line bg-surface px-4 py-3',
                        )}
                      >
                        <Icon size={18} className="shrink-0 text-content-secondary" aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-content">
                            {name}
                          </span>
                          {detail ? (
                            <span className="block truncate text-xs text-content-muted">{detail}</span>
                          ) : null}
                        </span>
                        {state === 'belegt' ? (
                          <span className="shrink-0 text-xs text-content-muted">Läuft</span>
                        ) : null}
                      </span>
                    )}
                  </button>
                  {canMove ? (
                    <div className="flex shrink-0 gap-1">
                      <IconButton
                        label="Früher am Tag"
                        disabled={index === 0}
                        onClick={() => void handleMove(entry, -1)}
                      >
                        <ChevronUp size={18} aria-hidden="true" />
                      </IconButton>
                      <IconButton
                        label="Später am Tag"
                        disabled={index === dayEntries.length - 1}
                        onClick={() => void handleMove(entry, 1)}
                      >
                        <ChevronDown size={18} aria-hidden="true" />
                      </IconButton>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))
      )}

      {moveError ? (
        <p role="alert" className="text-sm text-danger">
          {moveError}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Button variant="primary" size="md" onClick={() => openEntry(undefined)}>
          Termin hinzufügen
        </Button>
        <Button variant="ghost" size="md" onClick={() => setSeriesOpen(true)}>
          Serie anlegen
        </Button>
      </div>

      <PlanEntrySheet
        open={entrySheetOpen}
        entry={editing}
        defaultDate={defaultDate}
        onClose={() => setEntrySheetOpen(false)}
      />
      <PlanSeriesSheet
        open={seriesOpen}
        defaultStartDate={defaultDate}
        onClose={() => setSeriesOpen(false)}
      />
    </section>
  );
}
