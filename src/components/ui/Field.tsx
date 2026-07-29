import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/*
 * Bis hierher trugen rund 30 Felder ihre Beschriftung ausschliesslich im
 * Placeholder - die verschwindet, sobald der Nutzer tippt, und Screenreader
 * lesen sie nicht zuverlaessig als Label. Diese Primitives erzwingen ein
 * echtes `<label for>` und einen sichtbaren Fokusring.
 */

const CONTROL_CLASSES =
  'w-full rounded-panel border border-line bg-surface-sunken px-4 py-3.5 text-sm text-content ' +
  'outline-none transition placeholder:text-content-muted ' +
  'focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent ' +
  'disabled:cursor-not-allowed disabled:opacity-60';

interface FieldShellProps {
  label: string;
  hint?: string;
  error?: string;
  htmlFor: string;
  children: ReactNode;
  className?: string;
}

function FieldShell({ label, hint, error, htmlFor, children, className }: FieldShellProps) {
  return (
    <div className={cn('w-full', className)}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-content-muted">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-content-muted">{hint}</p>
      ) : null}
    </div>
  );
}

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string;
  containerClassName?: string;
}

export function TextField({
  label,
  hint,
  error,
  className,
  containerClassName,
  ...rest
}: TextFieldProps) {
  const id = useId();

  return (
    <FieldShell label={label} hint={hint} error={error} htmlFor={id} className={containerClassName}>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        className={cn(CONTROL_CLASSES, error && 'border-danger-border', className)}
        {...rest}
      />
    </FieldShell>
  );
}

interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string;
  containerClassName?: string;
}

export function TextArea({
  label,
  hint,
  error,
  className,
  containerClassName,
  ...rest
}: TextAreaProps) {
  const id = useId();

  return (
    <FieldShell label={label} hint={hint} error={error} htmlFor={id} className={containerClassName}>
      <textarea
        id={id}
        aria-invalid={error ? true : undefined}
        className={cn(CONTROL_CLASSES, error && 'border-danger-border', className)}
        {...rest}
      />
    </FieldShell>
  );
}

interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string;
  containerClassName?: string;
  children: ReactNode;
}

export function SelectField({
  label,
  hint,
  error,
  className,
  containerClassName,
  children,
  ...rest
}: SelectFieldProps) {
  const id = useId();

  return (
    <FieldShell label={label} hint={hint} error={error} htmlFor={id} className={containerClassName}>
      <select id={id} className={cn(CONTROL_CLASSES, 'select-control', className)} {...rest}>
        {children}
      </select>
    </FieldShell>
  );
}
