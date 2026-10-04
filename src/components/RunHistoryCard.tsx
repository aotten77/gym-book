import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { RunIcon } from '@/components/icons/RunIcon';
import { ProgressChart } from '@/components/ProgressChart';
import { SectionCard } from '@/components/SectionCard';
import type { RunLog } from '@/domain/models';
import { formatPace, formatRunDuration, paceSecondsPerKm } from '@/domain/run';
import { formatNumber, formatRunDate } from '@/lib/format';

interface RunHistoryCardProps {
  runs: RunLog[];
}

export function RunHistoryCard({ runs }: RunHistoryCardProps) {
  const sorted = useMemo(
    () => [...runs].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    [runs],
  );
  const points = useMemo(
    () =>
      [...sorted].reverse().flatMap((run) => {
        const pace = paceSecondsPerKm(run.distanceKm, run.durationSeconds);

        return pace === undefined
          ? []
          : [{ completedAt: `${run.date}T12:00:00`, topValue: pace, volume: 0, setCount: 1 }];
      }),
    [sorted],
  );

  return (
    <SectionCard title="Läufe" subtitle={runs.length === 1 ? '1 Lauf' : `${runs.length} Läufe`}>
      <div className="space-y-3">
        {points.length > 0 ? (
          <ProgressChart points={points} unit="/km" label="Pace" formatValue={formatPace} lowerIsBetter />
        ) : null}

        {sorted.map((run) => {
          const pace = paceSecondsPerKm(run.distanceKm, run.durationSeconds);

          return (
            <Link
              key={run.id}
              to={`/runs/${run.id}`}
              className="flex min-h-touch items-center gap-3 rounded-panel bg-surface-raised px-4 py-3 transition hover:bg-surface-sunken"
            >
              <RunIcon size={20} className="shrink-0 text-success" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-content">
                  {formatRunDate(run.date)} · {formatNumber(run.distanceKm)} km
                </p>
                <p className="text-sm text-content-muted">
                  {[
                    formatRunDuration(run.durationSeconds),
                    pace === undefined ? undefined : `${formatPace(pace)} /km`,
                    typeof run.averageHeartRate === 'number'
                      ? `Ø ${formatNumber(run.averageHeartRate)} bpm`
                      : undefined,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </SectionCard>
  );
}
