/**
 * Was beim Ablauf und kurz davor gemeldet wird - und was nicht.
 *
 * Drei Effekte in `SessionPage` haben das bisher unter sich ausgemacht: der
 * Ablauf einer Pause, der Ablauf des Satz-Timers und die Zwischenansage. Zwei
 * davon trugen denselben Vibrations-und-Ton-Block wortgleich, und einer holte
 * sich den Ablaufzeitpunkt zurück, indem er ihn aus einem Schlüsselstring
 * zurückparste.
 *
 * Hier entscheidet eine Funktion, und die Seite führt aus. Rein wie
 * [set-timer-cues.ts]: keine Uhr, kein `navigator`, kein `AudioContext`.
 */

import type { RestTimerTrack, SetTimerState } from '@/domain/models';
import { isRestTrackReady, restTrackKey } from '@/domain/rest-timer';
import {
  findDueSetTimerCue,
  setTimerCueKey,
  setTimerCueSpeech,
  setTimerCueVibrationPattern,
} from '@/domain/set-timer-cues';
import { SET_TIMER_MAX_OVERTIME_SECONDS } from '@/domain/set-timer';

/**
 * Ab dieser Verspätung bleibt der Ton aus.
 *
 * Im Hintergrund tickt keine Uhr: liegt die App eine Viertelstunde im
 * App-Switcher, fällt der Ablauf erst beim Zurückwechseln auf. Ein Ton wäre
 * dort kein Hinweis mehr, sondern ein Schreck.
 */
export const CHIME_MAX_DELAY_MS = 4000;

/**
 * Was beim Ablauf des Satz-Timers gesagt wird.
 *
 * Der Zweiton allein reicht nicht: im Gym liegt das Telefon neben der Matte, die
 * Umgebung ist laut, und auf iOS trägt der Ton allein, weil Safari die Vibration
 * gar nicht kennt. Genau das Signal, auf das man reagieren muss, ging damit am
 * häufigsten unter.
 */
export const SET_TIMER_END_SPEECH = 'Ende';

/**
 * Abstand zwischen Zweiton und Ansage.
 *
 * Der Chime läuft rund 0,49 Sekunden (siehe `CHIME_TONES` in [sound.ts]). Eine
 * gesprochene Ansage und ein Ton im selben Moment sind die Kombination, die den
 * Ton kosten kann - also erst klingelt es, dann wird bestätigt. Die Reihenfolge
 * ist auch inhaltlich die richtige: der Zweiton markiert die Grenze scharf, die
 * Ansage sagt hinterher, welche Grenze das war.
 */
export const EXPIRY_SPEECH_DELAY_MS = 700;

/**
 * Ob ein abgelaufener Timer noch einen Ton wert ist.
 *
 * Die Vibration ist davon ausdrücklich nicht betroffen - sie meldet auch
 * nachträglich nur, dass die Pause vorbei ist, und das bleibt beliebig lange
 * wahr. Genau darin unterscheidet sich der Ablauf von einer Zwischenansage:
 * "noch zehn Sekunden" verfällt, "der Timer ist um" nicht.
 */
export function isChimeFresh(expiredAt: number, now: number) {
  return now - expiredAt <= CHIME_MAX_DELAY_MS;
}

/** Zwei lange Stöße - siehe [setTimerCueVibrationPattern] für die Staffelung. */
const EXPIRY_VIBRATION_PATTERN = [180, 90, 180];

export interface TimerNotificationsInput {
  restTracks: RestTimerTrack[];
  setTimer?: SetTimerState;
  /**
   * Der getickte Sekundentakt der Seite - er entscheidet, *ob* etwas fällig
   * ist.
   */
  now: number;
  /**
   * Eine frisch gelesene Uhr - sie entscheidet, ob es noch *aktuell* ist.
   *
   * Zwei Uhren und nicht eine, mit Absicht: nach Minuten im Hintergrund ist
   * `now` beim ersten Takt nach der Rückkehr zwar wieder korrekt, aber der
   * Ablauf, den er dabei entdeckt, kann beliebig alt sein. Hätte die Frische
   * nur `now`, meldete sie ihn als eben passiert.
   */
  realNow: number;
  soundEnabled: boolean;
  /** Was diese Seite schon gemeldet hat; das Ergebnis liefert die Fortschreibung. */
  notifiedKeys: ReadonlySet<string>;
}

