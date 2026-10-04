import { Fragment, type ReactNode } from 'react';
import type { Inline, MarkdownBlock } from '@/lib/markdown-lite';
import { cn } from '@/lib/utils';

interface MarkdownTextProps {
  blocks: MarkdownBlock[];
  /** Enger gesetzt - für Karte und Übungsauswahl, wo der Text Beiwerk ist. */
  compact?: boolean;
  className?: string;
}

function renderInline(content: Inline[]) {
  return content.map((span, index) => {
    let node: ReactNode = span.text;

    if (span.emphasis) {
      node = <em>{node}</em>;
    }

    if (span.strong) {
      node = <strong className="font-semibold text-content">{node}</strong>;
    }

    return <Fragment key={index}>{node}</Fragment>;
  });
}

/**
 * Rendert eine Anleitung aus [markdown-lite.ts].
 *
 * Elemente statt HTML-String: was im Text steht, bleibt Text, auch ein `<b>`.
 * `overflow-wrap:anywhere`, weil ein langes Wort ohne Leerzeichen bei 320px
 * sonst die ganze Seite seitlich verschiebt.
 */
export function MarkdownText({ blocks, compact = false, className }: MarkdownTextProps) {
  return (
    <div
      data-markdown=""
      className={cn(compact ? 'space-y-1' : 'space-y-2', '[overflow-wrap:anywhere]', className)}
    >
      {blocks.map((block, index) => {
        if (block.kind === 'heading') {
          return (
            <h4
              key={index}
              // Keine eigene Größe: die Überschrift erbt die des Textes und
              // hebt sich nur durch Schrift und Gewicht ab - so bleibt sie
              // stimmig, wo immer der Aufrufer die Größe setzt.
              className={cn('font-display font-bold text-content', !compact && 'pt-1')}
            >
              {renderInline(block.content)}
            </h4>
          );
        }

        if (block.kind === 'list') {
          const ListTag = block.ordered ? 'ol' : 'ul';

          return (
            <ListTag
              key={index}
              start={block.ordered && block.start !== 1 ? block.start : undefined}
              className={cn(block.ordered ? 'list-decimal' : 'list-disc', 'space-y-1 pl-5')}
            >
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInline(item)}</li>
              ))}
            </ListTag>
          );
        }

        return (
          <p key={index}>
            {block.lines.map((line, lineIndex) => (
              <Fragment key={lineIndex}>
                {lineIndex > 0 ? <br /> : null}
                {renderInline(line)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
