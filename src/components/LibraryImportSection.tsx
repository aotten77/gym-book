import { useRef, useState, type ChangeEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronDown, ChevronUp, FileJson, Upload } from 'lucide-react';
import { Alert } from '@/components/Alert';
import { SectionCard } from '@/components/SectionCard';
import { Button } from '@/components/ui/Button';
import { TextArea } from '@/components/ui/Field';
import { db } from '@/db/appDb';
import { applyLibraryImport, buildLibraryImportPlan } from '@/db/library-import-actions';
import {
  parseLibraryImportPayload,
  planHasChanges,
  type ImportEntryKind,
  type LibraryImportPayload,
  type LibraryImportPlan,
} from '@/domain/library-import';
import { exportDatabaseSnapshot } from '@/lib/export';
import { cn } from '@/lib/utils';
import { formatDateTime, formatNumber } from '@/lib/format';

/**
 * Übungen, Workouts, Zuordnungen, Bänder und Termine aus einer JSON-Datei.
 *
 * Zwei Wege hinein, weil zwei Geräte gemeint sind: am Rechner die Datei, auf
 * dem iPhone der eingefügte Text - dort ist die Datei-Auswahl einer
 * Homescreen-App der umständlichere Weg.
 *
 * Geschrieben wird erst nach der Vorschau. Ein Import, der eine bestehende
 * Übung anfasst, ohne dass vorher jemand gelesen hat *was* er ändert, ist auf
 * Daten, die es nur einmal gibt, keine Zumutung, die sich lohnt.
 */

const KIND_LABELS: Record<ImportEntryKind, string> = {
  new: 'NEU',
  update: 'AKTUALISIERT',
  unchanged: 'UNVERÄNDERT',
  removed: 'ENTFERNT',
};

interface PreviewRow {
  key: string;
  kind: ImportEntryKind;
  label: string;
  detail?: string;
  note?: string;
  changes: Array<{ field: string; from: string; to: string }>;
  /** Auch zwischen den unveränderten sichtbar - belegte Termine, die die Datei nicht ändern kann. */
  pinned?: boolean;
}

function toRows(plan: LibraryImportPlan) {
  return [
    {
      title: 'Übungen',
      rows: plan.exercises.map((entry): PreviewRow => ({
        key: `e-${entry.id}`,
        kind: entry.kind,
        label: entry.label,
        note: entry.note,
        changes: entry.changes,
      })),
    },
    {
      title: 'Workouts',
      rows: plan.templates.map((entry): PreviewRow => ({
        key: `t-${entry.id}`,
        kind: entry.kind,
        label: entry.label,
        note: entry.note,
        changes: entry.changes,
      })),
    },
    {
      title: 'Zuordnungen',
      rows: plan.assignments.map((entry): PreviewRow => ({
        key: `a-${entry.id}`,
        kind: entry.kind,
        label: entry.exerciseName,
        detail: entry.templateName,
        note: entry.note,
        changes: entry.changes,
      })),
    },
    {
      title: 'Termine',
      rows: plan.planEntries.map((entry): PreviewRow => ({
        key: `p-${entry.id}`,
        kind: entry.kind,
        label: entry.label,
        // Belegt heißt: Geschichte. Die Datei kann ihn weder ändern noch entfernen.
        note: entry.taken ? 'erledigt, bleibt' : undefined,
        changes: entry.changes,
        pinned: entry.taken,
      })),
    },
    {
      title: 'Bänder',
      rows: plan.bandLevels.map((entry): PreviewRow => ({
        key: `b-${entry.id}`,
        kind: entry.kind,
        label: entry.label,
        note: entry.note,
        changes: entry.changes,
      })),
    },
  ].filter((group) => group.rows.length > 0);
}

/**
 * Der Satz über der Vorschau. Sie ist die einzige Bestätigung vor dem
 * Schreiben - sagt sie "nichts gelöscht", während darunter eine Zeile rot
 * steht, bestätigt man das Falsche.
 */
function describePreviewIntro(plan: LibraryImportPlan, hasChanges: boolean) {
  if (!hasChanges) {
    return 'Alles steht schon so in der Datenbank - ein Import würde nichts ändern.';
  }

  const removed = plan.summary.removedAssignments;
  const removedEntries = plan.summary.removedPlanEntries;

  if (removed === 0 && removedEntries === 0) {
    return 'Es wird nichts gelöscht. Bestehende Einträge behalten ihre Position; genannt werden nur die Felder aus der Datei.';
  }

  const parts: string[] = [];

  if (removed > 0) {
    const count =
      removed === 1
        ? '1 Zuordnung wird entfernt'
        : `${formatNumber(removed)} Zuordnungen werden entfernt`;

    parts.push(
      `${count}, samt ihrer Wochenregeln. Ersetzte Workouts übernehmen Reihenfolge und Supersätze aus der Datei; Werte, die die Datei nicht nennt, bleiben stehen.`,
    );
  }

  if (removedEntries > 0) {
    const count =
      removedEntries === 1
        ? '1 offener Termin im Zeitraum fehlt in der Datei und wird entfernt.'
        : `${formatNumber(removedEntries)} offene Termine im Zeitraum fehlen in der Datei und werden entfernt.`;

    parts.push(`${count} Erledigte Termine bleiben.`);
  }

  return parts.join(' ');
}