export interface TimerNotifications {
  /** Muster für `navigator.vibrate`, oder nichts. */
  vibrate: number[] | null;
  chime: boolean;
  /** Der Ansagetext, oder nichts. */
  speak: string | null;
  /**
   * Wie lange die Ansage warten soll, bevor sie gesprochen wird.
   *
   * Nur der Ablauf des Satz-Timers setzt hier etwas: er klingelt *und* sagt an,
   * und beides im selben Moment ist die Kombination, die den Ton kosten kann.
   * Eine Zwischenansage kommt allein und wartet deshalb nicht.
   */
  speakDelayMs: number;
  /**
   * Gesetzt, wenn der Satz-Timer seine Überzeit ausgeschöpft hat: Vorgabe plus
   * Deckel gehören in den Satz.
   *
   * Ausdrücklich *nicht* beim Ablauf. Dort wird gemeldet, nicht geschrieben -
   * die Uhr zählt über die Vorgabe hinaus, und wer noch hält, soll das
   * mitgezählt bekommen. Erst am Deckel schließt der Timer von selbst ab; das
   * ist der Notausgang für einen vergessenen Timer, nicht der Normalfall.
   */
  finishSetTimerSeconds: number | null;
  /** Ersetzt die bisherige Menge - der Aufrufer schreibt sie zurück. */
  notifiedKeys: Set<string>;
}

/** Der Schlüssel trägt das Ende: ein neuer Ablauf ist eine neue Meldung. */
function expiredRestKey(track: RestTimerTrack) {
  return `${restTrackKey(track.sessionExerciseId, track.side)}@${track.endsAt}`;
}

function expiredSetTimerKey(timer: SetTimerState) {
  return `set-timer:${timer.setLogId}@${timer.endsAt}`;
}

/**
 * Eigener Schlüssel für den Abschluss am Deckel.
 *
 * Der Abschluss ist keine Meldung, braucht aber dieselbe Entdopplung: bis der
 * Schreibvorgang durch ist und den Timer löscht, laufen weitere Takte durch
 * diese Funktion.
 */
function overtimeSetTimerKey(timer: SetTimerState) {
  return `set-timer-overtime:${timer.setLogId}@${timer.endsAt}`;
}

/** Wann die Überzeit ausgeschöpft ist. */
function setTimerOvertimeCapAt(timer: SetTimerState) {
  return timer.endsAt + SET_TIMER_MAX_OVERTIME_SECONDS * 1000;
}

/**
 * Entscheidet, was in diesem Takt zu melden ist.
 *
 * Alles, was gerade gilt - abgelaufene Pausen, ein durchgelaufener Satz-Timer,
 * eine fällige Zwischenansage - bekommt einen Schlüssel. Was schon gemeldet
 * wurde, fällt heraus; was nicht mehr gilt, wird vergessen, damit dieselbe
 * Spur nach einem Neustart wieder melden darf und die Menge nicht wächst.
 *
 * Signale werden bewusst zusammengefasst statt gestapelt: laufen zwei Pausen
 * im selben Takt ab - oder eine Pause und der Satz-Timer -, ist das ein
 * Vibrieren und ein Ton. Zwei übereinandergelegte Zweitonfolgen sind kein
 * doppelter Hinweis, sondern Matsch.
 */
