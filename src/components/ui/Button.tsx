import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'md' | 'lg';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-contrast font-semibold hover:brightness-105',
  secondary: 'bg-surface-raised text-content-secondary hover:bg-surface-hover',
  ghost: 'border border-line text-content-secondary hover:bg-surface-raised',
  danger: 'border border-danger-border text-danger hover:bg-danger-soft',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  // min-h-touch haelt die 44px auch dann, wenn der Text kurz ist.
  md: 'min-h-touch rounded-control px-4 py-2.5 text-sm',
  lg: 'min-h-touch rounded-panel px-4 py-4 text-sm',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  children: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'lg', fullWidth, className, type = 'button', children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-medium transition',
        // Der Browser-Default-Ring ist auf dunklem Grund praktisch unsichtbar.
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Pflicht: ein Icon allein hat keinen zugaenglichen Namen. */
  label: string;
  variant?: 'ghost' | 'danger';
  children: ReactNode;
}

export function IconButton({
  label,
  variant = 'ghost',
  className,
  type = 'button',
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control border transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'danger'
          ? 'border-danger-border text-danger hover:bg-danger-soft'
          : 'border-line text-content-secondary hover:bg-surface-raised',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
