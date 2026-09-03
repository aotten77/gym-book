import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { FieldNavigationBar } from '@/components/ui/FieldNavigationBar';
import {
  collectNavigableFields,
  findFieldIndex,
  isNavigableField,
  moveFieldFocus,
} from '@/lib/field-navigation';
import { cn } from '@/lib/utils';

/**
 * Die sichtbare Fläche des Fensters.
 *
 * Nicht `100dvh`: sobald iOS die Tastatur einblendet, bleibt die dynamische
 * Viewport-Höhe dieselbe und der Fuß des Sheets rutscht darunter. Genau dieser
 * Fuß trägt aber den großen Knopf - "Satz abhaken" wäre also immer dann weg,
 * wenn man gerade einen Wert eingetippt hat. `visualViewport` meldet die
 * tatsächlich sichtbare Fläche samt Verschiebung.
 */
function useVisualViewport() {
  const [viewport, setViewport] = useState(() => ({
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
    offsetTop: 0,
  }));

  useEffect(() => {
    const visualViewport = window.visualViewport;

    if (!visualViewport) {
      return undefined;
    }

    const update = () =>
      setViewport({ height: visualViewport.height, offsetTop: visualViewport.offsetTop });

    update();
    visualViewport.addEventListener('resize', update);
    visualViewport.addEventListener('scroll', update);

    return () => {
      visualViewport.removeEventListener('resize', update);
      visualViewport.removeEventListener('scroll', update);
    };
  }, []);

  return viewport;
}

/** Ab dieser Strecke gilt ein Zug nach unten als Schließen. */
const DISMISS_DISTANCE_PX = 90;

interface SheetProps {
  open: boolean;
  /** Zugänglicher Name des Dialogs - im Training der Name des Blocks. */
  label: string;
  /** Kopfzeile links neben dem Schließen-Knopf. */
  header?: ReactNode;
  /** Fuß, der über der Tastatur stehen bleibt. */
  footer?: ReactNode;
  /**
   * Blendet über dem Fuß eine Leiste ein, solange ein Feld den Fokus hat.
   *
   * Bewusst opt-in: sie kostet 44px im Fuß, und das lohnt nur dort, wo mehrere
   * Felder untereinander stehen und die Tastatur die unteren verdeckt.
   */
  fieldNavigation?: boolean;
  /**
   * Beschriftung des Schließen-Knopfes.
   *
   * Im Training schließt man eine Übung, in der Planung das Bearbeiten - der
   * zugängliche Name muss sagen, was verschwindet.
   */
  closeLabel?: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Ein Sheet über die volle Höhe.
 *
 * Es folgt dem Muster von [ConfirmDialog] - Portal, Escape, gesperrter
 * Hintergrund-Scroll -, geht aber bis an den oberen Rand und lässt sich nach
 * unten wegwischen. Der Zug wird nur am Kopf ausgewertet: im Inhalt scrollt
 * man, und eine Geste, die beides bedeuten kann, träfe im Training regelmäßig
 * das Falsche.
 */
export function Sheet({
  open,
  label,
  header,
  footer,
  fieldNavigation,
  closeLabel = 'Übung schließen',
  onClose,
  children,
}: SheetProps) {
  const viewport = useVisualViewport();
  const [dragOffset, setDragOffset] = useState(0);
  const dragStartRef = useRef<number | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  /*
   * Wo der Fokus in der Feldkette steht - `null`, solange er nirgends darin
   * steht. Nur daran hängt die Leiste: sie erscheint mit der Tastatur und
   * verschwindet mit ihr.
   */
  const [fieldPosition, setFieldPosition] = useState<{ index: number; count: number } | null>(null);

  const syncFieldPosition = useCallback(() => {
    const surface = surfaceRef.current;
    const active = surface?.ownerDocument.activeElement ?? null;

    if (!surface || !isNavigableField(active) || !surface.contains(active)) {
      setFieldPosition(null);
      return;
    }

    const fields = collectNavigableFields(surface);
    setFieldPosition({ index: findFieldIndex(fields, active), count: fields.length });
  }, []);

  /*
   * `focusout` feuert vor dem `focusin` des Ziels - der Blick auf
   * `document.activeElement` fiele darin also immer auf den Body und die Leiste
   * flackerte bei jedem Sprung. Deshalb wird erst im nächsten Frame gefragt,
   * wenn der Fokus angekommen ist.
   */
  useEffect(() => {
    if (!open || !fieldNavigation) {
      setFieldPosition(null);
      return undefined;
    }

    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(syncFieldPosition);
    };

    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', schedule);
    schedule();

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('focusin', schedule);
      document.removeEventListener('focusout', schedule);
    };
  }, [open, fieldNavigation, syncFieldPosition]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  // Ein abgebrochener Zug darf nicht als Versatz zurückbleiben, wenn das Sheet
  // zwischenzeitlich von selbst geschlossen wurde.
  useEffect(() => {
    if (!open) {
      setDragOffset(0);
      dragStartRef.current = null;
    }
  }, [open]);

