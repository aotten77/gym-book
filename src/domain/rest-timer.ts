import { sortSetLogs } from '@/domain/history';
import type { RestTimerTrack, Side, WorkoutSetLog } from '@/domain/models';

/** Pause, wenn weder Übung noch Aufrufer eine vorgibt. */
export const DEFAULT_REST_SECONDS = 90;

/** Schrittweite der Verlängern-Taste - grob genug für nasse Finger. */
export const REST_TIMER_STEP_SECONDS = 30;

/**
 * Schrittweite der Verkürzen-Taste - halb so groß wie die zum Verlängern.
 *
 * Verlängern und Verkürzen sind nicht dasselbe Bedürfnis: verlängert wird,
 * weil der Satz schwer war, und dann in spürbaren Blöcken. Verkürzt wird,
 * weil man schon wieder kann - das ist eine Korrektur am Rand der Pause, und
 * eine zu große Stufe überspringt sie ganz.
 */
export const REST_TIMER_SHORTEN_SECONDS = 15;

const MIN_REST_SECONDS = 5;
/** Eine Stunde reicht für jede Pause und fängt Vertipper wie "9000" ab. */
const MAX_REST_SECONDS = 3600;

/**
 * Wie lange eine abgelaufene Spur noch stehen bleibt.
 *
 * Abgelaufene Spuren verschwinden bewusst nicht sofort: "diese Übung ist
 * wieder frei" ist genau die Auskunft, die man beim Zurückwechseln sucht.
 * Nach zehn Minuten ist sie nichts mehr wert und würde nur die Leiste
 * zustellen.
 */
export const REST_TRACK_GRACE_SECONDS = 600;

/**
 * Begrenzt eine Pausendauer auf einen sinnvollen Bereich.
 *
 * Ohne Untergrenze liefe ein auf 0 gesetzter Wert im selben Moment ab, in dem
 * er startet.
 */
export function clampRestSeconds(seconds: number) {
  if (!Number.isFinite(seconds)) {
    return DEFAULT_REST_SECONDS;
  }

  return Math.min(MAX_REST_SECONDS, Math.max(MIN_REST_SECONDS, Math.round(seconds)));
}

/** Eindeutiger Schlüssel einer Spur: eine Pause je Übung und Seite. */
export function restTrackKey(sessionExerciseId: string, side: Side) {
  return `${sessionExerciseId}:${side}`;
}

export function findRestTrack(
  tracks: RestTimerTrack[] | undefined,
  sessionExerciseId: string,
  side: Side,
) {
  return tracks?.find(
    (track) => track.sessionExerciseId === sessionExerciseId && track.side === side,
  );
}

/**
 * Setzt eine Spur - ersetzt sie, wenn Übung und Seite schon eine haben.
 *
 * Ein zweiter Satz derselben Seite löst die alte Pause ab, statt eine zweite
 * daneben zu stellen: es gibt nur eine Pause je Übung und Seite.
 */
export function upsertRestTrack(tracks: RestTimerTrack[] | undefined, track: RestTimerTrack) {
  const rest = (tracks ?? []).filter(
    (entry) =>
      entry.sessionExerciseId !== track.sessionExerciseId || entry.side !== track.side,
  );

  return [...rest, track];
}

export function removeRestTrack(
  tracks: RestTimerTrack[] | undefined,
  sessionExerciseId: string,
  side: Side,
) {
  return (tracks ?? []).filter(
    (track) => track.sessionExerciseId !== sessionExerciseId || track.side !== side,
  );
}

export function removeRestTracksForExercise(
  tracks: RestTimerTrack[] | undefined,
  sessionExerciseId: string,
) {
  return (tracks ?? []).filter((track) => track.sessionExerciseId !== sessionExerciseId);
}

/** Verbleibende Sekunden, nie negativ - eine abgelaufene Spur steht auf 0. */
export function remainingRestSeconds(track: RestTimerTrack | undefined, now: number) {
  if (!track) {
    return 0;
  }

  return Math.max(0, Math.ceil((track.endsAt - now) / 1000));
}

/** Ob die Pause vorbei ist - die Übung ist wieder dran. */
export function isRestTrackReady(track: RestTimerTrack, now: number) {
  return track.endsAt <= now;
}

/** Wirft Spuren weg, deren Ablauf lange genug her ist - siehe Karenzzeit. */
export function pruneRestTracks(tracks: RestTimerTrack[] | undefined, now: number) {
  return (tracks ?? []).filter(
    (track) => track.endsAt > now - REST_TRACK_GRACE_SECONDS * 1000,
  );
}

/**
 * Welche Spur die große Zahl in der Leiste bekommt.
 *
 * Nur laufende Spuren kommen infrage - eine abgelaufene ist keine Pause mehr,
 * sondern eine Meldung, und die gehört in die Chips. Vorrang hat die Spur, die
 * zur nächsten offenen Satzzeile der fokussierten Übung gehört: das ist die
 * Zahl, auf die gerade gewartet wird.
 */
export function selectPrimaryRestTrack(
  tracks: RestTimerTrack[] | undefined,
  focusedSessionExerciseId: string | undefined,
  nextOpenSide: Side | undefined,
  now: number,
) {
  const running = (tracks ?? []).filter((track) => !isRestTrackReady(track, now));

  if (running.length === 0) {
    return undefined;
  }

  const soonest = (candidates: RestTimerTrack[]) =>
    [...candidates].sort((left, right) => left.endsAt - right.endsAt)[0];

  if (focusedSessionExerciseId) {
    const focused = running.filter(
      (track) => track.sessionExerciseId === focusedSessionExerciseId,
    );
    const exact = nextOpenSide
      ? focused.find((track) => track.side === nextOpenSide)
      : undefined;

    if (exact) {
      return exact;
    }

    if (focused.length > 0) {
      return soonest(focused);
    }
  }

  return soonest(running);
}

export interface RestBadge {
  remainingSeconds: number;
  isReady: boolean;
}

/**
 * Hängt jede Spur an die nächste offene Satzzeile ihrer Seite.
 *
 * Damit steht die Restzeit dort, wo die Frage entsteht - "kann ich rechts
 * schon wieder?" beantwortet sich in der Zeile für rechts. Die Karte muss
 * dafür nichts über Spuren wissen.
 */
export function buildRestBadges(
  setLogs: WorkoutSetLog[],
  tracks: RestTimerTrack[] | undefined,
  now: number,
) {
  const badges: Record<string, RestBadge> = {};

  if (!tracks?.length) {
    return badges;
  }

  const sortedLogs = sortSetLogs(setLogs);

  for (const track of tracks) {
    const target = sortedLogs.find(
      (log) =>
        log.sessionExerciseId === track.sessionExerciseId &&
        log.side === track.side &&
        !log.completed,
    );

    if (target) {
      badges[target.id] = {
        remainingSeconds: remainingRestSeconds(track, now),
        isReady: isRestTrackReady(track, now),
      };
    }
  }

  return badges;
}

/**
 * Für welche Seite der Knopf "Pause starten" die Pause anlegt.
 *
 * Die nächste offene Satzzeile bestimmt es: wer den Timer von Hand startet,
 * meint die Seite, die als Nächstes drankommt. Ohne offene Zeile bleibt
 * `both` - eine Pause ohne Seitenbezug.
 */
export function resolveManualRestTarget(
  sessionExerciseId: string,
  setLogs: WorkoutSetLog[],
): Side {
  const nextOpen = sortSetLogs(setLogs).find(
    (log) => log.sessionExerciseId === sessionExerciseId && !log.completed,
  );

  return nextOpen?.side ?? 'both';
}
