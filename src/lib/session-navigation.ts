import type { NavigateFunction } from 'react-router-dom';

/**
 * Der Navigationsstate eines frischen Starts: "öffne das Fokus-Sheet".
 *
 * Er reist im History-State mit und nicht in der URL: ein Lesezeichen, ein
 * Link oder die Rückkehr über den Streifen sollen das Sheet nie öffnen, nur der
 * Moment, in dem man die Einheit eben gestartet hat.
 */
interface OpenFocusState {
  openFocus: true;
}

/** Typwächter für `location.state`, das von außen als `unknown` kommt. */
export function readOpenFocusState(state: unknown): state is OpenFocusState {
  return (
    typeof state === 'object' &&
    state !== null &&
    (state as { openFocus?: unknown }).openFocus === true
  );
}

/**
 * Führt nach einem *frischen* Start in die Session und bittet sie, das
 * Fokus-Sheet auf dem ersten offenen Block zu öffnen.
 *
 * Nicht für die Rückkehr in eine laufende Session (Streifen, "Läuft gerade"):
 * dort liest man erst, wo man war.
 */
export function navigateToStartedSession(navigate: NavigateFunction, sessionId: string): void {
  navigate(`/session/${sessionId}`, { state: { openFocus: true } satisfies OpenFocusState });
}
