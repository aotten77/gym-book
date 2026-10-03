import { ChevronRight } from 'lucide-react';
import type { ExerciseGuide } from '@/domain/exercise-guide';
import { cn } from '@/lib/utils';

/**
 * Die Zeile "Ausführung" unter dem Kopf der Bühne.
 *
 * Sie zeigt nur den Teaser und öffnet das Info-Modal ([ExerciseInfoDialog]),
 * statt im Sheet aufzuklappen: man liest die Anleitung einmal vor dem ersten
 * Satz und nicht vor jedem, und aufgeklappt schob sie die Wertefelder nach
 * unten - die sollen das Größte auf dem Bildschirm bleiben. Die erste Zeile
 * steht trotzdem da: eine Zeile, die nichts verrät, wird nie geöffnet.
 *
 * Einzeilig und abgeschnitten, damit sich bei langen Anleitungen nichts
 * verschiebt. Neutral in Tinte auf der weißen Fläche der Wertebox: die eine
 * Limettenfläche des Sheets ist die aktive Satzzeile, und eine Anleitung ist
 * kein Zustand.
 */
export function ExerciseGuideBlock({ guide, onOpen }: { guide: ExerciseGuide; onOpen: () => void }) {
  return (
    <div data-exercise-guide="" className="rounded-panel bg-surface">
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={(event) => {
          // Safari fokussiert einen angetippten Knopf nicht. Ohne das hier
          // merkte sich das Modal den Body als Auslöser und gäbe den Fokus
          // beim Schließen nirgendwohin zurück.
          event.currentTarget.focus();
          onOpen();
        }}
        className={cn(
          'flex min-h-touch w-full items-center gap-2 rounded-panel px-3 py-2 text-left transition',
          'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        )}
      >
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.16em] text-content-muted">
          Ausführung
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-content">{guide.teaser}</span>
        <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-content-muted" />
      </button>
    </div>
  );
}
