import { useEffect, useState } from 'react';

/**
 * Ein Sekundentakt für alles, was eine laufende Uhr anzeigt.
 *
 * Stand dreimal fast wortgleich in der App - in `SessionPage`, in
 * `ActiveSessionBar` und in `SessionStatsHeader` -, samt derselben Begründung
 * für den `visibilitychange`: im Hintergrund tickt kein Intervall, ohne den
 * Zusatz stünde nach dem Zurückwechseln bis zur nächsten Sekunde eine alte
 * Zahl.
 *
 * `enabled` ist Pflicht und hat mit Absicht keinen Vorgabewert. Ob ein Takt
 * bedingt läuft oder immer, ist an jeder der drei Stellen eine eigene
 * Entscheidung mit eigenen Kosten: `SessionPage`s `now` ist Prop jeder
 * Blockkarte, dort unbedingt zu ticken hieße, die ganze Liste sekündlich neu zu
 * zeichnen - auch während im Sheet ein Zahlenfeld den Fokus hat. Ein
 * weggelassenes Argument mit stiller Vorgabe „immer an" wäre genau der Weg
 * zurück. Deshalb steht an jeder Aufrufstelle eine Zeile, warum ihr Flag so
 * ist.
 */
export function useNowTicker(enabled: boolean) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setNow(Date.now());
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled]);

  return now;
}
