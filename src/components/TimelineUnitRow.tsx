import { ChevronRight, Play } from 'lucide-react';
import { Link } from 'react-router-dom';
import { UnitKindIcon } from '@/components/icons/UnitKindIcon';
import { NowCard } from '@/components/ui/StatusCard';
import type { PlanEntryState } from '@/domain/plan';
import type { CalendarUnit } from '@/domain/training-calendar';
import { cn } from '@/lib/utils';

/**
 * Was ein Tap auf eine Termin-Einheit tut. `now` ist die eine Lime-Karte,
 * `start` ein weiterer offener Termin von heute, `view` öffnet nur die Anzeige
 * (ein künftiger Termin, oder ein heutiger, solange eine Session läuft).
 */
export type TimelineEntryAction = 'now' | 'start' | 'view';

interface TimelineUnitRowProps {
  unit: CalendarUnit;
  /** Die Detailzeile aus `describeCalendarUnitDetail`. */
  detail: string;
  /** Der Zustand des Termins hinter der Einheit, wo es einen gibt. */
  entryState?: PlanEntryState;
  /** Nur bei Termin-Einheiten (`ref.type === 'entry'`). */
  action?: TimelineEntryAction;
  disabled?: boolean;
  /** Start bzw. Anzeige einer Termin-Einheit; alles andere ist ein Link. */
  onActivate?: () => void;
}

const ROW_BASE =
  'flex min-h-[3.625rem] w-full min-w-0 items-center gap-3 rounded-panel px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-app disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Eine Einheit im Zeitstrahl, in jedem ihrer Zustände.
 *
 * Erledigt ist Waldgrün und führt in den Verlauf, die belegte Einheit einer
 * laufenden Session führt in die Session zurück (ohne `openFocus`: eine
 * Rückkehr, kein Start), die erste offene von heute ist die Lime-Karte. Die
 * Anker tragen dieselben Namen wie in `PlanWeekSection`, damit die Selektoren
 * der Tests mitwandern.
 */
export function TimelineUnitRow({
  unit,
  detail,
  entryState,
  action,
  disabled,
  onActivate,
}: TimelineUnitRowProps) {
  const anchors = {
    'data-day-unit': unit.kind,
    'data-unit-state': unit.state,
    'data-plan-entry': unit.planEntryId,
    'data-plan-entry-state': entryState,
  };
  const done = unit.state === 'erledigt';
  const ref = unit.ref;
  const startLabel = unit.kind === 'run' ? 'Eintragen' : 'Start';

  if (ref.type === 'entry' && action === 'now') {
    /*
      Das eine Limettenfeld des Screens. Die Karte ist selbst der Knopf, die
      Marke darin ist Zierde in Tinte - ein Knopf im Knopf wäre ungültig.
    */
    return (
      <div data-now-unit="" {...anchors}>
        <NowCard
          eyebrow="Jetzt dran"
          title={unit.name}
          label={`Heute · ${unit.name}`}
          subtitle={detail || undefined}
          onClick={onActivate}
          disabled={disabled}
          action={
            <span className="flex h-11 items-center gap-1.5 rounded-control bg-accent px-3 text-sm font-semibold text-accent-contrast">
              <Play size={16} aria-hidden="true" fill="currentColor" />
              {startLabel}
            </span>
          }
        />
      </div>
    );
  }

  const className = cn(ROW_BASE, done ? 'bg-success text-success-contrast' : 'border border-line bg-surface');
  const content = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
          done ? 'bg-success-contrast/15' : 'border-2 border-accent text-content',
        )}
      >
        <UnitKindIcon kind={unit.kind} size={18} />
      </span>
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
      {ref.type === 'entry' && action === 'start' ? (
        <span className="shrink-0 text-sm font-semibold text-content">{startLabel}</span>
      ) : (
        <ChevronRight size={18} aria-hidden="true" className="shrink-0 opacity-60" />
      )}
    </>
  );

  if (ref.type === 'session') {
    return (
      <Link to={`/history/session/${ref.sessionId}`} className={className} {...anchors}>
        {content}
      </Link>
    );
  }

  if (ref.type === 'run') {
    return (
      <Link to={`/runs/${ref.runId}`} className={className} {...anchors}>
        {content}
      </Link>
    );
  }

  if (ref.type === 'test') {
    return (
      <Link to="/tests" className={className} {...anchors}>
        {content}
      </Link>
    );
  }

  if (ref.type === 'active-session') {
    return (
      <Link to={`/session/${ref.sessionId}`} className={className} {...anchors}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" disabled={disabled} onClick={onActivate} className={className} {...anchors}>
      {content}
    </button>
  );
}
