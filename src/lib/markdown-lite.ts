/**
 * Eine kleine, feste Markdown-Teilmenge für Übungsanleitungen.
 *
 * Die Anleitungen kommen zum größten Teil aus dem Bibliotheks-Import, also aus
 * einer Datei, die ein Planungsprojekt schreibt. Dafür reicht wenig: Fett,
 * Kursiv, Listen, eine Ebene Zwischenüberschrift und Absätze. Alles andere -
 * Links, Bilder, Tabellen, Code, HTML - bleibt wörtlicher Text. Eine kleine
 * Regel hält, wer schreibt, auch leichter ein als eine große.
 *
 * Bewusst ohne Abhängigkeit und ohne HTML: das Ergebnis ist ein Baum, aus dem
 * React Elemente baut ([MarkdownText]). Ein `<b>` im Text wird damit nie zu
 * einem Element, und ein Import kann nichts ausführen.
 */

export interface Inline {
  text: string;
  strong?: true;
  emphasis?: true;
}

export type MarkdownBlock =
  | { kind: 'paragraph'; lines: Inline[][] }
  | { kind: 'heading'; content: Inline[] }
  | { kind: 'list'; ordered: boolean; start: number; items: Inline[][] };

const HEADING = /^#{1,3} (.+)$/;
const UNORDERED_ITEM = /^[-*] (.+)$/;
const ORDERED_ITEM = /^(\d+)\. (.+)$/;
const WORD_CHARACTER = /[\p{L}\p{N}]/u;

export function parseMarkdownLite(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  // `as`, damit TypeScript `current` nicht auf `null` einengt - die
  // Zuweisungen in `close` sieht die Flussanalyse nicht.
  let current = null as MarkdownBlock | null;

  const close = () => {
    if (current) {
      blocks.push(current);
      current = null;
    }
  };

  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim();

    if (!line) {
      close();
      continue;
    }

    const heading = HEADING.exec(line);

    if (heading) {
      close();
      blocks.push({ kind: 'heading', content: parseInline(heading[1].trim()) });
      continue;
    }

    const unordered = UNORDERED_ITEM.exec(line);
    const ordered = unordered ? null : ORDERED_ITEM.exec(line);

    if (unordered || ordered) {
      const isOrdered = Boolean(ordered);
      const content = parseInline((unordered?.[1] ?? ordered?.[2] ?? '').trim());
      if (current?.kind === 'list' && current.ordered === isOrdered) {
        current.items.push(content);
      } else {
        close();
        current = {
          kind: 'list',
          ordered: isOrdered,
          start: ordered ? Number(ordered[1]) : 1,
          items: [content],
        };
      }
      continue;
    }

    if (current?.kind === 'paragraph') {
      current.lines.push(parseInline(line));
    } else {
      // Eine Zeile ohne Marker beendet eine Liste - sonst klebte der Text,
      // der nach den Punkten steht, als Fortsetzung am letzten Punkt.
      close();
      current = { kind: 'paragraph', lines: [parseInline(line)] };
    }
  }

  close();
  return blocks;
}

export function toPlainText(content: Inline[]): string {
  return content.map((span) => span.text).join('');
}

interface Marks {
  strong?: true;
  emphasis?: true;
}

function isSpace(character: string | undefined) {
  return character === undefined || /\s/.test(character);
}

function isWordCharacter(character: string | undefined) {
  return character !== undefined && WORD_CHARACTER.test(character);
}

/**
 * Sucht das schließende Zeichen zu einem öffnenden an `start`.
 *
 * Auszeichnung gilt nur, wenn sie am Text anliegt: `**fett**` ja,
 * `** fett **` und `3 * 5 * 2` nein. Ein `_` zählt nur an Wortgrenzen, damit
 * `Kurzhantel_rechts_unten` ein Wort bleibt.
 */
function findClosing(text: string, start: number, marker: string): number {
  const opening = start + marker.length;

  if (isSpace(text[opening]) || (marker.length === 1 && text[opening] === marker)) {
    return -1;
  }

  if (marker === '_' && isWordCharacter(text[start - 1])) {
    return -1;
  }

  for (let index = text.indexOf(marker, opening + 1); index !== -1; index = text.indexOf(marker, index + 1)) {
    const before = text[index - 1];
    const after = text[index + marker.length];

    if (isSpace(before) || (marker.length === 1 && (before === marker || after === marker))) {
      continue;
    }

    if (marker === '_' && isWordCharacter(after)) {
      continue;
    }

    return index;
  }

  return -1;
}

function parseInline(text: string, marks: Marks = {}): Inline[] {
  const spans: Inline[] = [];
  let buffer = '';

  const push = (span: Inline) => {
    const previous = spans[spans.length - 1];

    if (previous && previous.strong === span.strong && previous.emphasis === span.emphasis) {
      previous.text += span.text;
    } else if (span.text) {
      spans.push(span);
    }
  };

  const flush = () => {
    if (buffer) {
      push({ text: buffer, ...marks });
      buffer = '';
    }
  };

  let index = 0;

  while (index < text.length) {
    const marker = text.startsWith('**', index) ? '**' : text[index];

    if (marker === '**' || marker === '*' || marker === '_') {
      const closing = findClosing(text, index, marker);

      if (closing !== -1) {
        flush();
        const inner = text.slice(index + marker.length, closing);
        const innerMarks: Marks =
          marker === '**' ? { ...marks, strong: true } : { ...marks, emphasis: true };

        for (const span of parseInline(inner, innerMarks)) {
          push(span);
        }

        index = closing + marker.length;
        continue;
      }

      // Kein Abschluss: nur ein Zeichen wörtlich übernehmen, damit ein
      // offenes `**` das folgende `*` noch als Kursiv-Anfang prüfen lässt.
      buffer += text[index];
      index += 1;
      continue;
    }

    buffer += text[index];
    index += 1;
  }

  flush();
  return spans;
}
