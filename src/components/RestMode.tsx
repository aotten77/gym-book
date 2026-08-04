import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { formatTimer } from '@/lib/format';
import { applyThemeColor } from '@/lib/theme-color';
import {
  initialEdgeWidgetPlacement,
  placeEdgeWidget,
  type EdgeWidgetPlacement,
} from '@/lib/edge-widget';
import { cn } from '@/lib/utils';

/** Die Tinte der App - derselbe Wert wie `accent.DEFAULT` in tailwind.config.js. */
const REST_THEME_COLOR = '#0c1210';

/** Schrittweite der Pfeiltasten - der Reiter muss auch ohne Finger bewegbar sein. */
const KEY_STEP = 16;
/** Bis hierhin war es ein Tipp und kein Zug. */
const TAP_SLOP = 6;

interface RestModeProps {
  /** Verbleibende Sekunden der Pause. 0 blendet alles aus. */
  seconds: number;
  /** Gestartete Dauer - der Balken zeigt `seconds` im Verhältnis dazu. */
  total: number;
  /** Zu welcher Übung (und Seite) die Pause gehört. */
  restLabel: string;
  /** Was nach der Pause ansteht: "Satz 2 · links". */
  nextLabel?: string;
  /** Und mit welchen Werten: "82,5 kg × 5". */
  nextValues?: string;
  isMinimized: boolean;
  onMinimize: () => void;
  onExpand: () => void;
  onExtend: () => void;
  onFinish: () => void;
}

/**
 * Die Pause als eigener Zustand - und als Reiter an der Kante, wenn nicht.
 *
 * Während der Pause liegt das Handy auf dem Boden oder auf der Bank, und aus
 * einem Meter Entfernung war die Zahl in der Leiste am unteren Rand nicht mehr
 * zu lesen. Vorgänger dieser Fassung haben versucht, das mit einer großen Zahl
 * *über* dem Satz zu lösen; jede von ihnen musste zwischen Lesbarkeit und
 * Verdecken abwägen und hat eines von beidem verloren. Hier fällt die Abwägung
 * weg: solange man wartet, gehört der Bildschirm der Pause, und sobald man
 * etwas anderes tun will, klappt sie zum Reiter zusammen.
 *
 * Der Reiter hängt **halb außerhalb** des Bildes. Das ist keine Spielerei: was
 * übersteht, verdeckt nichts, und die Hälfte, die bleibt, trägt genau eine
 * Zahl. Er lässt sich verschieben, rastet beim Loslassen an der näheren Kante
 * ein und richtet seinen Inhalt zur Bildmitte hin aus. Die Regeln dazu sind
 * rein und getestet: [edge-widget.ts].
 *
 * Vier Dinge sind tragend:
 *
 * - **Der Ruhemodus ist ein Dialog, der Reiter nicht.** Der Vollbildzustand
 *   nimmt Eingaben an, der Reiter nur sich selbst - alles andere auf dem
 *   Bildschirm bleibt bedienbar, während die Pause läuft.
 * - **Genau ein `role="timer"` bleibt im Dokument.** Die Zahl hier ist
 *   `aria-hidden`; es zählt weiterhin die Leiste. Zwei Live-Regionen im
 *   Sekundentakt machen den Screenreader unbenutzbar.
 * - **Der Minimieren-Knopf ist derselbe wie im Session-Kopf** - Chevron nach
 *   unten in einem 48er-Rahmen. "Läuft weiter, ich lege es nur ab" heißt in
 *   dieser App überall dasselbe und sieht deshalb überall gleich aus.
 * - **Ein Tipp ist kein Zug.** Unter [TAP_SLOP] Pixeln Bewegung öffnet der
 *   Reiter den Ruhemodus wieder, darüber war es ein Verschieben.
 */
