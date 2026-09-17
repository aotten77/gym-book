/**
 * Wie eine Übung geht - aufbereitet für den Block "Ausführung" im Sheet.
 *
 * Bis hierher stand die Anleitung im Training nirgends: das Sheet zeigte Name,
 * Ziel und Pause, und die Workout-Notiz ("Direkt nach dem Couch Stretch") wurde
 * zwar in die Einheit kopiert, aber nie angezeigt. Beides half also genau dort
 * nicht, wo man es braucht - vor dem ersten Satz an der Übung.
 *
 * Rein wie [session-summary.ts]: drei Zeichenketten herein, eine Beschreibung
 * heraus. Die Komponente entscheidet nur noch, wie viel davon zu sehen ist.
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
   * Die Anleitung Zeile für Zeile, leere Zeilen entfernt.
   *
   * Zeilen und nicht Sätze: wer die Anleitung als Liste schreibt, meint eine
   * Regel pro Zeile. Fließtext bleibt eine einzige Zeile - ihn an Punkten zu
   * zerschneiden hieße, "ca. 90 Grad" in zwei Regeln zu zerlegen.
   */
  lines: string[];
  tempo?: string;
  notes?: string;
  /**
   * Was zugeklappt steht: die erste Zeile der Anleitung.
   *
   * Deshalb gehört die wichtigste Regel nach oben. Ohne Anleitung rückt die
   * Notiz nach, sonst das Tempo - ein zugeklappter Block, der nichts verrät,
   * wäre nur ein Knopf mehr.
   */
  teaser: string;
}

function clean(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** `null`, wenn es zu dieser Übung nichts zu sagen gibt - dann kein Block. */
export function buildExerciseGuide({
  instructions,
  tempo,
  notes,
}: ExerciseGuideInput): ExerciseGuide | null {
  const lines = (instructions ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const cleanTempo = clean(tempo);
  const cleanNotes = clean(notes);
  const teaser = lines[0] ?? cleanNotes ?? (cleanTempo ? `Tempo ${cleanTempo}` : undefined);

  if (!teaser) {
    return null;
  }

  return { lines, tempo: cleanTempo, notes: cleanNotes, teaser };
}
