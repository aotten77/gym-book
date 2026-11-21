/**
 * Die Auskunft, warum bei laufender Einheit kein zweites Training startet.
 *
 * Der Rückweg selbst steht woanders (der Streifen unten, im Jetzt-Sheet die
 * Zeile „Training läuft · zurück“). Was bleibt, ist der Grund: solange eine
 * Session läuft, führt jeder Workout-Tap dorthin zurück, statt ein zweites zu
 * starten. Ohne den Satz wirkt das wie ein Defekt. Das Jetzt-Sheet zeigt ihn;
 * der Plan-Zeitstrahl braucht ihn nicht, dort sagt der Streifen es selbst.
 */
export function ActiveSessionHint() {
  return (
    <p className="px-1 text-sm text-content-muted">
      Ein Training läuft bereits. Schließe es ab oder brich es ab, um ein anderes Workout zu
      starten.
    </p>
  );
}
