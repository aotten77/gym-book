import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { AppShell } from '@/components/AppShell';
import { Empty } from '@/components/Empty';
import { RunLogSheet } from '@/components/RunLogSheet';
import { SectionCard } from '@/components/SectionCard';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { db } from '@/db/appDb';
import { deleteRunLog } from '@/db/run-actions';
import { formatPace, formatRunDuration, paceSecondsPerKm } from '@/domain/run';
import { formatNumber, formatRunDate } from '@/lib/format';

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-panel bg-surface-raised p-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-content-muted">{label}</p>
      <p className="mt-1 break-words font-display text-xl font-bold tracking-tight text-content">{value}</p>
    </div>
  );
}

export function RunDetailPage() {
  const { runId } = useParams();
  const navigate = useNavigate();
  // `null` = nicht gefunden, `undefined` = lädt noch.
  const run = useLiveQuery(async () => (runId ? ((await db.runLogs.get(runId)) ?? null) : null), [runId]);
  const [isEditing, setIsEditing] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  if (run === undefined) {
    return <AppShell title="Lauf">{null}</AppShell>;
  }

  if (run === null) {
    return (
      <AppShell title="Lauf">
        <Empty
          title="Lauf nicht gefunden"
          description="Dieser Lauf existiert nicht (mehr)."
          action={
            <Link to="/history" className="text-sm font-semibold text-accent underline">
              Zum Verlauf
            </Link>
          }
        />
      </AppShell>
    );
  }

  const pace = paceSecondsPerKm(run.distanceKm, run.durationSeconds);

  async function handleDelete() {
    setIsDeleting(true);

    try {
      await deleteRunLog(run!.id);
      navigate('/history');
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <AppShell title="Lauf" eyebrow={formatRunDate(run.date)}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Tile label="Strecke" value={`${formatNumber(run.distanceKm)} km`} />
          <Tile label="Dauer" value={formatRunDuration(run.durationSeconds)} />
          <Tile label="Pace" value={pace === undefined ? '–' : `${formatPace(pace)} /km`} />
          <Tile
            label="Höhenmeter"
            value={typeof run.elevationGainM === 'number' ? `${formatNumber(run.elevationGainM)} m` : '–'}
          />
          <Tile
            label="Ø Puls"
            value={typeof run.averageHeartRate === 'number' ? `${formatNumber(run.averageHeartRate)} bpm` : '–'}
          />
        </div>

        {run.notes ? (
          <SectionCard title="Notiz">
            <p className="whitespace-pre-wrap break-words text-sm text-content-secondary">{run.notes}</p>
          </SectionCard>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={() => setIsEditing(true)}>
            Bearbeiten
          </Button>
          <Button variant="danger" onClick={() => setIsConfirmingDelete(true)}>
            Löschen
          </Button>
        </div>
      </div>

      <RunLogSheet open={isEditing} run={run} onClose={() => setIsEditing(false)} />
      <ConfirmDialog
        open={isConfirmingDelete}
        title="Lauf löschen?"
        description="Der Lauf wird endgültig entfernt."
        busy={isDeleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setIsConfirmingDelete(false)}
      />
    </AppShell>
  );
}
