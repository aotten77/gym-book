import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { ExerciseMedia } from '@/components/ExerciseMedia';
import { MarkdownText } from '@/components/MarkdownText';
import { IconButton } from '@/components/ui/Button';
import type { ExerciseGuide } from '@/domain/exercise-guide';
import type { MediaAsset } from '@/domain/models';

interface ExerciseInfoDialogProps {
  open: boolean;
  name: string;
  mediaAsset?: MediaAsset;
  guide: ExerciseGuide | null;
  onClose: () => void;
}

/**
 * Wie eine Übung geht: Bild und Anleitung an einer Stelle.
 *
 * Vorher waren das zwei Ansichten - das Thumbnail öffnete eine dunkle
 * Lightbox, die Zeile "Ausführung" klappte im Sheet auf und schob die
 * Wertefelder nach unten. Jetzt öffnen beide dasselbe. Hell auf Papier und
 * nicht dunkel wie die Lightbox: hier wird gelesen, nicht ein Bild beurteilt.
 * Keine Limette - eine Anleitung ist kein Zustand, die eine Limettenfläche des
 * Sheets bleibt die aktive Satzzeile.
 *
 * Es liegt über dem Sheet (`z-50` gegen `z-40`) und ist damit die dritte
 * Ebene. Escape fängt es deshalb in der Capture-Phase auf `window` ab: das
 * Sheet hört auf `document`, und ohne `stopPropagation` schlösse ein Escape
 * beide.
 */
export function ExerciseInfoDialog({ open, name, mediaAsset, guide, onClose }: ExerciseInfoDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  /*
   * `onClose` per Ref: `SessionPage` tickt während einer Pause jede Sekunde
   * und reicht dabei jedes Mal eine neue Funktion herein. Hinge der Effekt
   * daran, spränge der Fokus im Sekundentakt zum Auslöser und zurück.
   */
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
      }
    };

    // Wer das Modal geöffnet hat, bekommt den Fokus zurück - sonst landet er
    // nach dem Schließen auf dem Body und die Tastatur fängt oben an.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.addEventListener('keydown', handleKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.querySelector<HTMLButtonElement>('[data-info-close]')?.focus();

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = previousOverflow;
      opener?.focus();
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-exercise-info=""
      className="fixed inset-0 z-50 flex flex-col bg-app pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]"
    >
      <div className="mx-auto flex w-full max-w-md items-start gap-3 px-4 pb-3">
        <h2
          id={titleId}
          className="min-w-0 flex-1 pt-2 font-display text-[23px] font-extrabold leading-[1.06] tracking-[-0.04em] [overflow-wrap:anywhere]"
        >
          {name}
        </h2>
        <IconButton label="Schließen" onClick={onClose} data-info-close="" className="shrink-0">
          <X size={18} />
        </IconButton>
      </div>

      <div className="mx-auto w-full max-w-md flex-1 space-y-4 overflow-y-auto px-4 pb-4">
        {mediaAsset ? (
          <ExerciseMedia
            mediaAsset={mediaAsset}
            alt={name}
            className="max-h-[40dvh] w-full rounded-panel bg-surface"
            imageClassName="h-full max-h-[40dvh] w-full object-contain"
          />
        ) : null}

        {guide ? (
          <div className="space-y-3 text-[15px] leading-relaxed text-content">
            {guide.blocks.length > 0 ? <MarkdownText blocks={guide.blocks} /> : null}

            {guide.tempo ? (
              <p className="text-content-secondary">
                <span className="font-semibold">Tempo</span> {guide.tempo}
              </p>
            ) : null}

            {/*
              Die Notiz gehört nicht zur Übung, sondern zu diesem Workout -
              deshalb abgesetzt, benannt und ohne Markdown: "Direkt nach dem
              Couch Stretch" stimmt nur hier.
            */}
            {guide.notes ? (
              <p className="border-t border-line pt-3 text-content-secondary">
                <span className="font-semibold">In diesem Workout:</span> {guide.notes}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
