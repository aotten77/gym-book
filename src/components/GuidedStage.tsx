import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { applyThemeColor, INK_THEME_COLOR } from '@/lib/theme-color';

interface GuidedStageProps {
  /** Zugänglicher Name des Screens - der Name der Vorlage. */
  label: string;
  /** Welcher Screen der geführten Einheit gerade steht; für die E2E-Tests. */
  screen: string;
  children: ReactNode;
}

/**
 * Die Bühne der geführten Einheit: dunkel, bildschirmfüllend, fest im Querformat.
 *
 * Alle Screens der geführten Einheit - Start, Ablauf, Pause - stehen darauf.
 * Die Bühne trägt, was ihnen gemeinsam ist: die Lage, den Grund und die
 * Leistenfarbe. Was darin steht, kennt weder die Drehung noch die Ränder des
 * Geräts, es liest nur `--stage-inset-*`.
 *
 * Sie hängt per Portal an `body` und nicht in `#root`: die Hochformat-Sperre
 * dreht im Querformat `#root` zurück, und ein Screen darin stünde wieder
 * hochkant. Wie sich die Bühne selbst legt, steht in `index.css`
 * (`.guided-stage`), als Gegenstück zur Sperre.
 *
 * Neben dem Ruhemodus ist das die zweite dunkle Fläche der App, und aus
 * demselben Grund: der Screen bleibt minutenlang an, ohne dass ihn jemand
 * anfasst, und auf OLED kostet eine helle Fläche Strom. Tinte und Papier
 * tauschen die Rollen, es kommt keine Farbe hinzu; `theme-color` wird mit
 * umgestellt, weil iOS sonst dunkle Statusleisten-Schrift auf den dunklen Grund
 * zeichnet. Lime gibt es hier höchstens einmal pro Screen.
 */
export function GuidedStage({ label, screen, children }: GuidedStageProps) {
  useEffect(() => applyThemeColor(INK_THEME_COLOR), []);

  return createPortal(
    <main
      aria-label={label}
      data-guided-stage={screen}
      className="guided-stage flex flex-col bg-accent pb-[max(0.875rem,var(--stage-inset-bottom))] pl-[max(1.125rem,var(--stage-inset-left))] pr-[max(1.125rem,var(--stage-inset-right))] pt-[max(0.75rem,var(--stage-inset-top))] text-accent-contrast"
    >
      {children}
    </main>,
    document.body,
  );
}
