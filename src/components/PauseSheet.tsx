import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { loadRestrictions } from '@/db/restriction-actions';
import { overrideSessionExercisePause, restoreSessionExercisePause } from '@/db/session-actions';
import type { WorkoutSessionExercise } from '@/domain/models';
import { formatRestrictionDay, isPausedSessionExercise } from '@/domain/restriction';

interface PauseSheetProps {
  open: boolean;
  exercise: WorkoutSessionExercise;
  onClose: () => void;
}

/**
 * Das kleine Sheet hinter dem Etikett einer pausierten Übung: wer pausiert,
 * warum, bis wann - und „Trotzdem machen“ bzw. „Wieder pausieren“.
 *
 * Grund und Zeitraum kommen aus den Einschränkungen von heute, gesucht über
 * den Namen im Snapshot. Ist eine inzwischen umbenannt oder weg, steht nur
 * ihr Name da; was die Einheit beim Start gesehen hat, bleibt der Snapshot.
 * „Wieder pausieren“ bietet die Zeile nur an, solange kein Satz abgehakt ist
 * - `restoreSessionExercisePause` prüft das noch einmal.
 */
export function PauseSheet({ open, exercise, onClose }: PauseSheetProps) {
  const restrictions = useLiveQuery(loadRestrictions, []);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string>();
  const isPaused = isPausedSessionExercise(exercise);
  const names = exercise.pausedBy ?? [];

  async function handleConfirm() {
    setIsBusy(true);
    setError(undefined);

    try {
      await (isPaused
        ? overrideSessionExercisePause(exercise.id)
        : restoreSessionExercisePause(exercise.id));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Das hat nicht geklappt.');
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <ConfirmDialog
      open={open}
      title={exercise.exerciseNameSnapshot}
      description={
        isPaused
          ? exercise.pausedUntil
            ? `Pausiert bis ${formatRestrictionDay(exercise.pausedUntil)}.`
            : 'Pausiert, ohne Enddatum.'
          : 'Trotzdem freigegeben - es gelten die Werte dieser Einheit.'
      }
      confirmLabel={isPaused ? 'Trotzdem machen' : 'Wieder pausieren'}
      cancelLabel="Schließen"
      destructive={false}
      busy={isBusy}
      onConfirm={() => void handleConfirm()}
      onCancel={onClose}
    >
      <ul className="space-y-2 text-sm" data-pause-sheet>
        {names.map((name) => {
          const restriction = restrictions?.find((item) => item.name === name);

          return (
            <li key={name} className="rounded-panel border border-line px-3 py-2">
              <p className="font-semibold text-content">{name}</p>
              {restriction?.reason ? (
                <p className="whitespace-pre-line break-words text-content-secondary">
                  {restriction.reason}
                </p>
              ) : null}
              {restriction ? (
                <p className="text-xs text-content-muted">
                  {restriction.until
                    ? `${formatRestrictionDay(restriction.from)} – ${formatRestrictionDay(restriction.until)}`
                    : `ab ${formatRestrictionDay(restriction.from)}, ohne Enddatum`}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </ConfirmDialog>
  );
}
