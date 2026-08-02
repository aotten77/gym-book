import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface SectionCardProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function SectionCard({ title, subtitle, action, children, className }: SectionCardProps) {
  return (
    <section
      className={cn(
        /*
         * Weiß auf Papier, nicht getönt: die Karte ist die oberste Ebene und
         * muss heller sein als das, was in ihr liegt. Auf dunklem Grund war
         * "raised" die aufgehellte Fläche - auf hellem Grund kehrt sich das
         * um, und eine getönte Karte mit weißen Kacheln darin liest sich
         * verkehrt herum.
         */
        'rounded-card border border-line bg-surface p-4 shadow-soft',
        className,
      )}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-content">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm text-content-muted">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
