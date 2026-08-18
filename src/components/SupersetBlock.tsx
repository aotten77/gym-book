import type { ReactNode } from 'react';
import { Repeat } from 'lucide-react';

interface SupersetBlockProps {
  /** Namen der Mitglieder in ihrer Reihenfolge - nur für den zugänglichen Namen. */
  exerciseNames: string[];
  /** Bedienung des ganzen Blocks - im Training die Pfeile zum Verschieben. */
  action?: ReactNode;
  children: ReactNode;
}

/**
 * Rahmen um die Übungen eines Supersatzes.
 *
 * Bewusst ein `div` mit `role="group"` und keine `section`: die Karten darin
 * sind selbst `section`s, und zwei verschachtelte Landmarken machen die
 * Gliederung für Screenreader schlechter statt besser.
 *
 * Die Mitglieder tragen keine Kennbuchstaben. "A" und "B" benannten nur, was
 * die Reihenfolge im Block ohnehin zeigt, und nahmen dem Namen der Übung den
 * Platz, den er auf einem Telefon braucht. Im zugänglichen Namen des Blocks
 * stehen dafür die Übungsnamen selbst - zwei Supersätze bleiben so
 * unterscheidbar.
 */
export function SupersetBlock({ exerciseNames, action, children }: SupersetBlockProps) {
  return (
    /*
     * Eine Klammer, keine Karte um Karten.
     *
     * Vorher lag eine getönte Fläche mit eigenem Rand um Zeilen, die selbst
     * schon Karten mit Rand sind - drei Kanten auf zwölf Pixeln, und die
     * Gruppe wirkte schwerer als ihre Mitglieder. Der senkrechte Strich sagt
     * dasselbe (die Zeilen daneben gehören zusammen) und nimmt auf einem
     * Telefon keine Breite von den Übungsnamen weg.
     */
    <div
      role="group"
      aria-label={`Supersatz: ${exerciseNames.join(' und ')}`}
      className="border-l-2 border-accent-border pl-3"
    >
      <div className="flex items-center justify-between gap-2 pb-2">
        <p className="flex min-w-0 items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
          <Repeat size={14} className="shrink-0" aria-hidden="true" />
          <span className="truncate">Supersatz</span>
        </p>
        {action}
      </div>
      {/*
        Ohne erklärenden Satz. Er stand unter jeder Kopfzeile und erklärte in
        zwei Zeilen, was die Klammer daneben schon zeigt - in einer Liste
        mehrerer Workouts wiederholte er sich Block für Block und schob die
        Übungen nach unten, um derer willen man hier ist.
      */}
      <div className="space-y-2">{children}</div>
    </div>
  );
}