function PreviewGroup({ title, rows }: { title: string; rows: PreviewRow[] }) {
  const [showUnchanged, setShowUnchanged] = useState(false);
  const changed = rows.filter((row) => row.kind !== 'unchanged');
  const unchanged = rows.filter((row) => row.kind === 'unchanged' && !row.pinned);
  const visible = showUnchanged
    ? rows
    : rows.filter((row) => row.kind !== 'unchanged' || row.pinned);

  return (
    <div className="rounded-panel border border-line bg-surface p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-content-muted">
        {title} · {formatNumber(changed.length)} von {formatNumber(rows.length)}
      </p>

      {visible.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {visible.map((row) => (
            <li key={row.key} className="text-sm">
              <p className="flex flex-wrap items-baseline gap-x-2 text-content">
                {/* Rot heißt in dieser App "gelöscht" - genau das passiert hier. */}
                <span
                  className={cn(
                    'text-xs uppercase tracking-[0.14em]',
                    row.kind === 'unchanged' && 'text-content-muted',
                    row.kind === 'removed' && 'text-danger',
                    (row.kind === 'new' || row.kind === 'update') && 'text-content-secondary',
                  )}
                >
                  {KIND_LABELS[row.kind]}
                </span>
                <span className="font-medium">{row.label}</span>
                {row.detail ? <span className="text-content-muted">· {row.detail}</span> : null}
              </p>
              {row.changes.map((change) => (
                <p key={change.field} className="mt-0.5 text-content-muted">
                  {change.field}: {change.from} → {change.to}
                </p>
              ))}
              {row.note ? <p className="mt-0.5 text-content-muted">{row.note}</p> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-content-muted">Nichts zu ändern.</p>
      )}

      {/*
        Unveränderte Einträge sind beim zweiten Lauf die Mehrheit und stünden
        sonst als Wand aus Zeilen über dem, was tatsächlich passiert.
      */}
      {unchanged.length > 0 ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => setShowUnchanged((value) => !value)}
          className="mt-3"
        >
          {showUnchanged ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          {showUnchanged
            ? 'Unveränderte ausblenden'
            : `${formatNumber(unchanged.length)} unverändert anzeigen`}
        </Button>
      ) : null}
    </div>
  );
}

export function LibraryImportSection() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState('');
  const [pending, setPending] = useState<
    { payload: LibraryImportPayload; plan: LibraryImportPlan; sourceName: string } | null
  >(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const imports = useLiveQuery(
    () => db.libraryImports.orderBy('importedAt').reverse().limit(5).toArray(),
    [],
  );

  async function preview(json: string, sourceName: string) {
    setIsBusy(true);

    try {
      const payload = parseLibraryImportPayload(json);
      const plan = await buildLibraryImportPlan(payload);

      setPending({ payload, plan, sourceName });
      setError(null);
      setSuccess(null);
    } catch (nextError) {
      setPending(null);
      setSuccess(null);
      setError(
        nextError instanceof Error ? nextError.message : 'Die Datei konnte nicht gelesen werden.',
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      await preview(await file.text(), file.name);
    } finally {
      event.target.value = '';
    }
  }

  async function handleConfirm() {
    if (!pending) {
      return;
    }

    setIsBusy(true);

    try {
      /*
       * Sicherheitsnetz wie vor dem Restore in Settings: ein ersetztes Workout
       * nimmt Wochenregeln mit, ein Zeitraum entfernt offene Termine, und
       * beides lässt sich nicht wieder importieren.
       * Scheitert die Sicherung, wird gar nicht erst geschrieben.
       */
      const backedUp =
        pending.plan.summary.removedAssignments > 0 || pending.plan.summary.removedPlanEntries > 0;

      if (backedUp) {
        await exportDatabaseSnapshot();
      }

      const { plan } = await applyLibraryImport(pending.payload, pending.sourceName);
      const { summary } = plan;

      setSuccess(
        `Eingespielt: ${formatNumber(summary.createdExercises)} Übungen neu, ` +
          `${formatNumber(summary.updatedExercises)} geändert · ` +
          `${formatNumber(summary.createdTemplates)} Workouts · ` +
          `${formatNumber(summary.createdAssignments)} Zuordnungen, ` +
          `${formatNumber(summary.removedAssignments)} entfernt · ` +
          `${formatNumber(summary.createdBandLevels)} Bänder` +
          (summary.createdPlanEntries + summary.updatedPlanEntries + summary.removedPlanEntries > 0
            ? ` · ${formatNumber(summary.createdPlanEntries)} Termine neu, ` +
              `${formatNumber(summary.updatedPlanEntries)} geändert, ` +
              `${formatNumber(summary.removedPlanEntries)} entfernt`
            : '') +
          '.' +
          (backedUp ? ' Ein Backup des vorherigen Stands wurde heruntergeladen.' : ''),
      );
      setError(null);
      setPending(null);
      setText('');
    } catch (nextError) {
      setSuccess(null);
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Der Import konnte nicht abgeschlossen werden.',
      );
    } finally {
      setIsBusy(false);
    }
  }

  const groups = pending ? toRows(pending.plan) : [];
  const hasChanges = pending ? planHasChanges(pending.plan) : false;

  return (
    <SectionCard
      title="Bibliothek importieren"
      subtitle="Übungen, Workouts, Zuordnungen, Bänder und Termine aus einer JSON-Datei - Trainingsdaten bleiben unberührt."
    >
      <div className="space-y-4">
        <input
          ref={fileInputRef}
          aria-label="Import-Datei auswählen"
          type="file"
          accept="application/json"
          onChange={handleFileChange}
          className="hidden"
        />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isBusy}
          className="flex w-full items-center justify-between rounded-panel border border-line bg-surface-raised px-4 py-4 text-left transition hover:border-accent-border hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          <div>
            <p className="font-medium text-content-secondary">JSON-Datei auswählen</p>
            <p className="mt-1 text-sm text-content-muted">
              Zeigt vor dem Schreiben, was neu wäre und was sich ändert.
            </p>
          </div>
          <Upload size={18} className="text-content-muted" />
        </button>

        <TextArea
          label="Oder JSON einfügen"
          hint="Auf dem iPhone der kürzere Weg: Text einfügen und Vorschau erzeugen."
          rows={4}
          value={text}
          onChange={(event) => setText(event.target.value)}
          spellCheck={false}
        />

        <Button
          type="button"
          variant="secondary"
          fullWidth
          disabled={isBusy || text.trim().length === 0}
          onClick={() => void preview(text, 'Eingefügter Text')}
        >
          <FileJson size={18} />
          Vorschau erzeugen
        </Button>

        {pending ? (
          <div className="rounded-panel border border-warning-border bg-warning-soft p-4">
            <p className="text-sm font-semibold text-warning">Vorschau: {pending.sourceName}</p>
            <p className="mt-1 text-sm text-content-secondary">
              {describePreviewIntro(pending.plan, hasChanges)}
            </p>

            <div className="mt-4 space-y-3">
              {groups.map((group) => (
                <PreviewGroup key={group.title} title={group.title} rows={group.rows} />
              ))}
            </div>

            <div className="mt-4 flex gap-3">
              <Button
                type="button"
                variant="primary"
                fullWidth
                disabled={isBusy || !hasChanges}
                onClick={() => void handleConfirm()}
              >
                {isBusy ? 'Import läuft...' : 'Import bestätigen'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                fullWidth
                disabled={isBusy}
                onClick={() => setPending(null)}
              >
                Abbrechen
              </Button>
            </div>
          </div>
        ) : null}

        {success ? <Alert variant="success">{success}</Alert> : null}
        {/* Mehrzeilig, weil die Prüfung jede beanstandete Zeile einzeln nennt. */}
        {error ? (
          <Alert variant="error">
            <span className="whitespace-pre-line">{error}</span>
          </Alert>
        ) : null}

        {imports && imports.length > 0 ? (
          <div className="rounded-panel bg-surface p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-content-muted">
              Zuletzt importiert
            </p>
            <ul className="mt-3 space-y-2">
              {imports.map((entry) => (
                <li key={entry.id} className="text-sm">
                  <p className="text-content-secondary">
                    {formatDateTime(entry.importedAt)} · {entry.sourceName ?? 'Unbekannte Quelle'}
                  </p>
                  <p className="mt-0.5 text-content-muted">
                    {formatNumber(entry.createdExercises)} Übungen ·{' '}
                    {formatNumber(entry.createdAssignments)} Zuordnungen ·{' '}
                    {entry.createdPlanEntries
                      ? `${formatNumber(entry.createdPlanEntries)} Termine · `
                      : null}
                    {formatNumber(entry.updatedExercises + entry.updatedAssignments)} geändert ·{' '}
                    {entry.payloadHash}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}
