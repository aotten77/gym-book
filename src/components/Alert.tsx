import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type AlertVariant = 'error' | 'success' | 'warning' | 'info';

/*
 * Die Rollen kommen aus der Token-Skala, nicht aus Tailwinds Rohpalette:
 * vorher trug jede Variante ihren eigenen Farbton (rose/lime/amber/sky), der
 * mit `danger`/`accent`/`warning` nirgends deckungsgleich war. "info" bleibt
 * bewusst neutral - eine fünfte Akzentfarbe trägt keine eigene Bedeutung.
 */
const VARIANT_CLASSES: Record<AlertVariant, string> = {
  error: 'border-danger-border bg-danger-soft text-danger',
  success: 'border-success-border bg-success-soft text-success',
  warning: 'border-warning-border bg-warning-soft text-warning',
  info: 'border-line bg-surface text-content-secondary',
};

interface AlertProps {
  variant?: AlertVariant;
  children: ReactNode;
  className?: string;
}

export function Alert({ variant = 'error', children, className }: AlertProps) {
  return (
    <p
      // Fehler und Erfolge müssen auch angesagt werden, nicht nur sichtbar sein.
      role={variant === 'error' ? 'alert' : 'status'}
      className={cn(
        'rounded-panel border px-4 py-4 text-sm',
        VARIANT_CLASSES[variant],
        className,
      )}
    >
      {children}
    </p>
  );
}
