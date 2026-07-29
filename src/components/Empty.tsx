import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface EmptyProps {
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}

export function Empty({ title, description, action, className }: EmptyProps) {
  return (
    <div
      className={cn(
        'rounded-panel border border-dashed border-line bg-surface px-4 py-5 text-center',
        className,
      )}
    >
      <p className="text-sm font-semibold text-content">{title}</p>
      <p className="mt-2 text-sm text-content-muted">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
