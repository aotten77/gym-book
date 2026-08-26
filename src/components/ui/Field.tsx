import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/*
 * Bis hierher trugen rund 30 Felder ihre Beschriftung ausschließlich im
 * Placeholder - die verschwindet, sobald der Nutzer tippt, und Screenreader
 * lesen sie nicht zuverlässig als Label. Diese Primitives erzwingen ein
 * echtes `<label for>` und einen sichtbaren Fokusring.
 */

/*
 * `text-base` statt `text-sm` ist hier kein Geschmack: iOS Safari zoomt beim
 * Fokus in jedes Feld hinein, dessen Schrift kleiner als 16px ist.
 */
const CONTROL_CLASSES =
  'w-full rounded-panel border border-line bg-surface-sunken px-4 py-3.5 text-base text-content ' +
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

interface CheckboxFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'> {
  label: string;
  hint?: string;
  containerClassName?: string;
}

/**
 * Kontrollkästchen mit derselben Trefferfläche wie die übrigen Felder.
 *
 * Die gesamte Zeile ist das Label, damit im Training nicht das 16px-Kästchen
 * getroffen werden muss.
 */
export function CheckboxField({
  label,
  hint,
  className,
  containerClassName,
  ...rest
}: CheckboxFieldProps) {
  const id = useId();

  return (
    <div className={cn('w-full', containerClassName)}>
      <label
        htmlFor={id}
        className={cn(
          'flex min-h-touch w-full cursor-pointer items-center gap-3 rounded-panel border border-line',
          'bg-surface-sunken px-4 py-3 transition hover:bg-surface-raised',
          'focus-within:border-accent-border focus-within:ring-2 focus-within:ring-accent',
          className,
        )}
      >
        <input
          id={id}
          type="checkbox"
          // Die native Haekchenfarbe: Tinte, nicht Limette. Das Haekchen im
          // Kaestchen zeichnet iOS weiss - auf Limette waere es unsichtbar.
          className="h-5 w-5 shrink-0 accent-content"
          {...rest}
        />
        <span className="text-base text-content">{label}</span>
      </label>
      {hint ? <p className="mt-1.5 text-xs text-content-muted">{hint}</p> : null}
    </div>
  );
}

interface ToggleFieldProps {
  label: string;
  hint?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Schalter für eine Einstellung, die sofort wirkt.
 *
 * Kein [CheckboxField]: dessen Kästchen bleibt auch in der 44px-Zeile ein
 * 20px-Ziel, und der Zugänglichkeitstest misst das Bedienelement selbst, nicht
 * seine Umgebung. Hier ist die ganze Zeile der Knopf - `role="switch"` sagt
 * dazu, dass die Änderung unmittelbar greift und kein Formular abgeschickt
 * werden muss.
 */
export function ToggleField({
  label,
  hint,
  checked,
  onCheckedChange,
  disabled,
  className,
}: ToggleFieldProps) {
  const hintId = useId();

  return (
    <div className={cn('w-full', className)}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={hint ? hintId : undefined}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          'flex min-h-touch w-full items-center justify-between gap-3 rounded-panel border border-line',
          'bg-surface-sunken px-4 py-3 text-left transition hover:bg-surface-raised',
          'disabled:cursor-not-allowed disabled:opacity-60',
        )}
      >
        <span className="text-base text-content">{label}</span>
        {/*
          Der Knopf wechselt die Farbe mit, nicht nur die Seite: `accent` und
          `content` sind derselbe Ton (die Tinte), ein `bg-content`-Knopf lag
          auf der eingeschalteten Bahn also unsichtbar auf Schwarz - der
          Schalter sah an wie eine massive Pille ohne Stellung. Eingeschaltet
          ist der Knopf deshalb Papier auf Tinte, ausgeschaltet Tinte auf
          Papier. Kein Limette: "an" ist nicht "jetzt dran".
        */}
        <span
          aria-hidden
          className={cn(
            'relative h-7 w-12 shrink-0 rounded-full border transition',
            checked ? 'border-accent-border bg-accent' : 'border-line-strong bg-surface',
          )}
        >
          <span
            className={cn(
              'absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full transition-all',
              checked ? 'left-[1.5rem] bg-accent-contrast' : 'left-0.5 bg-content-muted',
            )}
          />
        </span>
      </button>
      {hint ? (
        <p id={hintId} className="mt-1.5 text-xs text-content-muted">
          {hint}
        </p>
      ) : null}
    </div>
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
