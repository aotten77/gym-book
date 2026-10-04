import { SectionCard } from '@/components/SectionCard';
import { DONE_SURFACE } from '@/components/ui/StatusCard';
import { isoWeekNumber } from '@/domain/calendar-week';
import { describeWeekVolume, hasTraining, type WeekVolume } from '@/domain/weekly-volume';
import { formatShortDate } from '@/lib/format';
import { cn } from '@/lib/utils';

interface WeeklyVolumeListProps {
  /** Neueste Woche zuerst. */
  weeks: WeekVolume[];
}

/**
 * Was pro Kalenderwoche trainiert wurde. Wochen mit Training stehen auf
 * Waldgrün - erledigt darf sich wiederholen; eine leere Woche bleibt neutral,
 * eine grüne Fläche über "Kein Training" würde einen Zustand behaupten, der
 * nicht vorliegt. Zeilen umbrechen, damit bei 320px nichts überläuft.
 */
export function WeeklyVolumeList({ weeks }: WeeklyVolumeListProps) {
  return (
    <SectionCard title="Wochen" subtitle="Kraft, Mobility und Laufen der letzten acht Wochen">
      <div className="space-y-3">
        {weeks.map((week) => {
          const start = week.weekStart;
          const sunday = new Date(start);

          sunday.setDate(sunday.getDate() + 6);

          const trained = hasTraining(week);
          const lines = describeWeekVolume(week);
          const rows: Array<[string, string | undefined]> = [
            ['Kraft', lines.strength],
            ['Mobility', lines.mobility],
            ['Laufen', lines.running],
          ];

          return (
            <div
              key={start.getTime()}
              data-week-volume
              className={cn(
                'min-w-0 break-words p-4',
                trained ? DONE_SURFACE : 'rounded-card bg-surface-raised text-content',
              )}
            >
              <p className={cn('text-[10px] font-bold uppercase tracking-[0.16em]', trained ? 'opacity-75' : 'text-content-muted')}>
                {`KW ${isoWeekNumber(start)} · ${formatShortDate(start)}–${formatShortDate(sunday)}`}
              </p>
              {trained ? (
                <div className="mt-2 space-y-1">
                  {rows.map(([name, line]) =>
                    line ? (
                      <p key={name} className="text-sm">
                        <span className="font-semibold">{name}</span>
                        <span className="opacity-75"> · {line}</span>
                      </p>
                    ) : null,
                  )}
                </div>
              ) : (
                <p className="mt-2 text-sm text-content-muted">Kein Training</p>
              )}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
