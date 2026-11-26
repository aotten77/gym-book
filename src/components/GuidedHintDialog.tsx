import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

/** Kleinschrift über Hinweis und Anleitung. */
const CAPTION_CLASSES = 'text-[10px] font-bold uppercase tracking-[0.16em] text-accent-contrast/60';

interface GuidedHintDialogProps {
  /** Der Name des Schritts. */
  title: string;
  /** Der Hinweistext von claude.ai. Mindestens `hint` oder `guidance` ist gesetzt. */
  hint?: string;
  /** Die gesprochene Anleitung - hier immer lesbar, auch wenn sie nicht gesprochen wird. */
  guidance?: string;
  /** Eine Zeile unter dem Text - im Ablauf „Die Zeit läuft weiter“ mit der Restzeit. */
  footer?: ReactNode;
  onClose: () => void;
}

/**
 * Das Info-Fenster über einem Screen der geführten Einheit.
 *
 * Es liegt **innerhalb** der Bühne und nicht in einem eigenen Portal: die
 * Bühne ist gedreht, wenn das Handy hochkant steht, und ein Fenster daneben
 * stünde quer dazu. Deshalb ist es auch kein `Sheet` und kein `ConfirmDialog`.
 *
 * Unter dem Hinweis steht die Anleitung; ohne Hinweis nur sie. Bei langem
 * Text scrollt der Inhalt, Kopf und Fuß bleiben stehen.
 *
 * Schließt per Knopf, Tipp auf den Grund und Escape. Der Fokus geht beim
 * Öffnen auf den Schließen-Knopf und beim Schließen zurück auf das „i“, das
 * es geöffnet hat.
 */
export function GuidedHintDialog({ title, hint, guidance, footer, onClose }: GuidedHintDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement;

    dialogRef.current?.querySelector('button')?.focus();

    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus();
      }
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      data-guided-hint
      className="absolute inset-0 z-10 flex items-center justify-center bg-accent/60 pl-[max(1.125rem,var(--stage-inset-left))] pr-[max(1.125rem,var(--stage-inset-right))]"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${hint ? 'Hinweis' : 'Anleitung'} · ${title}`}
        // Eigene Textfarbe: auf der hellen Bühne erbte die Karte sonst Tinte auf Tinte.
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-full w-full max-w-[25rem] flex-col rounded-card border border-accent-contrast/20 bg-accent text-accent-contrast px-5 pb-4 pt-[1.125rem] shadow-soft"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={CAPTION_CLASSES}>{hint ? 'Hinweis' : 'Anleitung'}</p>
            <h2 className="mt-0.5 font-display text-[22px] font-extrabold leading-tight tracking-[-0.03em]">
              {title}
            </h2>
          </div>
          <IconButton
            label="Hinweis schließen"
            className={cn(
              'rounded-full border-accent-contrast/25 text-accent-contrast/80 hover:bg-accent-contrast/10',
              // Der Ring der App ist Tinte - auf Tinte wäre er unsichtbar.
              'focus-visible:ring-accent-contrast focus-visible:ring-offset-accent',
            )}
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </IconButton>
        </div>

        <div className="mt-2.5 min-h-0 overflow-y-auto">
          {hint ? <p className="text-[19px] leading-[1.4]">{hint}</p> : null}
          {guidance ? (
            <>
              {hint ? <p className={cn(CAPTION_CLASSES, 'mt-3.5')}>Anleitung</p> : null}
              <p data-guided-guidance-text className={cn('text-[15px] leading-[1.4]', hint && 'mt-1')}>
                {guidance}
              </p>
            </>
          ) : null}
        </div>

        {footer ? (
          <div className="mt-3.5 text-xs text-accent-contrast/60">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}
