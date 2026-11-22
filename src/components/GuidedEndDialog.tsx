import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/Button';

interface GuidedEndDialogProps {
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Die Rückfrage „Einheit beenden?“ im Pause-Screen.
 *
 * Wie `GuidedHintDialog` liegt sie **innerhalb** der Bühne (die Bühne ist
 * gedreht, ein Portal daneben stünde quer dazu) und trägt die Karte auf Tinte.
 * Der Fokus startet auf „Weiter pausiert“: das Beenden soll nie der Knopf
 * sein, den ein zweiter Tipp aus Versehen trifft. Escape und Tipp auf den
 * Grund brechen die Rückfrage ab.
 */
export function GuidedEndDialog({ onConfirm, onCancel }: GuidedEndDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement;

    cancelRef.current?.focus();

    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus();
      }
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCancel();
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div
      data-guided-end
      className="absolute inset-0 z-10 flex items-center justify-center bg-accent/60 pl-[max(1.125rem,var(--stage-inset-left))] pr-[max(1.125rem,var(--stage-inset-right))]"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Einheit beenden?"
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-full w-full max-w-[25rem] flex-col rounded-card border border-accent-contrast/20 bg-accent px-5 pb-4 pt-[1.125rem] shadow-soft"
      >
        <h2 className="font-display text-[22px] font-extrabold leading-tight tracking-[-0.03em]">
          Einheit beenden?
        </h2>
        <p className="mt-2 text-[15px] leading-[1.4] text-accent-contrast/80">
          Die Einheit wird abgebrochen und zählt nicht. Der Termin im Plan bleibt offen.
        </p>
        <div className="mt-4 flex gap-2.5">
          <Button
            ref={cancelRef}
            variant="primary"
            className="flex-1 rounded-full bg-accent-contrast text-accent focus-visible:ring-accent-contrast focus-visible:ring-offset-accent"
            onClick={onCancel}
          >
            Weiter pausiert
          </Button>
          <Button
            variant="ghost"
            className="flex-1 rounded-full border-accent-contrast/30 text-accent-contrast hover:bg-accent-contrast/10 focus-visible:ring-accent-contrast focus-visible:ring-offset-accent"
            onClick={onConfirm}
          >
            Einheit beenden
          </Button>
        </div>
      </div>
    </div>
  );
}
