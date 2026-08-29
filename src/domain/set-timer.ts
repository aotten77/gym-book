import type { SetTimerState } from '@/domain/models';
import { formatTimer } from '@/lib/format';

/** Zeit, die ein Timer bekommt, wenn weder Satz noch Übung eine vorgibt. */
export const DEFAULT_SET_TIMER_SECONDS = 60;

/**
 * Wie weit die Uhr über die Vorgabe hinaus zählt.
 *
 * Der Countdown endet bei 0 nicht mehr von selbst: wer 45 s halten sollte und
 * 62 schafft, hatte vorher 45 im Satz stehen, und die Sekundenkurve war eine
 * Waagerechte. Gezählt wird deshalb weiter - aber nicht unbegrenzt. Im
 * Hintergrund tickt keine Uhr, die Zeit läuft trotzdem nach Zeitstempeln
 * weiter; ohne Deckel schriebe ein vergessener Timer beim Abhaken vierzehn
 * Minuten in den Satz. Zwei Minuten über der Vorgabe sind mehr, als ein Halt
 * je überzieht.
 */
export const SET_TIMER_MAX_OVERTIME_SECONDS = 120;

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
 * angepasst wird. Erst danach greift die Vorgabe der Zeile - und zuletzt ein
 * fester Rückfall, damit die Taste nie ins Leere läuft.
 *
 * `plannedSeconds` ist ausdrücklich die Vorgabe, die auch im Feld steht, nicht
 * zwingend `exercise.targetSeconds`: im Satz-Editor ist das `setRowFallback`
 * (letzte Woche schlägt Übungsziel), sonst würde der Countdown eine andere
 * Zahl stellen als der Platzhalter zeigt.
 */
export function resolveSetTimerSeconds(enteredSeconds?: number, plannedSeconds?: number) {
  const candidate = [enteredSeconds, plannedSeconds].find(
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
 * Sekunden über der Vorgabe - vor dem Ablauf 0.
 *
 * `floor` statt `ceil` wie bei der Restzeit: eine angefangene Sekunde ist noch
 * nicht gehalten. Der Deckel steht hier und nicht erst beim Schreiben, damit
 * die Uhr genau das zeigt, was der Satz nachher bekommt.
 */
export function overtimeSetTimerSeconds(timer: SetTimerState | undefined, now: number) {
  if (!timer) {
    return 0;
  }

  return Math.min(
    SET_TIMER_MAX_OVERTIME_SECONDS,
    Math.max(0, Math.floor((now - timer.endsAt) / 1000)),
  );
}

/**
 * Tatsächlich gehaltene Zeit.
 *
 * Das ist der Wert, der beim Stoppen in den Satz geschrieben wird: wer den
 * Plank nach 1:47 abbricht, hat 107 Sekunden geschafft, nicht die geplanten
 * 120 - und wer 2:12 hält, eben 132. Nach oben durch die gestartete Dauer plus
 * [SET_TIMER_MAX_OVERTIME_SECONDS] begrenzt, damit ein Timer, der im
 * Hintergrund weiterlief, keine Fantasiewerte liefert.
 */
export function elapsedSetTimerSeconds(timer: SetTimerState | undefined, now: number) {
  if (!timer) {
    return 0;
  }

  const elapsed =
    timer.durationSeconds -
    remainingSetTimerSeconds(timer, now) +
    overtimeSetTimerSeconds(timer, now);

  return Math.min(
    timer.durationSeconds + SET_TIMER_MAX_OVERTIME_SECONDS,
    Math.max(0, elapsed),
  );
}

/**
 * Ob überhaupt ein Satz-Timer läuft.
 *
 * Bewusst die Existenz und nicht `remainingSetTimerSeconds(...) > 0`: seit die
 * Uhr über die Vorgabe hinaus zählt, steht die Restzeit auf 0, während der
 * Timer weiterläuft. Der Zustand liegt auf der Session und wird beim Stoppen,
 * Verwerfen und Schließen gelöscht - er existiert also genau so lange, wie er
 * läuft.
 */
export function isSetTimerActive(timer: SetTimerState | undefined) {
  return Boolean(timer && timer.durationSeconds > 0);
}

/**
 * Was auf der Uhr steht: bis zum Ablauf die Restzeit, danach die Überzeit mit
 * Pluszeichen.
 *
 * Ein Formatierer für alle drei Uhren - Bühne, Leiste der Session und
 * [ActiveSessionBar]. Zwei sind der Weg, auf dem zwei Schirme unterschiedliche
 * Zahlen behaupten. Das Vorzeichen ist ein Plus und kein Minus: nach der
 * Vorgabe ist man darüber, nicht im Defizit.
 *
 * Nimmt die beiden Zahlen und nicht den Timer, weil die Bühne sie ohnehin als
 * Props bekommt - sie trägt auch den Fortschrittsbalken.
 */
export function formatSetTimerClock(remainingSeconds: number, overtimeSeconds: number) {
  return overtimeSeconds > 0 ? `+${formatTimer(overtimeSeconds)}` : formatTimer(remainingSeconds);
}

/** Ob der laufende Timer zu genau dieser Satzzeile gehört. */
export function isSetTimerFor(timer: SetTimerState | undefined, setLogId: string) {
  return timer?.setLogId === setLogId;
}
