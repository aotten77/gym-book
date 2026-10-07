import { UnitKindIcon } from '@/components/icons/UnitKindIcon';
import { describeWeekVolume, type WeekVolume } from '@/domain/weekly-volume';
import type { CalendarUnitKind } from '@/domain/training-calendar';

const TILES: { kind: CalendarUnitKind; title: string; key: 'strength' | 'mobility' | 'running' }[] = [
  { kind: 'strength', title: 'Kraft', key: 'strength' },
  { kind: 'mobility', title: 'Mobility', key: 'mobility' },
  { kind: 'run', title: 'Laufen', key: 'running' },
];

/**
 * Die Wochenzahlen der gewählten Woche - dieselbe Rechnung wie Verlauf und
 * Home (`describeWeekVolume`). Neutral weiß: Zahlen sind kein Zustand.
 *
 * Einspaltig bis 480px: die Texte ("1 Einheit · 0:52 h · 4.210 kg · 12 Sätze")
 * passen bei 320px nicht dreispaltig.
 */
export function WeekVolumeTiles({ week, weekKey }: { week?: WeekVolume; weekKey?: string }) {
  const texts = week ? describeWeekVolume(week) : {};

  return (
    <section
      data-week-volume={weekKey ?? ''}
      className="rounded-card border border-line bg-surface p-4 shadow-soft"
    >
      <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.16em] text-content-muted">
        Wochenzahlen
      </h2>
      <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-3">
        {TILES.map((tile) => (
          <div key={tile.key} className="min-w-0 rounded-panel bg-surface-raised px-3 py-2">
            <p className="flex items-center gap-1.5 text-xs font-bold text-content-secondary">
              <UnitKindIcon kind={tile.kind} size={15} />
              {tile.title}
            </p>
            <p className="mt-0.5 text-sm text-content">{texts[tile.key] ?? '–'}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
