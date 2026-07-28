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
        'rounded-3xl border border-dashed border-white/10 bg-zinc-950/35 px-4 py-5 text-center',
        className,
      )}
    >
      <p className="text-sm font-semibold text-zinc-100">{title}</p>
      <p className="mt-2 text-sm text-zinc-400">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
