import type { PlanEntryKind } from '@/domain/models';
import { cn } from '@/lib/utils';

/** Art des Termins als zwei Segment-Knöpfe: "Workout" oder "Lauf". */
export function PlanKindSwitch({
  value,
  onChange,
}: {
  value: PlanEntryKind;
  onChange: (kind: PlanEntryKind) => void;
}) {
  return (
    <div role="group" aria-label="Art des Termins" className="grid grid-cols-2 gap-2">
      {(['workout', 'run'] as const).map((kind) => (
        <button
          key={kind}
          type="button"
          aria-pressed={value === kind}
          onClick={() => onChange(kind)}
          className={cn(
            'min-h-touch rounded-control border text-sm font-semibold transition',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            value === kind
              ? 'border-transparent bg-accent text-accent-contrast'
              : 'border-line bg-surface text-content-secondary hover:bg-surface-raised',
          )}
        >
          {kind === 'workout' ? 'Workout' : 'Lauf'}
        </button>
      ))}
    </div>
  );
}
