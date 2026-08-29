import {
  ISO_WEEKDAYS,
  normalizeScheduledWeekdays,
  weekdayLongLabel,
  weekdayShortLabel,
  type IsoWeekday,
} from '@/domain/training-calendar';
import { cn } from '@/lib/utils';

/**
 * Die Wochentage eines Workouts - sieben Umschalter in einer Reihe.
 *
 * Kein `SelectField` mit Mehrfachauswahl: die Frage ist "welche Tage", die
 * Antwort sind ein bis drei Tippser, und ein natives Mehrfach-Select ist auf
 * dem Telefon genau das, was diese App sonst meidet. `aria-pressed` statt
 * Checkboxen, weil die Beschriftung im Knopf selbst steht.
 *
 * Vier Spalten und nicht sieben: bei 320px bleiben in der Karte rund 256px,
 * und sieben Knöpfe nebeneinander wären keine 33px breit. Die 44px-Regel gilt
 * in beiden Richtungen, also bricht die Woche nach dem Donnerstag um. Das
 * Raster im Kalender kann sich sieben Spalten leisten, weil dort die *Zeile*
 * das Tippziel ist und die Tage nur Marken sind.
 */
export function WeekdayPicker({
  value,
  onChange,
  disabled,
}: {
  value: number[];
  onChange: (next: IsoWeekday[]) => void;
  disabled?: boolean;
}) {
  const selected = normalizeScheduledWeekdays(value) ?? [];

  function toggle(day: IsoWeekday) {
    const next = selected.includes(day)
      ? selected.filter((entry) => entry !== day)
      : [...selected, day];

    onChange(normalizeScheduledWeekdays(next) ?? []);
  }

  return (
    <div>
      <p className="mb-2 text-sm font-medium text-content">Trainingstage</p>
      <div className="grid grid-cols-4 gap-2" role="group" aria-label="Trainingstage">
        {ISO_WEEKDAYS.map((day) => {
          const isSelected = selected.includes(day);

          return (
            <button
              key={day}
              type="button"
              aria-pressed={isSelected}
              aria-label={weekdayLongLabel(day)}
              disabled={disabled}
              onClick={() => toggle(day)}
              className={cn(
                'min-h-touch min-w-touch rounded-control border font-display text-sm font-bold transition',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                'disabled:opacity-50',
                isSelected
                  ? 'border-transparent bg-accent text-accent-contrast'
                  : 'border-line bg-surface text-content-secondary hover:bg-surface-raised',
              )}
            >
              <span aria-hidden="true">{weekdayShortLabel(day)}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-content-muted">
        {selected.length === 0
          ? 'Ohne festen Tag - das Workout steht im Kalender unter „Ohne festen Tag“.'
          : `Steht im Kalender an ${selected.map(weekdayLongLabel).join(', ')}.`}
      </p>
    </div>
  );
}
