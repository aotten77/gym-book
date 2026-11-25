import type { WorkoutSessionExercise } from '@/domain/models';
import {
  describeAdjustedTargets,
  describeRestrictionLabel,
  sessionRestrictionKind,
} from '@/domain/restriction';
import { cn } from '@/lib/utils';

interface RestrictionLabelProps {
  exercise: WorkoutSessionExercise;
  /** Beim Ersatz der Name der pausierten Übung. */
  originalName?: string;
  /** Öffnet das Sheet der Pause; ohne bleibt das Etikett reiner Text. */
  onOpen?: () => void;
  className?: string;
}

/**
 * Was eine Einschränkung an einer Session-Zeile bewirkt hat, unter dem Namen
 * der Übung: das Etikett („Pausiert bis 14.12. · Beispiel A“), die
 * „statt“-Zeile der tatsächlich geänderten Werte und jede Notiz als eigene
 * Zeile - lesbar ohne Tippen auf ein „i“.
 *
 * Neutrale Tinte: die Farbe kommt von der Karte, auf der die Zeile steht, nur
 * abgeschwächt (`opacity-75`, wie Nebentext auf gefüllten Flächen). Kein Lime,
 * kein Grün, kein Rot - eine Einschränkung ist kein Signal, sondern eine
 * Auskunft (`docs/architecture/ui-palette.md`).
 */
export function RestrictionLabel({ exercise, originalName, onOpen, className }: RestrictionLabelProps) {
  const kind = sessionRestrictionKind(exercise);
  const label = describeRestrictionLabel(exercise, originalName);
  const adjusted = describeAdjustedTargets(exercise);
  const notes = exercise.adjustmentNotes ?? [];

  if (!kind && !label && !adjusted && notes.length === 0) {
    return null;
  }

  return (
    <div
      data-restriction-kind={kind ?? ''}
      className={cn('min-w-0 space-y-0.5 px-2.5 text-[12px] font-semibold opacity-75', className)}
    >
      {label ? (
        onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className={cn(
              'block min-h-touch max-w-full truncate rounded text-left underline decoration-dotted underline-offset-2',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            )}
          >
            {label}
          </button>
        ) : (
          <p className="truncate">{label}</p>
        )
      ) : null}
      {adjusted ? <p className="break-words">{adjusted}</p> : null}
      {notes.map((note, index) => (
        <p key={`${note.by}-${index}`} className="break-words font-normal">
          {note.note}
        </p>
      ))}
    </div>
  );
}
