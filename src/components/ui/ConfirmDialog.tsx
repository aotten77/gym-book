import { useEffect, useRef } from 'react';
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
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Ersetzt `window.confirm`: in einer installierten PWA ist der native
 * Systemdialog ein Stilbruch, auf iOS blockiert er zusaetzlich den Thread.
 * Und er war ohnehin nicht ueberall vorhanden - Programme liessen sich bisher
 * ohne jede Rueckfrage samt aller Wochen und Progressionsregeln loeschen.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Loeschen',
  cancelLabel = 'Abbrechen',
  destructive = true,
  busy = false,
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:items-center">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        className="w-full max-w-md rounded-card border border-line bg-zinc-950/95 p-5 shadow-soft"
      >
        <h2 id="confirm-dialog-title" className="text-lg font-semibold text-content">
          {title}
        </h2>
        <p id="confirm-dialog-description" className="mt-2 text-sm text-content-muted">
          {description}
        </p>
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
            {busy ? 'Laeuft...' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
