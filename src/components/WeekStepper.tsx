import type { ReactNode } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { IconButton } from '@/components/ui/Button';

interface WeekStepperProps {
  label: string;
  week: number;
  hint?: ReactNode;
  backLabel: string;
  forwardLabel: string;
  onStepBack: () => void;
  onStepForward: () => void;
  disabled?: boolean;
  onReset?: () => void;
  resetLabel?: string;
  resetDisabled?: boolean;
}

export function WeekStepper({
  label,
  week,
  hint,
  backLabel,
  forwardLabel,
  onStepBack,
  onStepForward,
  disabled,
  onReset,
  resetLabel = 'Zuruecksetzen',
  resetDisabled,
}: WeekStepperProps) {
  return (
    <div className="rounded-panel border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-content-muted">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-content">W{week}</p>
          {hint}
        </div>
        <div className="flex gap-2">
          <IconButton label={backLabel} onClick={onStepBack} disabled={disabled}>
            <Minus size={18} />
          </IconButton>
          <IconButton label={forwardLabel} onClick={onStepForward} disabled={disabled}>
            <Plus size={18} />
          </IconButton>
          {onReset ? (
            <IconButton label={resetLabel} onClick={onReset} disabled={resetDisabled}>
              <RotateCcw size={18} />
            </IconButton>
          ) : null}
        </div>
      </div>
    </div>
  );
}
