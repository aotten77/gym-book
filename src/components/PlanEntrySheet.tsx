import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { MarkdownText } from '@/components/MarkdownText';
import { Sheet } from '@/components/ui/Sheet';
import { db } from '@/db/appDb';
import { loadPlanBetween } from '@/db/plan-queries';
import type { PlanEntry } from '@/domain/models';
import { describeRunTarget, doneDayOf, planEntryName } from '@/domain/plan';
import { FROM_PLAN_STATE } from '@/lib/back-navigation';
import { parseMarkdownLite } from '@/lib/markdown-lite';
import { formatNumber, formatRunDate } from '@/lib/format';

interface PlanEntrySheetProps {
  open: boolean;
  entry?: PlanEntry;
  onClose: () => void;
}

/**
 * Die Anzeige eines Einzeltermins. Termine sind in der App nur lesbar: sie
 * kommen per Import aus dem Projekt, das Sheet zeigt Vorgabe und Notiz und
 * führt bei einem trainierten Termin zur Session bzw. zum Lauf.
 */
export function PlanEntrySheet({ open, entry, onClose }: PlanEntrySheetProps) {
  const templates = useLiveQuery(() => db.workoutTemplates.toArray(), []);
  const exerciseCount = useLiveQuery(
    async () =>
      entry?.templateId
        ? await db.workoutTemplateExercises.where('templateId').equals(entry.templateId).count()
        : undefined,
    [entry?.templateId],
  );
  /*
   * Das Ergebnis trägt die Id, für die es geladen wurde: beim Wechsel des
   * Termins liefert `useLiveQuery` bis zur neuen Antwort noch die alte.
   */
  const loadedPlan = useLiveQuery(
    async () =>
      entry
        ? { entryId: entry.id, plan: await loadPlanBetween(entry.date, entry.date) }
        : undefined,
    [entry?.id, entry?.date],
  );
  const entryPlan = entry && loadedPlan?.entryId === entry.id ? loadedPlan.plan : undefined;
  const link = entry ? entryPlan?.links[entry.id] : undefined;

  const templateNames = useMemo(
    () =>
      (templates ?? []).reduce<Record<string, string>>((names, template) => {
        names[template.id] = template.name;
        return names;
      }, {}),
    [templates],
  );
  const instructionBlocks = useMemo(
    () => (entry?.instructions ? parseMarkdownLite(entry.instructions) : []),
    [entry?.instructions],
  );

  const header = <h2 className="font-display text-xl font-bold text-content">Termin</h2>;

  /*
   * Der Termin wartet auf seine Verweise: ohne sie stünde für einen Augenblick
   * der offene Zustand da, auch wenn er längst trainiert ist.
   */
  if (!entry || entryPlan === undefined) {
    return null;
  }

  const runTarget = entry.kind === 'run' ? describeRunTarget(entry) : '';
  const templateExists = entry.templateId !== undefined && entry.templateId in templateNames;
  const doneDay = link ? doneDayOf(link) : undefined;
  /*
   * Eine laufende Session führt in die Session, nicht in den Verlauf - dort
   * steht sie erst, wenn sie abgeschlossen ist.
   */
  const target = !link
    ? undefined
    : link.source === 'run'
      ? `/runs/${link.sourceId}`
      : link.done
        ? `/history/session/${link.sourceId}`
        : `/session/${link.sourceId}`;

  return (
    <Sheet open={open} label="Termin" closeLabel="Termin schließen" header={header} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <p className="font-display text-lg font-bold text-content">
            {planEntryName(entry, templateNames, entryPlan.links)}
          </p>
          <p className="text-sm text-content-secondary">{formatRunDate(entry.date)}</p>
        </div>

        {entry.kind === 'run' ? (
          <>
            {runTarget ? <p className="text-sm text-content-secondary">{runTarget}</p> : null}
            {instructionBlocks.length > 0 ? (
              <MarkdownText blocks={instructionBlocks} className="text-[15px] text-content-secondary" />
            ) : null}
          </>
        ) : (
          <>
            {exerciseCount !== undefined ? (
              <p className="text-sm text-content-secondary">{exerciseCount === 1 ? '1 Übung' : `${formatNumber(exerciseCount)} Übungen`}</p>
            ) : null}
            {templateExists ? (
              <Link
                to={`/templates/${entry.templateId}`}
                className="min-h-touch inline-flex items-center rounded-control border border-line px-4 py-2 text-sm font-semibold text-content hover:bg-surface-raised"
              >
                Workout ansehen
              </Link>
            ) : null}
          </>
        )}

        {entry.notes ? (
          <p className="whitespace-pre-line text-sm text-content-secondary">{entry.notes}</p>
        ) : null}

        {link && target ? (
          <div className="space-y-3">
            <p className="text-sm text-content-secondary">
              {link.done ? `Erledigt am ${formatRunDate(doneDay ?? entry.date)}` : 'Läuft gerade'}
            </p>
            <Link
              to={target}
              // Nur die Detailseiten kennen den Rückweg zum Plan; die laufende Session nicht.
              state={target.startsWith('/session/') ? undefined : FROM_PLAN_STATE}
              className="min-h-touch inline-flex items-center rounded-control border border-line px-4 py-2 text-sm font-semibold text-content hover:bg-surface-raised"
            >
              {link.source === 'session' ? 'Zur Session' : 'Zum Lauf'}
            </Link>
          </div>
        ) : null}

        <p className="text-sm text-content-muted">Termine kommen per Import aus dem Projekt.</p>
      </div>
    </Sheet>
  );
}