export function decideTimerNotifications({
  restTracks,
  setTimer,
  now,
  realNow,
  soundEnabled,
  notifiedKeys,
}: TimerNotificationsInput): TimerNotifications {
  const expiries: Array<{ key: string; endsAt: number }> = [];

  for (const track of restTracks) {
    if (isRestTrackReady(track, now)) {
      expiries.push({ key: expiredRestKey(track), endsAt: track.endsAt });
    }
  }

  // Ohne Dauer gibt es nichts in den Satz zu schreiben - dann ist der Timer
  // auch nicht abgelaufen, sondern kaputt.
  const setTimerExpired = Boolean(setTimer && setTimer.durationSeconds && now >= setTimer.endsAt);

  if (setTimer && setTimerExpired) {
    expiries.push({ key: expiredSetTimerKey(setTimer), endsAt: setTimer.endsAt });
  }

  /*
   * Ob angesagt wird, hat der Nutzer beim Starten entschieden - über den Knopf
   * mit dem Megafon, nicht in den Einstellungen. Die Frische von zwei Sekunden
   * steckt in [findDueSetTimerCue] und gilt dort für beide Kanäle: eine
   * verspätete Ansage bleibt auch als Vibration aus.
   */
  const cue = setTimer?.cuesEnabled ? findDueSetTimerCue(setTimer, now) : null;
  const cueKey = setTimer && cue ? setTimerCueKey(setTimer, cue) : null;

  /*
   * Der Abschluss hängt am Deckel, nicht am Ablauf: bis dahin zählt die Uhr
   * über die Vorgabe hinaus, und was gehalten wurde, entscheidet erst das
   * Stoppen.
   */
  const overtimeCapReached = Boolean(
    setTimer && setTimer.durationSeconds && now >= setTimerOvertimeCapAt(setTimer),
  );
  const overtimeKey = setTimer && overtimeCapReached ? overtimeSetTimerKey(setTimer) : null;

  const liveKeys = new Set(expiries.map((entry) => entry.key));

  if (cueKey) {
    liveKeys.add(cueKey);
  }

  if (overtimeKey) {
    liveKeys.add(overtimeKey);
  }

  const nextNotifiedKeys = new Set([...notifiedKeys].filter((key) => liveKeys.has(key)));

  const freshExpiries = expiries.filter((entry) => !nextNotifiedKeys.has(entry.key));
  const freshCue = cueKey && !nextNotifiedKeys.has(cueKey) ? cue : null;
  const freshOvertimeCap = Boolean(overtimeKey && !nextNotifiedKeys.has(overtimeKey));

  for (const key of liveKeys) {
    nextNotifiedKeys.add(key);
  }

  const hasFreshExpiry = freshExpiries.length > 0;

  /*
   * Der Ablauf des Satz-Timers wird aus dem Topf wieder herausgefischt: in
   * `expiries` liegt er neben den Pausen und ist dort nicht mehr zu
   * unterscheiden, angesagt wird aber nur er. Eine Pause hat kein "Ende" - sie
   * ist der Moment, in dem es weitergeht, und dafür steht der Zweiton.
   *
   * Angesagt wird nur, was der Nutzer beim Starten gewählt hat (`cuesEnabled`,
   * der Knopf mit dem Megafon) - schon deshalb, weil [primeTimerSpeech] nur auf
   * diesem Weg gelaufen ist. Und nur, solange es frisch ist, nach derselben
   * Regel wie der Ton: lag die App im Hintergrund, ist ein "Ende" für einen
   * Timer von vor zwanzig Minuten derselbe Schreck, gegen den
   * [CHIME_MAX_DELAY_MS] existiert.
   */
  const setTimerExpiryKey = setTimer && setTimerExpired ? expiredSetTimerKey(setTimer) : null;
  const speaksEnd = Boolean(
    setTimer?.cuesEnabled &&
      setTimerExpiryKey &&
      freshExpiries.some((entry) => entry.key === setTimerExpiryKey) &&
      isChimeFresh(setTimer.endsAt, realNow),
  );

  // Nur der Ablauf klingelt.
  const chime = soundEnabled && freshExpiries.some((entry) => isChimeFresh(entry.endsAt, realNow));

  return {
    /*
     * Der Ablauf hat Vorrang vor der Ansage: er ist das dringendere Signal,
     * und beide Muster gleichzeitig wären eines zu viel. Gesagt wird die
     * Ansage trotzdem - sie betrifft eine andere Übung als die Pause, die
     * gerade um ist.
     */
    vibrate: hasFreshExpiry
      ? EXPIRY_VIBRATION_PATTERN
      : freshCue
        ? setTimerCueVibrationPattern(freshCue)
        : null,
    chime,
    /*
     * Der Ablauf hat auch hier Vorrang. Beides gleichzeitig kann ohnehin nicht
     * anliegen - [findDueSetTimerCue] schweigt ab `endsAt` -, aber die
     * Rangfolge steht trotzdem da, damit sie beim Verstellen der Schwellen
     * nicht dem Zufall überlassen bleibt.
     *
     * Die Ansage hängt bewusst *nicht* an `soundEnabled`, genau wie die beiden
     * Zwischenansagen: der Schalter in den Einstellungen schaltet den Ton aus,
     * nicht die Sprache. Der Versatz hängt dagegen sehr wohl daran - spielt
     * kein Ton, gibt es auch nichts zu umgehen.
     */
    speak: speaksEnd ? SET_TIMER_END_SPEECH : freshCue ? setTimerCueSpeech(freshCue) : null,
    speakDelayMs: speaksEnd && chime ? EXPIRY_SPEECH_DELAY_MS : 0,
    /*
     * Am Deckel und nur einmal - und nur, wenn die App dabei wach war. Lag sie
     * im Hintergrund, hat niemand zwei Minuten über der Vorgabe gehalten; die
     * Uhr bleibt dann bei "+02:00" stehen und wartet auf Stoppen oder
     * Verwerfen. Genau das tut ein abgelaufener Timer heute schon bei "00:00",
     * wenn die Frische fehlt: lieber keine Zahl als eine erfundene.
     */
    finishSetTimerSeconds:
      setTimer && freshOvertimeCap && isChimeFresh(setTimerOvertimeCapAt(setTimer), realNow)
        ? setTimer.durationSeconds + SET_TIMER_MAX_OVERTIME_SECONDS
        : null,
    notifiedKeys: nextNotifiedKeys,
  };
}
