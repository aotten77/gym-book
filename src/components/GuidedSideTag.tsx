import { cn } from '@/lib/utils';
import type { GuidedSide } from '@/domain/guided-steps';

interface GuidedSideTagProps {
  side: GuidedSide;
  /** Die Seite ist schon vorbei - im Seitenwechsel steht das L gedämpft vor dem R. */
  done?: boolean;
}

/**
 * Die Seite als großer Buchstabe direkt an der Überschrift.
 *
 * Er wächst mit der Schrift der Überschrift (`em`), damit ein Blick aus der
 * Entfernung genügt. Die Farbe erbt er - auf Lime steht er in Lime, auf Weiß
 * in Weiß; eine eigene Farbe wäre eine zweite Lime-Fläche.
 */
export function GuidedSideTag({ side, done = false }: GuidedSideTagProps) {
  return (
    <span
      role="img"
      aria-label={side === 'left' ? 'links' : 'rechts'}
      data-guided-side={side}
      className={cn(
        'ml-[0.22em] inline-grid h-[1.15em] min-w-[1.15em] place-items-center rounded-[0.26em] border-2 border-current px-[0.08em] align-[0.04em] text-[0.9em] leading-none',
        done && 'opacity-40',
      )}
    >
      {side === 'left' ? 'L' : 'R'}
    </span>
  );
}
