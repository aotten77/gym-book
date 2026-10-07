import { ChevronLeft, ChevronRight } from 'lucide-react';
import { UnitKindIcon } from '@/components/icons/UnitKindIcon';
import { IconButton } from '@/components/ui/Button';
import { describeWeekKind } from '@/domain/program-plan';
import {
  cellMarks,
  countWeekProgress,
  ISO_WEEKDAYS,
  weekdayShortLabel,
  type CalendarWeek,
  type CalendarWeekDay,
} from '@/domain/training-calendar';
import { formatShortDate } from '@/lib/format';
import { cn } from '@/lib/utils';

const GRID_COLUMNS = 'grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]';

/**
 * Wann ist was dran - Kalenderwochen als Zeilen, Wochentage als Spalten.
 *
 * Das Raster *ist* zugleich die Wochenauswahl. Zwei Bedienelemente für einen
 * Zustand sind genau das Muster, an dem `weekOverride` monatelang kaputt war;
 * die Auswahl bleibt deshalb ephemer und schreibt nichts - eine Woche
 * *ansehen* ist nicht, sie *trainieren*. Die Programmwoche ist nur eine
 * Beschriftung ("W3"), und es gibt sie nur mit `Program.startedOn`.
 *
 * - **Eine Zeile ist ein Tippziel, eine Zelle nicht.** Sieben 44px-Zellen
 *   passen bei 320px nicht nebeneinander; die Zeile hält die 44px, die Zellen
 *   sind Marken - damit braucht das Raster kein zweites Scrollgebiet.
 * - **Die Zellen sind Zustand, kein Plan.** Erledigt ist waldgrün gefüllt,
 *   geplant Tinte auf Weiß; keine Limette, kein Rot für vergangene Tage.
 */
export function TrainingCalendar({
  rows,
  selectedWeek,
  onSelectWeek,
  onShiftWindow,
}: {
  rows: CalendarWeek[];
  selectedWeek: string;
  onSelectWeek: (monday: string) => void;
  onShiftWindow: (direction: -1 | 1) => void;
}) {
  return (
    <section
      data-training-calendar=""
      className="rounded-card border border-line bg-surface p-4 shadow-soft"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.16em] text-content-muted">
          Trainingskalender
        </h2>
        <div className="flex shrink-0 gap-2">
          <IconButton label="Frühere Wochen" onClick={() => onShiftWindow(-1)}>
            <ChevronLeft size={18} aria-hidden="true" />
          </IconButton>
          <IconButton label="Spätere Wochen" onClick={() => onShiftWindow(1)}>
            <ChevronRight size={18} aria-hidden="true" />
          </IconButton>
        </div>
      </div>

      {/*
        Die Spaltenköpfe stehen außerhalb der Tabliste: sie sind Beschriftung,
        kein Reiter, und ein `role="tab"` ohne Ziel wäre für die Sprachausgabe
        eine Sackgasse.
      */}
      <div aria-hidden="true" className={cn('grid gap-1 px-1 pb-1', GRID_COLUMNS)}>
        <span />
        {ISO_WEEKDAYS.map((day) => (
          <span
            key={day}
            className="text-center text-[10px] font-bold uppercase tracking-[0.1em] text-content-muted"
          >
            {weekdayShortLabel(day)}
          </span>
        ))}
      </div>

      <div role="tablist" aria-label="Woche wählen" className="space-y-1">
        {rows.map((row) => (
          <CalendarWeekButton
            key={row.key}
            row={row}
            isSelected={row.key === selectedWeek}
            onSelect={() => onSelectWeek(row.key)}
          />
        ))}
      </div>
    </section>
  );
}

function CalendarWeekButton({
  row,
  isSelected,
  onSelect,
}: {
  row: CalendarWeek;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const { planned, done } = countWeekProgress(row);
  const programKind = row.programWeek?.kind ? describeWeekKind(row.programWeek.kind) : undefined;

  /*
   * Die Zellen selbst sind `aria-hidden` - 42 einzeln angesagte Marken sind für
   * eine Sprachausgabe kein Kalender, sondern Rauschen. Der Name der Zeile
   * trägt die Zusammenfassung.
   */
  const labelParts = [`${formatShortDate(row.start)}–${formatShortDate(row.end)}`];

  if (row.programWeek) {
    labelParts.push(
      programKind ? `W${row.programWeek.number} · ${programKind}` : `W${row.programWeek.number}`,
    );
  }

  if (row.isCurrent) {
    labelParts.push('diese Woche');
  }

  if (planned > 0) {
    labelParts.push(`${done} von ${planned} erledigt`);
  }

  return (
    <button
      type="button"
      role="tab"
      aria-selected={isSelected}
      data-calendar-week={row.key}
      aria-label={labelParts.join(' · ')}
      onClick={onSelect}
      className={cn(
        'min-h-touch grid w-full items-center gap-1 rounded-panel border px-1 py-1 transition',
        GRID_COLUMNS,
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        isSelected
          ? 'border-accent-border bg-surface-raised'
          : row.isCurrent
            ? 'border-line-strong hover:bg-surface-sunken'
            : 'border-transparent hover:bg-surface-sunken',
      )}
    >
      <span aria-hidden="true" className="min-w-0 text-left leading-tight">
        <span className="block font-display text-xs font-bold tabular-nums text-content">
          {formatShortDate(row.start)}
        </span>
        {row.programWeek ? (
          <span className="block text-[10px] text-content-muted">
            W{row.programWeek.number}
            {programKind ? ` · ${programKind}` : ''}
          </span>
        ) : null}
      </span>

      {row.days.map((day) => (
        <CalendarDayCell key={day.key} day={day} />
      ))}
    </button>
  );
}

const MARK_CIRCLE = 'flex h-6 w-6 items-center justify-center rounded-full';

/** Eine Zelle je Tag: höchstens zwei Marken untereinander, sonst eine und "+n". */
function CalendarDayCell({ day }: { day: CalendarWeekDay }) {
  const marks = cellMarks(day.units);

  return (
    <span
      aria-hidden="true"
      data-calendar-day={day.key}
      data-day-state={day.state}
      data-calendar-today={day.isToday ? '' : undefined}
      title={describeDayTitle(day)}
      className={cn(
        'flex min-h-7 flex-col items-center justify-center gap-0.5 rounded-control py-0.5',
        day.isToday && 'ring-2 ring-accent',
      )}
    >
      {marks.length === 0 ? (
        <span className="h-1.5 w-1.5 rounded-full bg-line-strong" />
      ) : (
        marks.map((mark, index) =>
          mark.type === 'more' ? (
            <span
              key={`more-${index}`}
              data-calendar-more=""
              className={cn(
                MARK_CIRCLE,
                'bg-surface-sunken text-[10px] font-bold text-content-secondary',
              )}
            >
              +{mark.count}
            </span>
          ) : (
            <span
              key={`${mark.unit.state}-${index}`}
              data-calendar-unit={mark.unit.kind}
              data-unit-state={mark.unit.state}
              className={cn(
                MARK_CIRCLE,
                mark.unit.state === 'erledigt'
                  ? 'bg-success text-success-contrast'
                  : 'border-2 border-accent bg-surface text-accent',
              )}
            >
              <UnitKindIcon kind={mark.unit.kind} size={17} />
            </span>
          )
        )
      )}
    </span>
  );
}

/** Für die Maus - die Sprachausgabe bekommt die Zusammenfassung der Zeile. */
function describeDayTitle(day: CalendarWeekDay): string {
  const label = formatShortDate(day.date);

  return day.units.length === 0
    ? label
    : `${label} · ${day.units.map((unit) => unit.name).join(', ')}`;
}
