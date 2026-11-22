import { useCallback } from 'react';
import { useLocation, useNavigate, type NavigateFunction } from 'react-router-dom';

/**
 * Der Navigationsstate, den der Plan an Links in Detailseiten hängt: "ich komme
 * vom Zeitstrahl". Er reist im History-State mit und nicht in der URL - ein
 * Lesezeichen oder ein Kaltstart auf der Detailseite trägt ihn nie.
 */
export const FROM_PLAN_STATE = { from: 'plan' } as const;

/** Typwächter für `location.state`, das von außen als `unknown` kommt. */
export function readFromPlanState(state: unknown): boolean {
  return typeof state === 'object' && state !== null && (state as { from?: unknown }).from === 'plan';
}

/**
 * Zurück zum Herkunftsort einer Detailseite.
 *
 * Nur wer ausdrücklich vom Plan kam, geht einen Schritt im Verlauf zurück -
 * dort wartet die Position des Zeitstrahls. Ohne die Markierung (Deep Link,
 * Kaltstart, Fortschritt) führt der Weg in den Verlauf: `navigate(-1)` könnte
 * dort ins Leere oder aus der App führen.
 */
export function goBackToOrigin(navigate: NavigateFunction, state: unknown): void {
  if (readFromPlanState(state)) {
    navigate(-1);
    return;
  }

  navigate('/history');
}

/** Das Zurück einer Detailseite: `fromPlan` sagt, wohin es geht, `goBack` geht dorthin. */
export function useBackToOrigin() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const goBack = useCallback(() => goBackToOrigin(navigate, state), [navigate, state]);

  return { fromPlan: readFromPlanState(state), goBack };
}
