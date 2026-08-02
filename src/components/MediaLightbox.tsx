import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { ExerciseMedia } from '@/components/ExerciseMedia';
import { IconButton } from '@/components/ui/Button';
import type { MediaAsset } from '@/domain/models';

interface MediaLightboxProps {
  mediaAsset?: MediaAsset;
  alt: string;
  onClose: () => void;
}

/**
 * Zeigt ein Übungsbild formatfüllend.
 *
 * In der Karte ist das Bild auf 160px beschnitten - genug, um die Übung
 * wiederzuerkennen, zu wenig für den Ablauf im Detail. Deshalb hier
 * `object-contain` statt `object-cover`: nichts wird abgeschnitten.
 */
export function MediaLightbox({ mediaAsset, alt, onClose }: MediaLightboxProps) {
  useEffect(() => {
    if (!mediaAsset) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    // Hintergrund nicht mitscrollen lassen, solange die Ansicht offen ist.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [mediaAsset, onClose]);

  if (!mediaAsset) {
    return null;
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
      /*
        Die Lightbox bleibt bewusst dunkel, auch wenn die App hell ist: ein
        Bild beurteilt man vor dunklem Grund, und der Rand soll nicht mit ihm
        um Aufmerksamkeit ringen. Deshalb stehen Knopf und Bildunterschrift
        hier auf eigenen hellen Farben statt auf den Tokens.
      */
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-content/90 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-sm"
    >
      <div className="flex w-full max-w-md justify-end">
        <IconButton
          label="Bild schließen"
          onClick={onClose}
          className="border-transparent bg-app/15 text-app hover:bg-app/25"
        >
          <X size={18} />
        </IconButton>
      </div>
      {/*
        Der Tap auf das Bild selbst darf nicht schließen - sonst trifft man
        beim Heranschieben des Telefons versehentlich daneben.
      */}
      <div className="mt-3 w-full max-w-md" onClick={(event) => event.stopPropagation()}>
        <ExerciseMedia
          mediaAsset={mediaAsset}
          alt={alt}
          className="max-h-[75dvh] w-full bg-transparent"
          imageClassName="h-full w-full object-contain"
        />
      </div>
      <p className="mt-3 max-w-md text-center text-sm text-app/80">{alt}</p>
    </div>,
    document.body,
  );
}
