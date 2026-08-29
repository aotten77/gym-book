import type { WorkoutTemplate } from '@/domain/models';
import { describeWeekKind } from '@/domain/program-plan';
import {
  countWeekProgress,
  ISO_WEEKDAYS,
  templatesOnWeekday,
  templatesWithoutSchedule,
  weekdayLongLabel,
  weekdayShortLabel,
  type CalendarDay,
  type CalendarWeekRow,
} from '@/domain/training-calendar';
import { formatShortDate } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Wann ist was dran - Programmwochen als Zeilen, Wochentage als Spalten.
 *
 * Das Raster *ist* zugleich die Wochenauswahl und hat den Chipstreifen ersetzt.
 * Zwei Bedienelemente für einen Zustand sind genau das Muster, an dem
 * `weekOverride` monatelang kaputt war; die Auswahl bleibt deshalb ephemer und
 * schreibt nichts - Woche 5 *ansehen* ist nicht Woche 5 *trainieren*.
 *
 * Zwei Entscheidungen tragen die Darstellung:
 *
 * - **Eine Zeile ist ein Tippziel, eine Zelle nicht.** Sieben 44px-Zellen
 *   passen bei 320px nicht nebeneinander (nutzbar sind 288px). Die Zeile hält
 *   die 44px, die Zellen sind Marken - damit braucht das Raster kein zweites,
 *   waagerechtes Scrollgebiet neben dem Seitenscroll.
 * - **Der Plan steht einmal unter dem Raster, nicht in jeder Zelle.** Der
 *   Wochenplan wiederholt sich in jeder Programmwoche gleich; in den Zeilen
 *   stünde er achtmal. Was die Wochen unterscheidet, ist der Zustand, und der
 *   gehört ins Raster.
 */
