/**
 * Hält den Bildschirm wach, solange eine Einheit läuft.
 *
 * Der Anlass ist kein Komfort, sondern ein kaputtes Signal: schaltet iOS das
 * Display ab, friert es die Web-App ein - kein Intervall tickt mehr, und der
 * `AudioContext` wird stummgeschaltet. Ein Satz-Timer über 60 Sekunden läuft
 * dann zwar rechnerisch weiter (er hängt an `endsAt`, nicht am Tick), sein
 * Ablauf fällt aber erst beim Entsperren auf - und dort unterdrückt
 * [isChimeFresh] den Ton, weil eine verspätete Meldung ein Schreck wäre statt
 * eines Hinweises. Bleibt der Bildschirm an, kommt der Ton pünktlich.
 *
 * Zwei Eigenheiten der Screen Wake Lock API bestimmen den Aufbau:
 *
 * - Das System gibt die Sperre eigenmächtig frei, sobald das Dokument nicht
 *   mehr sichtbar ist - also bei jedem App-Wechsel und bei jedem manuellen
 *   Sperren des Geräts. Sie muss beim Zurückkommen neu angefordert werden,
 *   sonst gilt sie nach dem ersten Blick aufs Handy nicht mehr.
 * - Angefordert werden darf nur bei sichtbarem Dokument; sonst wirft der
 *   Aufruf. Ein Fehlschlag ist hier nie fatal (Safari vor 16.4 kennt die API
 *   gar nicht, ein fast leerer Akku verweigert sie): dann geht das Display
 *   eben aus, wie bisher auch.
 */

/** Gibt es die API überhaupt? Safari kann sie erst ab iOS 16.4. */
export function isScreenWakeLockSupported() {
  return typeof navigator !== 'undefined' && Boolean(navigator.wakeLock);
}

/**
 * Fordert die Bildschirmsperre an und hält sie über Sichtbarkeitswechsel
 * hinweg. Der Rückgabewert gibt sie endgültig frei.
 *
 * Idempotent gegenüber sich überlappenden Anforderungen: `pending` verhindert,
 * dass zwei kurz aufeinanderfolgende Wechsel zwei Sperren erzeugen, von denen
 * die erste niemand mehr freigeben könnte.
 */
export function keepScreenAwake(): () => void {
  const wakeLock = typeof navigator === 'undefined' ? undefined : navigator.wakeLock;

  if (!wakeLock) {
    return () => undefined;
  }

  let sentinel: WakeLockSentinel | null = null;
  let stopped = false;
  let pending = false;

  // Vom System freigegeben - nicht von uns. Die Spur wird nur vergessen; neu
  // angefordert wird erst, wenn das Dokument wieder sichtbar ist.
  const handleRelease = () => {
    sentinel = null;
  };

  const acquire = async () => {
    if (stopped || pending || sentinel || document.visibilityState !== 'visible') {
      return;
    }

    pending = true;

    try {
      const next = await wakeLock.request('screen');

      if (stopped) {
        // Zwischen Anforderung und Antwort ist die Einheit beendet worden.
        void next.release().catch(() => {});
        return;
      }

      next.addEventListener('release', handleRelease);
      sentinel = next;
    } catch {
      // Kein Wachhalten - kein Grund, irgendetwas anderes scheitern zu lassen.
    } finally {
      pending = false;
    }
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      void acquire();
    }
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  void acquire();

  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', handleVisibilityChange);

    const current = sentinel;
    sentinel = null;

    if (current) {
      current.removeEventListener('release', handleRelease);
      void current.release().catch(() => {});
    }
  };
}
