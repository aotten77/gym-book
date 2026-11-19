/**
 * Die Auskunft, warum bei laufender Einheit kein zweites Training startet.
 *
 * Der Rückweg selbst steht woanders (der Streifen unten, im Jetzt-Sheet die
 * Zeile „Training läuft · zurück“). Was bleibt, ist der Grund: solange eine
 * Session läuft, führt jeder Workout-Tap dorthin zurück, statt ein zweites zu
 * starten. Ohne den Satz wirkt das wie ein Defekt. Home und Jetzt-Sheet teilen
 * ihn, damit er an beiden Orten dasselbe sagt.
 */
export function ActiveSessionHint() {
  return (
    <p className="px-1 text-sm text-content-muted">
      Ein Training läuft bereits. Schließe es ab oder brich es ab, um ein anderes Workout zu
      starten.
    </p>
  );
}