export function TrainingCalendar({
  rows,
  templates,
  selectedWeek,
  onSelectWeek,
}: {
  rows: CalendarWeekRow[];
  templates: WorkoutTemplate[];
  selectedWeek: number;
  onSelectWeek: (weekNumber: number) => void;
}) {
  const first = rows[0];
  const last = rows[rows.length - 1];
  const range =
    first?.start && last?.end
      ? `${formatShortDate(first.start)}–${formatShortDate(last.end)}`
      : undefined;
  const unscheduled = templatesWithoutSchedule(templates);

  return (
    <section
      data-training-calendar=""
      className="rounded-card border border-line bg-surface p-4 shadow-soft"
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.16em] text-content-muted">
          Trainingskalender
        </h2>
        {range ? (
          <p className="shrink-0 text-xs tabular-nums text-content-muted">{range}</p>
        ) : null}
      </div>

      {/*
        Die Spaltenköpfe stehen außerhalb der Tabliste: sie sind Beschriftung,
        kein Reiter, und ein `role="tab"` ohne Ziel wäre für die Sprachausgabe
        eine Sackgasse.
      */}
      <div
        aria-hidden="true"
        className="grid grid-cols-[2.25rem_repeat(7,minmax(0,1fr))] gap-1 px-1 pb-1"
      >
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

      <div role="tablist" aria-label="Programmwoche wählen" className="space-y-1">
        {rows.map((row) => (
          <CalendarWeekButton
            key={row.weekNumber}
            row={row}
            isSelected={row.weekNumber === selectedWeek}
            onSelect={() => onSelectWeek(row.weekNumber)}
          />
        ))}
      </div>

      <div className="mt-4 space-y-1 border-t border-line pt-3">
        {ISO_WEEKDAYS.map((day) => {
          const planned = templatesOnWeekday(templates, day);

          if (planned.length === 0) {
            return null;
          }

          return (
            <p key={day} className="text-sm text-content-secondary">
              <span className="font-semibold text-content">{weekdayShortLabel(day)}</span>
              {' · '}
              {planned.map((template) => template.name).join(', ')}
            </p>
          );
        })}

        {/*
          Workouts ohne Tag fallen nicht still heraus: ein Workout, das aus
          einer Übersicht verschwindet, ist der teuerste Fehler dieser Seite.
        */}
        {unscheduled.length > 0 ? (
          <p className="pt-1 text-sm text-content-muted">
            Ohne festen Tag: {unscheduled.map((template) => template.name).join(', ')}
          </p>
        ) : null}

        {templates.length > 0 && unscheduled.length === templates.length ? (
          <p className="pt-1 text-sm text-content-muted">
            Trage im Workout unter „Trainingstage“ ein, wann es ansteht.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function CalendarWeekButton({
  row,
  isSelected,
  onSelect,
}: {
  row: CalendarWeekRow;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const { planned, done } = countWeekProgress(row);
  const dateRange =
    row.start && row.end ? `${formatShortDate(row.start)}–${formatShortDate(row.end)}` : undefined;

  /*
   * Der zugängliche Name beginnt mit `W{n}`, damit die Wochenauswahl unter
   * demselben Namen erreichbar bleibt, unter dem sie es als Chip war. Die
   * Zellen selbst sind `aria-hidden` - 56 einzeln angesagte Marken sind für
   * eine Sprachausgabe kein Kalender, sondern Rauschen.
   */
  const labelParts = [`W${row.weekNumber}`];

  if (dateRange) {
    labelParts.push(dateRange);
  }

  if (row.isEffective) {
    labelParts.push('diese Woche');
  }

  if (row.kind) {
    labelParts.push(describeWeekKind(row.kind));
  }

  if (planned > 0 && row.start) {
    labelParts.push(`${done} von ${planned} erledigt`);
  } else if (planned > 0) {
    labelParts.push(planned === 1 ? '1 Einheit geplant' : `${planned} Einheiten geplant`);
  }

  return (
    <button
      type="button"
      role="tab"
      aria-selected={isSelected}
      data-calendar-week={row.weekNumber}
      aria-label={labelParts.join(' · ')}
      onClick={onSelect}
      className={cn(
        'min-h-touch grid w-full grid-cols-[2.25rem_repeat(7,minmax(0,1fr))] items-center gap-1 rounded-panel border px-1 py-1 transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        isSelected
          ? 'border-accent-border bg-surface-raised'
          : 'border-transparent hover:bg-surface-sunken',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex h-7 items-center justify-center rounded-control border font-display text-xs font-bold tabular-nums',
          isSelected
            ? 'border-transparent bg-accent text-accent-contrast'
            : row.isEffective
              ? // Die wirksame Woche, nur umrandet: die eine Limettenfläche
                // dieser Seite liegt auf der Karte darüber.
                'border-accent-border text-content'
              : 'border-transparent text-content-muted',
        )}
      >
        W{row.weekNumber}
      </span>

      {row.days.map((day) => (
        <CalendarDayCell key={day.isoWeekday} day={day} />
      ))}
    </button>
  );
}

/**
 * Eine Marke je Tag.
 *
 * `verpasst` ist gedämpft und hohl, ausdrücklich **nicht rot**: Rot bedeutet in
 * dieser App „übersprungen oder gelöscht“, und ein ausgefallener Montag ist
 * keins von beidem.
 */
function CalendarDayCell({ day }: { day: CalendarDay }) {
  const markerClasses: Record<CalendarDay['state'], string> = {
    leer: 'h-1.5 w-1.5 rounded-full bg-line-strong',
    geplant: 'h-4 w-4 rounded-full border-2 border-line-strong',
    verpasst: 'h-4 w-4 rounded-full border border-dashed border-content-muted',
    teilweise: 'h-4 w-4 rounded-full border-2 border-success',
    erledigt: 'h-4 w-4 rounded-full bg-success',
  };

  return (
    <span
      aria-hidden="true"
      data-calendar-day={day.isoWeekday}
      data-day-state={day.state}
      data-calendar-today={day.isToday ? '' : undefined}
      title={describeDayTitle(day)}
      className={cn(
        'flex h-7 items-center justify-center rounded-control',
        day.isToday && 'ring-2 ring-accent',
      )}
    >
      <span className={markerClasses[day.state]} />
    </span>
  );
}

/** Für die Maus - die Sprachausgabe bekommt die Zusammenfassung der Zeile. */
function describeDayTitle(day: CalendarDay): string {
  const names = day.planned.length > 0 ? day.planned : day.done;
  const label = day.date ? formatShortDate(day.date) : weekdayLongLabel(day.isoWeekday);

  return names.length === 0
    ? label
    : `${label} · ${names.map((template) => template.name).join(', ')}`;
}
