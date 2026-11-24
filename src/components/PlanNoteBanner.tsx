import { useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PlanNoteBannerProps {
  note: string;
  className?: string;
}

/**
 * Die Notiz des Termins, mit dem eine Einheit verknüpft ist oder verknüpft
 * würde. Vorher stand sie nirgends im Training und las sie niemand.
 *
 * Neutral wie ein Hinweis, kein Lime: die Notiz ist Information, nichts ist
 * „jetzt dran“. Ein Tipp blendet sie aus. Das ist Komponenten-Zustand - nach
 * einem Reload steht sie wieder da, denn ob sie gelesen wurde, ist keine
 * Trainingsinformation.
 */
export function PlanNoteBanner({ note, className }: PlanNoteBannerProps) {
  const [isHidden, setIsHidden] = useState(false);

  if (isHidden) {
    return null;
  }

  return (
    <button
      type="button"
      data-plan-note
      aria-label={`Notiz zum Termin: ${note}. Tippen blendet sie aus.`}
      onClick={() => setIsHidden(true)}
      className={cn(
        'flex min-h-touch w-full items-start gap-3 rounded-panel border border-line bg-surface',
        'px-4 py-3 text-left text-sm text-content-secondary',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        className,
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-content-muted">
          Notiz zum Termin
        </span>
        <span className="mt-0.5 block whitespace-pre-line break-words text-content">{note}</span>
      </span>
      <X size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-content-muted" />
    </button>
  );
}