export function RestMode({
  seconds,
  total,
  restLabel,
  nextLabel,
  nextValues,
  isMinimized,
  onMinimize,
  onExpand,
  onExtend,
  onFinish,
}: RestModeProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<HTMLButtonElement>(null);
  const [placement, setPlacement] = useState<EdgeWidgetPlacement | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number; moved: number } | null>(null);

  const measure = useCallback(() => {
    const frame = frameRef.current;
    const widget = widgetRef.current;

    if (!frame || !widget) {
      return null;
    }

    return {
      frameWidth: frame.clientWidth,
      frameHeight: frame.clientHeight,
      widgetWidth: widget.offsetWidth,
      widgetHeight: widget.offsetHeight,
    };
  }, []);

  /*
   * Erst messen, dann setzen - und vor dem Zeichnen, sonst springt der Reiter
   * beim ersten Minimieren einmal sichtbar von links oben an seinen Platz.
   */
  useLayoutEffect(() => {
    if (!isMinimized || placement) {
      return;
    }

    const frame = measure();

    if (frame) {
      setPlacement(initialEdgeWidgetPlacement(frame));
    }
  }, [isMinimized, measure, placement]);

  const move = useCallback(
    (point: { x: number; y: number }, options?: { snap?: boolean }) => {
      const frame = measure();

      if (frame) {
        setPlacement(placeEdgeWidget(point, frame, options));
      }
    },
    [measure],
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!placement) {
      return;
    }

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: placement.x,
      originY: placement.y,
      moved: 0,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;

    drag.moved = Math.max(drag.moved, Math.abs(deltaX) + Math.abs(deltaY));
    move({ x: drag.originX + deltaX, y: drag.originY + deltaY });
  };

  const endDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    dragRef.current = null;

    if (placement) {
      move(placement, { snap: true });
    }

    return drag.moved;
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    const moved = endDrag(event);

    if (moved !== undefined && moved < TAP_SLOP) {
      onExpand();
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!placement) {
      return;
    }

    const steps: Record<string, [number, number]> = {
      ArrowLeft: [-KEY_STEP, 0],
      ArrowRight: [KEY_STEP, 0],
      ArrowUp: [0, -KEY_STEP],
      ArrowDown: [0, KEY_STEP],
    };
    const step = steps[event.key];

    if (!step) {
      return;
    }

    event.preventDefault();
    move({ x: placement.x + step[0], y: placement.y + step[1] });
  };

  /*
   * Solange der Vollbildzustand steht, gehört ihm auch die Systemleiste.
   *
   * Ohne das zeichnet iOS im installierten Zustand weiter die dunkle Schrift
   * der hellen App über den tintenfarbenen Grund - die Uhrzeit des Geräts wäre
   * die ganze Pause über nicht zu lesen. Nur für den Vollbildzustand: der
   * Reiter liegt über der hellen Ansicht, dort bleibt Papier richtig.
   */
  useEffect(() => {
    if (isMinimized || seconds <= 0) {
      return undefined;
    }

    return applyThemeColor(REST_THEME_COLOR);
  }, [isMinimized, seconds]);

  /*
   * Dreht das Gerät oder klappt die Tastatur auf, ändert sich der Rahmen unter
   * dem Reiter. Ohne das hinge er außerhalb des Bildes.
   */
  useEffect(() => {
    if (!isMinimized) {
      return undefined;
    }

    const handleResize = () => {
      setPlacement((current) => {
        const frame = measure();

        return current && frame ? placeEdgeWidget(current, frame, { snap: true }) : current;
      });
    };

    window.addEventListener('resize', handleResize);

    return () => window.removeEventListener('resize', handleResize);
  }, [isMinimized, measure]);

  if (seconds <= 0) {
    return null;
  }

  const label = formatTimer(seconds).replace(/^0/, '');
  const elapsedFraction = total > 0 ? Math.min(1, Math.max(0, 1 - seconds / total)) : 0;

  return createPortal(
    /*
      Der Rahmen misst nur - er nimmt keine Ereignisse an, sonst läge über der
      ganzen Seite eine Fläche, die jeden Griff abfängt. Über dem Sheet (z-40),
      aber unter Rückfrage und Lightbox (z-50).
    */
    <div ref={frameRef} className="pointer-events-none fixed inset-0 z-[45]">
      {isMinimized ? (
        <button
          ref={widgetRef}
          type="button"
          data-rest-widget={placement?.side ?? 'right'}
          aria-label={`Pause ${label}, Ruhemodus öffnen`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={endDrag}
          onKeyDown={handleKeyDown}
          style={{
            transform: `translate(${placement?.x ?? 0}px, ${placement?.y ?? 0}px)`,
            visibility: placement ? undefined : 'hidden',
          }}
          className={cn(
            'pointer-events-auto absolute left-0 top-0 flex h-14 w-[6.5rem] touch-none items-center',
            /*
              In Tinte wie der Vollbildzustand, aus dem er kommt - und wie
              jeder primäre Knopf der App. Weiß auf weißem Sheet hätte nur der
              Schatten getragen; der Reiter muss aber auch über einer hellen
              Karte sofort als eigenes Ding lesbar sein.
            */
            'rounded-control bg-accent shadow-soft',
            'font-display text-xl font-extrabold tabular-nums tracking-tight text-accent-contrast',
            'transition-transform duration-300 ease-out',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-contrast',
            // Der Inhalt sitzt auf der Hälfte, die im Bild bleibt.
            placement?.side === 'left' ? 'justify-end pr-3.5' : 'justify-start pl-3.5',
          )}
        >
          <span aria-hidden="true">{label}</span>
        </button>
      ) : (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Pause · ${restLabel}`}
          className="pointer-events-auto absolute inset-0 mx-auto flex w-full max-w-md flex-col bg-accent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] text-accent-contrast"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="mt-1 truncate text-[11px] font-bold uppercase tracking-[0.16em] text-accent-contrast/70">
              Pause · {restLabel}
            </p>
            {/*
              Derselbe Knopf wie im Kopf der Session: Chevron nach unten im
              48er-Rahmen. Dort heißt er "Session minimieren" und legt sie ab,
              ohne sie zu beenden - hier tut er für die Pause genau dasselbe.
            */}
            <button
              type="button"
              onClick={onMinimize}
              aria-label="Pause minimieren"
              title="Pause minimieren"
              className={cn(
                'flex h-12 w-12 shrink-0 items-center justify-center rounded-control transition',
                'border border-accent-contrast/25 text-accent-contrast/80 hover:bg-accent-contrast/10',
                // Der Ring der App ist Tinte - auf Tinte wäre er unsichtbar.
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-contrast',
              )}
            >
              <ChevronDown size={20} />
            </button>
          </div>

          <div className="flex flex-1 flex-col items-center justify-center gap-5">
            <p
              aria-hidden="true"
              className="font-display text-[min(34vw,26vh)] font-extrabold leading-none tabular-nums tracking-tight"
            >
              {label}
            </p>

            {/*
              Der Balken füllt sich, statt zu schrumpfen: er zeigt, wie viel
              der Pause schon herum ist. Nur `transform`, damit die Sekunde
              nichts umbricht.
            */}
            <div
              aria-hidden="true"
              className="h-1.5 w-full overflow-hidden rounded-full bg-accent-contrast/15"
            >
              <div
                className="h-full origin-left rounded-full bg-highlight transition-transform duration-1000 ease-linear"
                style={{ transform: `scaleX(${elapsedFraction})` }}
              />
            </div>

            {nextLabel ? (
              <div className="text-center">
                <p className="font-display text-lg font-extrabold tracking-tight">
                  Danach: {nextLabel}
                </p>
                {nextValues ? (
                  <p className="text-sm text-accent-contrast/65">{nextValues}</p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onExtend}
              className={cn(
                'flex min-h-touch flex-1 items-center justify-center rounded-full px-4',
                'border border-accent-contrast/25 text-[15px] font-bold text-accent-contrast/85 transition hover:bg-accent-contrast/10',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-contrast focus-visible:ring-offset-2 focus-visible:ring-offset-accent',
              )}
            >
              +30 s
            </button>
            <button
              type="button"
              onClick={onFinish}
              className={cn(
                'flex min-h-touch flex-1 items-center justify-center rounded-full px-4',
                // Die Handlung ist hier Papier: auf Tinte trägt nur sie.
                'bg-accent-contrast text-[15px] font-bold text-accent transition hover:opacity-90',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-contrast focus-visible:ring-offset-2 focus-visible:ring-offset-accent',
              )}
            >
              Weiter
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
