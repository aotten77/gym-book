import type { SetTimerState } from '@/domain/models';

/** Zeit, die ein Timer bekommt, wenn weder Satz noch Übung eine vorgibt. */
export const DEFAULT_SET_TIMER_SECONDS = 60;

/** Schrittweite der Plus/Minus-Tasten - grob genug für nasse Finger. */
export const SET_TIMER_STEP_SECONDS = 15;

const MIN_SET_TIMER_SECONDS = 5;
/** Eine Stunde reicht für jeden Halt und fängt Vertipper wie "6000" ab. */
const MAX_SET_TIMER_SECONDS = 3600;

/**
 * Begrenzt eine Dauer auf einen sinnvollen Bereich.
 *
 * Ohne Untergrenze ließe ein leeres oder auf 0 gedrücktes Feld einen Timer
 * starten, der im selben Moment abläuft.
 */
export function clampSetTimerSeconds(seconds: number) {
  if (!Number.isFinite(seconds)) {
    return DEFAULT_SET_TIMER_SECONDS;
  }

  return Math.min(MAX_SET_TIMER_SECONDS, Math.max(MIN_SET_TIMER_SECONDS, Math.round(seconds)));
}

/**
 * Bestimmt, über welche Zeit der Timer läuft.
 *
 * Vorrang hat der Wert, der im Satz steht: er ist die Stelle, an der die Zeit
 * angepasst wird. Erst danach greift die Vorgabe der Übung - und zuletzt ein
 * fester Rückfall, damit die Taste nie ins Leere läuft.
 */
export function resolveSetTimerSeconds(enteredSeconds?: number, targetSeconds?: number) {
  const candidate = [enteredSeconds, targetSeconds].find(
    (value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0,
  );

  return clampSetTimerSeconds(candidate ?? DEFAULT_SET_TIMER_SECONDS);
}

/** Verbleibende Sekunden, nie negativ - ein abgelaufener Timer steht auf 0. */
export function remainingSetTimerSeconds(timer: SetTimerState | undefined, now: number) {
  if (!timer) {
    return 0;
  }

  return Math.max(0, Math.ceil((timer.endsAt - now) / 1000));
}

/**
 * Tatsächlich gehaltene Zeit.
 *
 * Das ist der Wert, der beim Stoppen in den Satz geschrieben wird: wer den
 * Plank nach 1:47 abbricht, hat 107 Sekunden geschafft, nicht die geplanten
 * 120. Nach oben durch die gestartete Dauer begrenzt, damit ein Timer, der im
 * Hintergrund weiterlief, keine Fantasiewerte liefert.
 */
export function elapsedSetTimerSeconds(timer: SetTimerState | undefined, now: number) {
  if (!timer) {
    return 0;
  }

  const elapsed = timer.durationSeconds - remainingSetTimerSeconds(timer, now);

  return Math.min(timer.durationSeconds, Math.max(0, elapsed));
}

/** Ob der laufende Timer zu genau dieser Satzzeile gehört. */
export function isSetTimerFor(timer: SetTimerState | undefined, setLogId: string) {
  return timer?.setLogId === setLogId;
}
