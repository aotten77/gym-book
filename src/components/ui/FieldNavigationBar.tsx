import type { MouseEvent, ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FieldNavigationBarProps {
  canGoPrevious: boolean;
  canGoNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onDismiss: () => void;
}

/**
 * Die Leiste über der Tastatur.
 *
 * Ersatz für das, was Safari von sich aus mitbringt und einer vom Homescreen
 * gestarteten App vorenthält: zurück, weiter, Tastatur zu. Sie steht im Fuß des
 * Sheets, weil der am `visualViewport` hängt und damit genau dort liegt, wo iOS
 * seine eigene Leiste hinsetzen würde.
 *
 * Neutral in Tinte - kein Limette, kein Waldgrün. Die eine Limettenfläche des
 * Bildschirms liegt bereits auf der aktiven Satzzeile, und "weiter zum nächsten
 * Feld" ist ohnehin kein Zustand, den die drei Farben beschreiben.
 */
export function FieldNavigationBar({
  canGoPrevious,
  canGoNext,
  onPrevious,
  onNext,
  onDismiss,
}: FieldNavigationBarProps) {
  return (
    <div
      data-field-nav=""
      role="group"
      aria-label="Feldnavigation"
      className="mb-2 flex items-center justify-between gap-2"
    >
      <div className="flex items-center gap-2">
        <NavButton label="Vorheriges Feld" onPress={onPrevious} disabled={!canGoPrevious}>
          <ChevronLeft size={20} />
        </NavButton>
        <NavButton label="Nächstes Feld" onPress={onNext} disabled={!canGoNext}>
          <ChevronRight size={20} />
        </NavButton>
      </div>

      <NavButton label="Tastatur schließen" onPress={onDismiss} className="w-auto px-4 text-sm">
        Fertig
      </NavButton>
    </div>
  );
}

/**
 * Ein Knopf, der den Fokus im Feld lässt.
 *
 * `preventDefault` auf `mousedown` ist hier die ganze Mechanik: ohne das
 * verliert das Eingabefeld beim Antippen den Fokus, iOS klappt die Tastatur zu -
 * und der Sprung, für den man getippt hat, ginge ins Leere. Bewusst `mousedown`
 * und nicht `pointerdown`: WebKit unterdrückt mit einem abgefangenen
 * `pointerdown` mitunter auch den `click`, und dann käme der Sprung gar nicht
 * erst an.
 */
function NavButton({
  label,
  onPress,
  disabled,
  className,
  children,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onMouseDown={(event: MouseEvent<HTMLButtonElement>) => event.preventDefault()}
      onClick={onPress}
      className={cn(
        'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control font-semibold transition',
        'bg-surface-raised text-content-secondary hover:bg-surface-hover',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
        'disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
    >
      {children}
    </button>
  );
}
