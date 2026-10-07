import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Alert } from '@/components/Alert';
import { RunIcon } from '@/components/icons/RunIcon';
import { UnitKindIcon } from '@/components/icons/UnitKindIcon';
import { Sheet } from '@/components/ui/Sheet';
import { db } from '@/db/appDb';
import { loadTemplateRecency } from '@/db/history-queries';
import { startSessionFromTemplate } from '@/db/session-actions';
import type { PlanEntry } from '@/domain/models';
import { toDateInputValue } from '@/domain/program';
import { buildTodayUnitOptions, type TodayUnitOption } from '@/domain/today-units';
import { formatRunDate } from '@/lib/format';

interface TodayUnitSheetProps {
  open: boolean;
  /** Die heute noch offenen Workout-Termine; sie stehen oben. */
  plannedToday: PlanEntry[];
  onClose: () => void;
  onLogRun: () => void;
}

const ROW_CLASSES =
  'flex min-h-[3.625rem] w-full items-center gap-3 rounded-control border border-line bg-surface-raised px-3 py-2 text-left hover:bg-surface disabled:opacity-60';

/**
 * „Heute trainieren": eine Einheit wählen, unabhängig vom Plan. Gestartet wird
 * ohne `planEntryId` - die Zuordnungsregel verknüpft einen passenden Termin
 * selbst. Jede Zeile ist ein Knopf; die Marke „Starten" ist nur Zierde.
 */
export function TodayUnitSheet({ open, plannedToday, onClose, onLogRun }: TodayUnitSheetProps) {
  const navigate = useNavigate();
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const templates = useLiveQuery(() => db.workoutTemplates.toArray(), []);
  const recency = useLiveQuery(() => loadTemplateRecency(), []);

  const today = new Date();
  const { planned, others } = buildTodayUnitOptions({
    templates: templates ?? [],
    plannedToday,
    recency: recency ?? {},
    today,
  });

  async function handleStart(templateId: string) {
    setIsStarting(true);

    try {
      const sessionId = await startSessionFromTemplate(templateId);
      setStartError(null);
      navigate(`/session/${sessionId}`);
    } catch (error) {
      setStartError(
        error instanceof Error ? error.message : 'Session konnte nicht gestartet werden.',
      );
      setIsStarting(false);
    }
  }

  function renderOption(option: TodayUnitOption, withStartMark: boolean) {
    return (
      <li key={option.templateId}>
        <button
          type="button"
          className={ROW_CLASSES}
          disabled={isStarting}
          onClick={() => void handleStart(option.templateId)}
        >
          <UnitKindIcon kind={option.kind} size={20} className="shrink-0 text-content-secondary" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold text-content">{option.name}</span>
            <span className="block truncate text-sm text-content-muted">{option.lastTrained}</span>
          </span>
          {withStartMark ? (
            <span className="shrink-0 rounded-control bg-accent px-3 py-1 text-sm font-semibold text-accent-contrast">
              Starten
            </span>
          ) : null}
        </button>
      </li>
    );
  }

  const header = (
    <div className="min-w-0">
      <h2 className="truncate font-display text-lg font-bold text-content">Heute trainieren</h2>
      <p className="truncate text-sm text-content-muted">
        {formatRunDate(toDateInputValue(today))} · unabhängig vom Plan
      </p>
    </div>
  );

  return (
    <Sheet open={open} label="Heute trainieren" closeLabel="Auswahl schließen" header={header} onClose={onClose}>
      <div className="space-y-4">
        {startError ? <Alert variant="error">{startError}</Alert> : null}

        {planned.length > 0 ? (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-content-muted">
              Geplant
            </h3>
            <ul className="space-y-2">{planned.map((option) => renderOption(option, true))}</ul>
          </section>
        ) : null}

        {others.length > 0 ? (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-content-muted">
              {planned.length > 0 ? 'Weitere Workouts' : 'Workouts'}
            </h3>
            <ul className="space-y-2">{others.map((option) => renderOption(option, false))}</ul>
          </section>
        ) : null}

        <button type="button" className={ROW_CLASSES} disabled={isStarting} onClick={onLogRun}>
          <RunIcon size={20} className="shrink-0 text-content-secondary" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate font-semibold text-content">Lauf eintragen</span>
        </button>
      </div>
    </Sheet>
  );
}
