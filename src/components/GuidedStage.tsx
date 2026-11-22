import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { applyThemeColor, INK_THEME_COLOR } from '@/lib/theme-color';
import { cn } from '@/lib/utils';

/**
 * Hell oder dunkel: der Start-Screen steht auf Papier, die Screens des
 * laufenden Ablaufs auf Tinte.
 */
export type GuidedStageTone = 'light' | 'dark';

interface GuidedStageProps {
  /** Zugänglicher Name des Screens - der Name der Vorlage. */
  label: string;
  /** Welcher Screen der geführten Einheit gerade steht; für die E2E-Tests. */
  screen: string;
  /** Standard hell. Dunkel ist nur, was läuft. */
  tone?: GuidedStageTone;
  /** Weitere Test-Anker (`data-*`) für die Bühne; Werte `undefined` entfallen. */
  anchors?: Record<`data-${string}`, string | undefined>;
  children: ReactNode;
}

/**
 * Die Bühne der geführten Einheit: bildschirmfüllend, fest im Querformat.
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
 * Der Start-Screen ist **hell**: Papier wie der Rest der App, `theme-color`
 * bleibt, wie es ist. **Dunkel** (`tone="dark"`) sind die Screens des
 * laufenden Ablaufs und damit neben dem Ruhemodus die zweite dunkle Fläche der
 * App, aus demselben Grund: sie bleiben minutenlang an, ohne dass sie jemand
 * anfasst, und auf OLED kostet eine helle Fläche Strom. Tinte und Papier
 * tauschen die Rollen, es kommt keine Farbe hinzu; `theme-color` wird dann mit
 * umgestellt, weil iOS sonst dunkle Statusleisten-Schrift auf den dunklen Grund
 * zeichnet. Lime gibt es auf keinem Screen mehr als einmal.
 */
export function GuidedStage({ label, screen, tone = 'light', anchors, children }: GuidedStageProps) {
  useEffect(() => (tone === 'dark' ? applyThemeColor(INK_THEME_COLOR) : undefined), [tone]);

  return createPortal(
    <main
      aria-label={label}
      data-guided-stage={screen}
      data-guided-tone={tone}
      {...anchors}
      className={cn(
        'guided-stage flex flex-col pb-[max(0.875rem,var(--stage-inset-bottom))] pl-[max(1.125rem,var(--stage-inset-left))] pr-[max(1.125rem,var(--stage-inset-right))] pt-[max(0.75rem,var(--stage-inset-top))]',
        tone === 'dark' ? 'bg-accent text-accent-contrast' : 'bg-app text-content',
      )}
    >
      {children}
    </main>,
    document.body,
  );
}
