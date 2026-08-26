import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/Button';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  /**
   * Was die Rückfrage außerdem braucht - etwa das Datum, mit dem bestätigt
   * wird. Bleibt die Ausnahme: eine Rückfrage mit halbem Formular ist keine
   * Rückfrage mehr.
   */
  children?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Ersetzt `window.confirm`: in einer installierten PWA ist der native
 * Systemdialog ein Stilbruch, auf iOS blockiert er zusätzlich den Thread.
 * Und er war ohnehin nicht überall vorhanden - Programme ließen sich bisher
 * ohne jede Rückfrage samt aller Wochen und Progressionsregeln löschen.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Löschen',
  cancelLabel = 'Abbrechen',
  destructive = true,
  busy = false,
  children,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    confirmRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancel();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    // Hintergrund nicht mitscrollen lassen, solange der Dialog offen ist.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onCancel]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-content/45 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:items-center">
      <div
        // Mit Eingabefeld ist es keine Warnmeldung mehr, sondern ein Dialog -
        // `alertdialog` verspricht Screenreadern eine reine Rückfrage.
        role={children ? 'dialog' : 'alertdialog'}
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        className="w-full max-w-md rounded-card border border-line bg-surface p-5 shadow-soft"
      >
        <h2 id="confirm-dialog-title" className="text-lg font-semibold text-content">
          {title}
        </h2>
        <p id="confirm-dialog-description" className="mt-2 text-sm text-content-muted">
          {description}
        </p>
        {children ? <div className="mt-4">{children}</div> : null}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            ref={confirmRef}
            variant={destructive ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Läuft...' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
