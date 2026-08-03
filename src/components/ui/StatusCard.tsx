import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/*
 * Die beiden Zustände der laufenden Einheit als Bauteile für den Rest der App.
 *
 * In der Session malt [SessionBlockCard.tsx] sie längst: Limette heißt "jetzt
 * dran", Waldgrün heißt "erledigt". Beide Zustände gibt es auf jedem Screen -
 * das nächste Workout *ist* jetzt dran, jeder Verlaufseintrag *ist* erledigt -
 * sie wurden nur nirgends gemalt. Die Klassenketten stammen deshalb wörtlich
 * von dort und nicht aus einer zweiten, leicht abweichenden Erfindung.
 *
 * Zwei Regeln stecken in den Bauteilen selbst:
 * - Limette ist Fläche, niemals Textfarbe (auf hellem Grund 1,3:1).
 * - Nebentext auf gefüllter Fläche läuft über `opacity-75`, wie im Block - ein
 *   eigener "gedämpft auf Füllung"-Token wäre eine vierte Bedeutung für eine
 *   Farbe, die schon drei hat.
 *
 * Und eine Regel gilt für die Seiten, die sie benutzen: **genau ein
 * Limettenfeld pro Screen.** Zwei Flächen "jetzt dran" heben sich gegenseitig
 * auf. Waldgrün darf sich dagegen wiederholen - erledigt sind viele Dinge
 * gleichzeitig.
 */

const NOW_SURFACE = 'rounded-card bg-highlight text-highlight-contrast shadow-soft';
const DONE_SURFACE = 'rounded-card bg-success text-success-contrast';
const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-app';

interface NowCardProps {
  /** Kurze Einordnung über dem Titel, z. B. "Am längsten her". */
  eyebrow: string;
  title: string;
  subtitle?: ReactNode;
  /**
   * Rechte Spalte: bei einem klickbaren Container reine Zierde (Pfeil, Play),
   * sonst ein Tinten-Knopf mit mindestens 44px.
   */
  action?: ReactNode;
  /**
   * Macht die ganze Karte zum Knopf.
   *
   * Dann darf `action` kein Bedienelement mehr sein - ein Knopf im Knopf ist
   * ungültiges HTML und für Sprachbedienung nicht auflösbar.
   */
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

export function NowCard({
  eyebrow,
  title,
  subtitle,
  action,
  onClick,
  disabled,
  className,
}: NowCardProps) {
  const body = (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] opacity-75">{eyebrow}</p>
        {/* Der Name ist die Antwort auf "was mache ich heute" - er trägt die Karte. */}
        <p className="mt-1 font-display text-xl font-bold tracking-tight">{title}</p>
        {subtitle ? <p className="mt-1 text-sm opacity-75">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );

  if (!onClick) {
    return <section className={cn(NOW_SURFACE, 'p-4', className)}>{body}</section>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        NOW_SURFACE,
        'block w-full p-4 text-left transition',
        FOCUS_RING,
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      {body}
    </button>
  );
}

interface DoneCardProps {
  eyebrow: string;
  title: string;
  subtitle?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/**
 * "Erledigt" als gefüllte Karte - für das, was tatsächlich schon geschehen ist.
 *
 * Bei null erledigten Dingen gehört hier **keine** Karte hin: eine waldgrüne
 * Fläche über "0 Einheiten" behauptet einen Zustand, der nicht vorliegt. Die
 * Aufrufstelle zeigt dann eine gewöhnliche Karte mit einem Hinweis.
 */
export function DoneCard({ eyebrow, title, subtitle, children, className }: DoneCardProps) {
  return (
    <section className={cn(DONE_SURFACE, 'p-4', className)}>
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] opacity-75">{eyebrow}</p>
      <p className="mt-1 font-display text-xl font-bold tracking-tight">{title}</p>
      {subtitle ? <p className="mt-1 text-sm opacity-75">{subtitle}</p> : null}
      {children ? <div className="mt-3">{children}</div> : null}
    </section>
  );
}

interface DoneRowProps {
  title: string;
  meta?: ReactNode;
  /** Ziersymbol links, üblicherweise ein Haken. */
  icon?: ReactNode;
  className?: string;
}

/** Dieselbe Aussage in einer Zeile: erledigt braucht wenig Platz. */
export function DoneRow({ title, meta, icon, className }: DoneRowProps) {
  return (
    <div className={cn(DONE_SURFACE, 'flex items-center gap-2.5 px-4 py-3', className)}>
      {icon ? <span className="shrink-0 opacity-75">{icon}</span> : null}
      <p className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</p>
      {meta ? <p className="shrink-0 text-xs tabular-nums opacity-75">{meta}</p> : null}
    </div>
  );
}
