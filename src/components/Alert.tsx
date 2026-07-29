import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type AlertVariant = 'error' | 'success' | 'warning' | 'info';

const VARIANT_CLASSES: Record<AlertVariant, string> = {
  error: 'border-rose-300/20 bg-rose-300/10 text-rose-100',
  success: 'border-lime-300/20 bg-lime-300/10 text-lime-100',
  warning: 'border-amber-300/20 bg-amber-300/10 text-amber-100',
  info: 'border-sky-300/20 bg-sky-300/10 text-sky-100',
};

interface AlertProps {
  variant?: AlertVariant;
  children: ReactNode;
  className?: string;
}

export function Alert({ variant = 'error', children, className }: AlertProps) {
  return (
    <p
      // Fehler und Erfolge muessen auch angesagt werden, nicht nur sichtbar sein.
      role={variant === 'error' ? 'alert' : 'status'}
      className={cn(
        'rounded-3xl border px-4 py-4 text-sm',
        VARIANT_CLASSES[variant],
        className,
      )}
    >
      {children}
    </p>
  );
}
