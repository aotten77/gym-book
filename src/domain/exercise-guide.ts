import { parseMarkdownLite, toPlainText, type Inline, type MarkdownBlock } from '@/lib/markdown-lite';

/**
 * Wie eine Übung geht - aufbereitet für den Block "Ausführung" im Sheet.
 *
 * Bis hierher stand die Anleitung im Training nirgends: das Sheet zeigte Name,
 * Ziel und Pause, und die Workout-Notiz ("Direkt nach dem Couch Stretch") wurde
 * zwar in die Einheit kopiert, aber nie angezeigt. Beides half also genau dort
 * nicht, wo man es braucht - vor dem ersten Satz an der Übung.
 *
 * Rein wie [session-summary.ts]: drei Zeichenketten herein, eine Beschreibung
 * heraus. Die Zeile im Sheet zeigt den Teaser, das Info-Modal den Rest.
 */

export interface ExerciseGuideInput {
  /** `Exercise.instructions` - wie die Übung geht, für jedes Workout gleich. */
  instructions?: string;
  /** `Exercise.tempo`, etwa `3-1-1`. */
  tempo?: string;
  /** Die Notiz der Zuordnung - was nur in *diesem* Workout gilt. */
  notes?: string;
}

export interface ExerciseGuide {
  /**
   * Die Anleitung als Markdown-Blöcke ([markdown-lite.ts]).
   *
   * Eine Regel pro Listenpunkt, nicht pro Satz: Fließtext bleibt ein Absatz -
   * ihn an Punkten zu zerschneiden hieße, "ca. 90 Grad" in zwei Regeln zu
   * zerlegen. Wer gliedern will, schreibt eine Liste.
   */
  blocks: MarkdownBlock[];
  tempo?: string;
  notes?: string;
  /**
   * Was in der Zeile im Sheet steht: die erste Zeile, die keine Überschrift
   * ist, ohne Auszeichnung.
   *
   * Deshalb gehört die wichtigste Regel nach oben und die Herkunft ("Neu seit
   * 30.09.") ans Ende. Ohne solche Zeile rückt die Notiz nach, dann das Tempo,
   * zuletzt die Überschrift selbst - eine Anleitung, die nur aus "Achtung"
   * besteht, soll trotzdem erreichbar sein.
   */
  teaser: string;
}

function clean(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function firstLine(blocks: MarkdownBlock[]): Inline[] | undefined {
  for (const block of blocks) {
    if (block.kind === 'list') {
      return block.items[0];
    }

    if (block.kind === 'paragraph') {
      return block.lines[0];
    }
  }

  return undefined;
}

function firstHeading(blocks: MarkdownBlock[]): Inline[] | undefined {
  const heading = blocks.find((block) => block.kind === 'heading');
  return heading?.kind === 'heading' ? heading.content : undefined;
}

/** `null`, wenn es zu dieser Übung nichts zu sagen gibt - dann keine Zeile. */
export function buildExerciseGuide({
  instructions,
  tempo,
  notes,
}: ExerciseGuideInput): ExerciseGuide | null {
  const blocks = parseMarkdownLite(instructions ?? '');
  const cleanTempo = clean(tempo);
  const cleanNotes = clean(notes);
  const line = firstLine(blocks);
  const heading = firstHeading(blocks);
  const teaser =
    (line ? toPlainText(line) : undefined) ??
    cleanNotes ??
    (cleanTempo ? `Tempo ${cleanTempo}` : undefined) ??
    (heading ? toPlainText(heading) : undefined);

  if (!teaser) {
    return null;
  }

  return { blocks, tempo: cleanTempo, notes: cleanNotes, teaser };
}
