import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import {
  describeTimelineDayHead,
  describeTimelineWeekHead,
  weekdayShortLabel,
  type CalendarWeek,
  type CalendarWeekDay,
} from '@/domain/training-calendar';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

interface TimelineWeekProps {
  week: CalendarWeek;
  /** Tap auf den Wochenkopf. Das Wochen-Sheet hängt sich hier an. */
  onOpenWeek: (key: string) => void;
  /**
   * Die Einheiten eines Tages. Heute gehört auch die Zeile „Heute trainieren“
   * dazu - welche Einheit was tut, entscheidet die Seite, nicht die Woche.
   */
  renderDay: (day: CalendarWeekDay) => ReactNode;
  /** Die geplanten Minuten eines Tages für seinen Kopf; `undefined`, wo sie nicht alle bekannt sind. */
  plannedMinutes?: (day: CalendarWeekDay) => number | undefined;
}

/**
 * Eine Woche im Zeitstrahl: ein klebender Kopf, darunter Montag bis Sonntag.
 *
 * Der Kopf klebt nur innerhalb seines Abschnitts, deshalb schiebt der nächste
 * ihn beim Scrollen hinaus, statt sich darüberzulegen. Freie Tage sind eine
 * dünne gestrichelte Zeile. Ein Tag mit Einheiten ist ein Kasten mit eigenem
 * Kopf, damit zusammensteht, was zu ihm gehört; heute ist er dunkel umrandet
 * wie der Kopf der laufenden Woche und steht immer da, auch leer.
 */
export function TimelineWeek({ week, onOpenWeek, renderDay, plannedMinutes }: TimelineWeekProps) {
  const head = describeTimelineWeekHead(week);
  const share = head.planned > 0 ? Math.min(1, head.done / head.planned) : 0;

  return (
    <section data-timeline-week={week.key} className="space-y-2">
      <button
        type="button"
        data-timeline-week-head=""
        data-current={week.isCurrent ? '' : undefined}
        aria-label={`${head.label} · Woche öffnen`}
        onClick={() => onOpenWeek(week.key)}
        className={cn(
          'sticky top-0 z-10 flex min-h-touch w-full min-w-0 items-center gap-3 rounded-panel bg-app px-3 py-2 text-left transition hover:bg-surface-raised',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-app',
          week.isCurrent ? 'border-2 border-accent' : 'border border-line',
        )}
      >
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-content">{head.title}</span>
        {head.planned > 0 ? (
          <span className="flex shrink-0 items-center gap-2">
            <span className="text-xs text-content-muted">
              {formatNumber(head.done)} von {formatNumber(head.planned)}
            </span>
            <span aria-hidden="true" className="block h-1.5 w-10 overflow-hidden rounded-full bg-surface-raised">
              <span className="block h-full bg-success" style={{ width: `${share * 100}%` }} />
            </span>
          </span>
        ) : null}
        <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-content-muted" />
      </button>

      {week.days.map((day) => {
        const weekday = weekdayShortLabel(day.isoWeekday);

        if (day.units.length === 0 && !day.isToday) {
          return (
            <div
              key={day.key}
              data-timeline-day={day.key}
              className="flex items-center gap-2 px-1 text-xs text-content-muted"
            >
              <span className="w-10 shrink-0 text-center font-semibold">{weekday}</span>
              <span aria-hidden="true" className="flex-1 border-t border-dashed border-line-strong" />
              <span>frei</span>
            </div>
          );
        }

        const dayHead = describeTimelineDayHead(day, plannedMinutes?.(day));

        return (
          <div
            key={day.key}
            data-timeline-day={day.key}
            data-timeline-today={day.isToday ? '' : undefined}
            className={cn(
              'rounded-[1.5rem] p-2',
              day.isToday ? 'scroll-mt-16 border-2 border-accent bg-app' : 'bg-surface-sunken',
            )}
          >
            <div
              data-timeline-day-head=""
              className="flex min-w-0 items-center justify-between gap-2 px-1.5 pb-2 pt-0.5"
            >
              <span
                className={cn(
                  'flex shrink-0 items-center gap-2 text-sm font-bold',
                  day.isToday ? 'text-content' : 'text-content-secondary',
                )}
              >
                {dayHead.title}
                {day.isToday ? (
                  <span className="rounded-full bg-accent px-2 text-xs font-semibold text-accent-contrast">heute</span>
                ) : null}
              </span>
              <span className="min-w-0 truncate text-xs text-content-muted">{dayHead.summary}</span>
            </div>
            <div className="flex min-w-0 flex-col gap-2">{renderDay(day)}</div>
          </div>
        );
      })}
    </section>
  );
}
