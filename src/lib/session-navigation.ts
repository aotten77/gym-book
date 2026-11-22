import type { NavigateFunction } from 'react-router-dom';
import { isGuidedSession } from '@/domain/guided-run';
import type { WorkoutSession } from '@/domain/models';

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

/**
 * Der Navigationsstate des Wegs auf den Start-Screen einer geführten Vorlage:
 * der Termin, für den gestartet werden soll.
 *
 * Er reist wie `openFocus` im History-State und nicht in der URL. Ein Reload
 * verliert ihn, und das ist ehrlich: der Start verknüpft dann den passenden
 * Termin selbst, wie bei jedem Start ohne `planEntryId`.
 */
interface GuidedStartState {
  planEntryId?: string;
}

/** Liest den State des Start-Screens; alles Unbrauchbare heißt „kein Termin“. */
export function readGuidedStartState(state: unknown): GuidedStartState {
  const planEntryId =
    typeof state === 'object' && state !== null
      ? (state as { planEntryId?: unknown }).planEntryId
      : undefined;

  return typeof planEntryId === 'string' && planEntryId ? { planEntryId } : {};
}

/**
 * Führt auf den Start-Screen einer geführten Vorlage.
 *
 * Eine geführte Vorlage startet nicht in `/session/`: der Kraft-Screen kennt
 * keine Schritte. Wo sonst `startSessionFromTemplate` aufgerufen würde, geht es
 * hierhin - gestartet wird erst auf dem Start-Screen.
 */
export function navigateToGuidedStart(
  navigate: NavigateFunction,
  templateId: string,
  options: { planEntryId?: string } = {},
): void {
  navigate(`/guided/${templateId}`, {
    state: (options.planEntryId ? { planEntryId: options.planEntryId } : {}) satisfies GuidedStartState,
  });
}

/**
 * Wohin die Rückkehr in eine laufende Einheit führt: eine geführte Einheit hat
 * ihren eigenen Screen, alles andere den Session-Screen. Ohne `state`, damit
 * das Fokus-Sheet geschlossen bleibt.
 */
export function activeSessionPath(session: Pick<WorkoutSession, 'id' | 'guided'>): string {
  return isGuidedSession(session) ? `/guided/run/${session.id}` : `/session/${session.id}`;
}
