import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { SupersetBlock } from '@/components/SupersetBlock';
import {
  describeWeekPrescription,
  type PrescriptionSegment,
  type WeekPlanBlock,
  type WeekPlanEntry,
} from '@/domain/program-plan';
import { splitWeekPlanEntries } from '@/domain/week-sheet';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

interface WeekPrescriptionBlockProps {
  block: WeekPlanBlock;
  /** Die Tage der Termine in der Woche, z. B. `Mo · erledigt, Do`. */
  days: string;
  bandNameById: Record<string, string>;
  /** Die Programmwoche, aus der die überschriebenen Werte kommen. */
  programWeekNumber: number;
}

/**
 * Die Vorgaben eines Workouts für die gezeigte Woche - nur zum Lesen.
 *
 * Offen stehen die Zeilen, die die Wochenregel überschreibt; der Rest klappt
 * ein, denn er ist in jeder Woche gleich und stünde sonst als Wand aus
 * Basiswerten da. Aufgeklappt kommen alle Zeilen in der Reihenfolge des
 * Workouts. Die Auswahl ist ephemer je Block.
 */
export function WeekPrescriptionBlock({
  block,
  days,
  bandNameById,
  programWeekNumber,
}: WeekPrescriptionBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const { shown, hidden } = splitWeekPlanEntries(block.entries);
  const visible = expanded ? block.entries : shown;
  /*
   * Supersätze bleiben sichtbar zusammen: `buildWeekPlan` liefert die
   * Mitglieder zusammenhängend, hier werden aufeinanderfolgende Einträge
   * derselben Gruppe unter eine Klammer gelegt - dieselbe wie in der
   * Workout-Liste.
   */
  const groups: WeekPlanEntry[][] = [];

  for (const entry of visible) {
    const previous = groups[groups.length - 1];
    const belongsToPrevious =
      entry.supersetGroupId !== undefined &&
      previous?.[0]?.supersetGroupId === entry.supersetGroupId &&
      previous[previous.length - 1].orderIndex + 1 === entry.orderIndex;

    if (belongsToPrevious) {
      previous.push(entry);
    } else {
      groups.push([entry]);
    }
  }

  const disclosureLabel =
    shown.length === 0
      ? `alle ${formatNumber(hidden.length)} Übungen wie im Workout`
      : `+ ${formatNumber(hidden.length)} weitere wie im Workout`;

  return (
    <section
      data-week-prescription={block.templateId}
      className="rounded-card border border-line bg-surface p-3"
    >
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="min-w-0 truncate text-base font-semibold text-content">{block.templateName}</h3>
        {days ? <p className="shrink-0 text-xs text-content-muted">{days}</p> : null}
      </div>

      {block.entries.length === 0 ? (
        <p className="text-sm text-content-muted">In diesem Workout steht noch keine Übung.</p>
      ) : (
        <div className="space-y-2">
          {groups.map((group) =>
            group.length > 1 && group[0].supersetGroupId ? (
              <SupersetBlock key={group[0].templateExerciseId} exerciseNames={group.map((entry) => entry.exerciseName)}>
                {group.map((entry) => (
                  <PrescriptionRow
                    key={entry.templateExerciseId}
                    entry={entry}
                    bandNameById={bandNameById}
                    programWeekNumber={programWeekNumber}
                  />
                ))}
              </SupersetBlock>
            ) : (
              <PrescriptionRow
                key={group[0].templateExerciseId}
                entry={group[0]}
                bandNameById={bandNameById}
                programWeekNumber={programWeekNumber}
              />
            ),
          )}

          {hidden.length > 0 ? (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((current) => !current)}
              className="flex min-h-touch w-full items-center justify-between gap-2 rounded-panel px-3 text-left text-sm text-content-secondary transition hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span className="min-w-0">{disclosureLabel}</span>
              <ChevronDown
                size={18}
                aria-hidden="true"
                className={cn('shrink-0 text-content-muted transition', expanded && 'rotate-180')}
              />
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}

function PrescriptionRow({
  entry,
  bandNameById,
  programWeekNumber,
}: {
  entry: WeekPlanEntry;
  bandNameById: Record<string, string>;
  programWeekNumber: number;
}) {
  const segments = describeWeekPrescription(entry, bandNameById);

  return (
    <div data-week-row="" className="w-full rounded-panel border border-line bg-surface-sunken px-3 py-2 text-left">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-semibold text-content">{entry.exerciseName}</p>
        {entry.overriddenFields.length > 0 ? (
          /*
            Neutral, nicht limette und nicht waldgrün: "kommt aus dieser
            Woche" ist keiner der drei Zustände, die Farbe in dieser App
            bedeutet.
          */
          <span
            data-rule-badge=""
            className="shrink-0 rounded-control border border-line-strong px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-content-secondary"
          >
            W{formatNumber(programWeekNumber)}
          </span>
        ) : null}
      </div>
      <p className="mt-0.5 text-sm">
        {segments.map((segment, index) => (
          <PrescriptionSegmentText key={segment.text} segment={segment} isFirst={index === 0} />
        ))}
      </p>
    </div>
  );
}

/** Basiswert gedämpft, Wochenwert in Tinte - der Unterschied je Feld. */
function PrescriptionSegmentText({ segment, isFirst }: { segment: PrescriptionSegment; isFirst: boolean }) {
  return (
    <>
      {isFirst ? null : <span className="text-content-muted"> · </span>}
      <span className={cn('tabular-nums', segment.overridden ? 'font-semibold text-content' : 'text-content-muted')}>
        {segment.text}
      </span>
    </>
  );
}
