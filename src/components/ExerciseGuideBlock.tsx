import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { ExerciseGuide } from '@/domain/exercise-guide';
import { cn } from '@/lib/utils';

/**
 * Der Block "Ausführung" unter dem Kopf der Bühne.
 *
 * Zugeklappt, weil man die Anleitung einmal vor dem ersten Satz liest und
 * nicht vor jedem - die Wertefelder bleiben das Größte auf dem Bildschirm,
 * genau wie es "ein Satz ist groß" verlangt. Die erste Zeile steht trotzdem da:
 * ein Block, der zugeklappt nichts verrät, wird nie aufgeklappt.
 *
 * Der Zustand ist bewusst lokal und ungespeichert. Die Bühne trägt
 * `key={exercise.id}`, also bleibt der Block über alle Sätze derselben Übung
 * offen, sobald man ihn einmal geöffnet hat, und die nächste Übung beginnt
 * wieder zu - dort steht eine neue Anleitung.
 *
 * Neutral in Tinte auf der weißen Fläche der Wertebox: die eine
 * Limettenfläche des Sheets ist die aktive Satzzeile, und eine Anleitung ist
 * kein Zustand.
 */
export function ExerciseGuideBlock({ guide }: { guide: ExerciseGuide }) {
  const [isOpen, setIsOpen] = useState(false);
  const panelId = useId();

  return (
    <div data-exercise-guide="" className="rounded-panel bg-surface">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => setIsOpen((current) => !current)}
        className={cn(
          'flex min-h-touch w-full items-center gap-2 rounded-panel px-3 py-2 text-left transition',
          'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        )}
      >
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.16em] text-content-muted">
          Ausführung
        </span>
        {/*
          Zugeklappt die erste Zeile, abgeschnitten statt umgebrochen: zwei
          Zeilen hier schöben die Wertefelder bei jedem Satz ein Stück nach
          unten. Aufgeklappt steht der ganze Text darunter, und die Vorschau
          würde nur dieselbe Zeile doppelt zeigen.
        */}
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-sm font-semibold text-content',
            isOpen && 'invisible',
          )}
        >
          {guide.teaser}
        </span>
        <ChevronDown
          size={18}
          aria-hidden="true"
          className={cn('shrink-0 text-content-muted transition-transform', isOpen && 'rotate-180')}
        />
      </button>

      <div id={panelId} hidden={!isOpen} className="space-y-2 px-3 pb-3 text-sm text-content">
        {guide.lines.length > 1 ? (
          <ul className="list-disc space-y-1 pl-5">
            {guide.lines.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        ) : guide.lines.length === 1 ? (
          <p>{guide.lines[0]}</p>
        ) : null}

        {guide.tempo ? (
          <p className="text-content-secondary">
            <span className="font-semibold">Tempo</span> {guide.tempo}
          </p>
        ) : null}

        {/*
          Die Notiz der Zuordnung gehört nicht zur Übung, sondern zu diesem
          Workout - deshalb abgesetzt und benannt. "Direkt nach dem Couch
          Stretch" stimmt nur hier, nicht in jedem Workout mit Standwaage.
        */}
        {guide.notes ? (
          <p className="border-t border-line pt-2 text-content-secondary">
            <span className="font-semibold">In diesem Workout:</span> {guide.notes}
          </p>
        ) : null}
      </div>
    </div>
  );
}
