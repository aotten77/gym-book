import type { ReactNode } from 'react';
import { Repeat } from 'lucide-react';

interface SupersetBlockProps {
  /** Kennzeichnung der Mitglieder in ihrer Reihenfolge, z. B. ["A", "B"]. */
  positions: string[];
  /** Bedienung des ganzen Blocks - im Training die Pfeile zum Verschieben. */
  action?: ReactNode;
  children: ReactNode;
}

/**
 * Rahmen um die Übungen eines Supersatzes.
 *
 * Bewusst ein `div` mit `role="group"` und keine `section`: die Karten darin
 * sind selbst `section`s, und zwei verschachtelte Landmarken machen die
 * Gliederung für Screenreader schlechter statt besser.
 */
export function SupersetBlock({ positions, action, children }: SupersetBlockProps) {
  return (
    <div
      role="group"
      aria-label={`Supersatz ${positions.join(' und ')}`}
      className="rounded-card border border-accent-border bg-surface-sunken p-2"
    >
      <div className="flex items-center justify-between gap-2 px-2 py-1">
        <p className="flex min-w-0 items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
          <Repeat size={14} className="shrink-0" aria-hidden="true" />
          <span className="truncate">Supersatz · {positions.join(' → ')}</span>
        </p>
        {action}
      </div>
      {/*
        Der Hinweis steht einmal am Block statt auf jeder Karte: dass die
        Sätze im Wechsel laufen, ist die Eigenschaft der Gruppe.
      */}
      <p className="px-2 pb-2 text-xs text-content-muted">
        Sätze im Wechsel - die Pause der einen Übung läuft weiter, während die andere dran ist.
      </p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