  if (!open) {
    return null;
  }

  function handleTouchStart(event: React.TouchEvent) {
    dragStartRef.current = event.touches[0].clientY;
  }

  function handleTouchMove(event: React.TouchEvent) {
    if (dragStartRef.current === null) {
      return;
    }

    // Nur nach unten: nach oben gäbe es nichts zu sehen, und ein Sheet, das
    // sich hochziehen lässt, verspricht eine zweite Rastung, die es nicht gibt.
    setDragOffset(Math.max(0, event.touches[0].clientY - dragStartRef.current));
  }

  function handleTouchEnd() {
    const offset = dragOffset;

    dragStartRef.current = null;
    setDragOffset(0);

    if (offset > DISMISS_DISTANCE_PX) {
      onClose();
    }
  }

  return createPortal(
    <div
      className="fixed inset-x-0 z-40 mx-auto flex w-full max-w-md flex-col"
      style={{ top: viewport.offsetTop, height: viewport.height }}
    >
      <div
        ref={surfaceRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        /*
          Marke fürs Sheet selbst. Über der Session kann ein zweiter Dialog
          liegen - der Ruhemodus -, und "irgendein Dialog" trifft dann mal den
          einen, mal den anderen. Wie `data-block-status` und `data-set-row`
          ist das die Fassung, an der die e2e-Tests greifen, statt Klassen zu
          raten.
        */
        data-sheet=""
        className={cn(
          'flex h-full flex-col overflow-hidden rounded-t-card bg-surface shadow-soft',
          // Während des Zuges ohne Übergang, sonst hinkt die Fläche am Finger
          // hinterher; erst beim Loslassen springt sie weich zurück.
          dragOffset === 0 && 'transition-transform',
        )}
        style={{ transform: dragOffset ? `translateY(${dragOffset}px)` : undefined }}
      >
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className="shrink-0 px-4 pt-[max(0.5rem,env(safe-area-inset-top))]"
        >
          <div
            aria-hidden="true"
            className="mx-auto mt-1.5 h-1.5 w-10 rounded-full bg-line-strong"
          />
          <div className="mt-2 flex items-start justify-between gap-3 pb-3">
            <div className="min-w-0 flex-1">{header}</div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              className={cn(
                'flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-raised text-content-secondary transition',
                'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              )}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">{children}</div>

        {footer || fieldPosition ? (
          <div className="shrink-0 border-t border-line bg-surface px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
            {/*
              Über dem Fuß, nicht darunter: unter dem großen Knopf liegt nur
              noch Rand - siehe [SessionPage]. Und die Pausen-Chips bleiben
              stehen, weil im geöffneten Sheet der erste von ihnen das eine
              `role="timer"` trägt.
            */}
            {fieldPosition ? (
              <FieldNavigationBar
                canGoPrevious={fieldPosition.index > 0}
                canGoNext={fieldPosition.index < fieldPosition.count - 1}
                onPrevious={() => moveFieldFocus(surfaceRef.current, -1)}
                onNext={() => moveFieldFocus(surfaceRef.current, 1)}
                onDismiss={() => {
                  const active = surfaceRef.current?.ownerDocument.activeElement;

                  if (active instanceof HTMLElement) {
                    active.blur();
                  }
                }}
              />
            ) : null}
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
