/**
 * Zwischenansagen für Sätze auf Zeit.
 *
 * Beim Dead Bug oder Plank liegt das Telefon neben der Matte und wird nicht
 * angesehen: die Restzeit steht nur auf dem Bildschirm. Zwei Marken sagen sie
 * an, ohne dass man hinsehen muss - Halbzeit und die letzten zehn Sekunden.
 *
 * Rein wie [set-timer.ts]: `now` kommt als Parameter herein, hier tickt keine
 * Uhr und hier spricht auch nichts.
 */

import type { SetTimerState } from '@/domain/models';

/** Die beiden Marken, in der Reihenfolge, in der sie fällig werden. */
export type SetTimerCue = 'half' | 'final';

/**
 * Ab dieser Gesamtdauer lohnt sich die Halbzeit-Ansage.
 *
 * Darunter läge sie zu dicht an der Schluss-Ansage: bei 30 Sekunden wären das
 * zwei Meldungen im Abstand von fünf Sekunden, und das ist kein Hinweis mehr,
 * sondern Lärm.
 */
export const SET_TIMER_HALF_CUE_MIN_SECONDS = 45;

/** Ab dieser Gesamtdauer lohnt sich die Ansage kurz vor Schluss. */
export const SET_TIMER_FINAL_CUE_MIN_SECONDS = 25;

/** Restzeit, bei der die Schluss-Ansage kommt. */
export const SET_TIMER_FINAL_CUE_SECONDS = 10;

/**
 * Ab dieser Verspätung bleibt die Ansage aus.
 *
 * Der Wert muss eine ganze Taktperiode überdecken: der Sekundentakt der Seite
 * kann eine Millisekunde vor dem fälligen Zeitpunkt abtasten, die nächste Probe
 * kommt gut 1000 ms später. Bei 1000 ms verschluckte die Frische je nach Phase
 * zufällig Ansagen.
 */
const SET_TIMER_CUE_MAX_DELAY_MS = 2000;

/** Wann die Marke fällig ist - als Zeitpunkt, nicht als Restsekunde. */
function cueDueAt(timer: SetTimerState, cue: SetTimerCue) {
  if (cue === 'half') {
    return timer.endsAt - Math.round(timer.durationSeconds * 500);
  }

  return timer.endsAt - SET_TIMER_FINAL_CUE_SECONDS * 1000;
}

/** Ob die Gesamtdauer lang genug für diese Marke ist. */
function isCueWorthwhile(timer: SetTimerState, cue: SetTimerCue) {
  if (cue === 'half') {
    if (timer.durationSeconds < SET_TIMER_HALF_CUE_MIN_SECONDS) {
      return false;
    }

    /*
     * Zweite Schranke, absichtlich neben der ersten: bei 45 Sekunden liegt die
     * Halbzeit auf 22,5 Sekunden Rest und diese Bedingung ist unerreichbar.
     * Sie steht trotzdem im Code, damit die beiden Schwellen einzeln verstellt
     * werden können, ohne dass wieder zwei Ansagen aufeinanderfallen.
     */
    return timer.endsAt - cueDueAt(timer, 'half') > SET_TIMER_FINAL_CUE_SECONDS * 1000;
  }

  return timer.durationSeconds >= SET_TIMER_FINAL_CUE_MIN_SECONDS;
}

/**
 * Welche Zwischenansage gerade fällig ist - oder keine.
 *
 * Verglichen werden Zeitpunkte, nicht die Restsekunden aus
 * [remainingSetTimerSeconds]. Der Helfer rundet auf, die Halbzeit von 45
 * Sekunden säße auf 22,5 Sekunden Rest und wäre als `=== 23` nur in einem
 * halbsekündigen Splitter beobachtbar - reines Taktphasen-Glücksspiel. Und ein
 * `=== 10` verlöre die Ansage endgültig, sobald ein gedrosselter Takt von 11
 * auf 9 springt. Als Überschreitung formuliert (`dueAt <= now`, wie
 * [isRestTrackReady]) fängt sie jeder spätere Takt; die Entdopplung macht der
 * Aufrufer über [setTimerCueKey], nicht die Rechnung hier.
 */
export function findDueSetTimerCue(
  timer: SetTimerState | undefined,
  now: number,
): SetTimerCue | null {
  if (!timer) {
    return null;
  }

  // Der Ablaufmoment gehört dem Ablaufsignal: eine "Halbzeit" über dem
  // Schlusston wäre Lärm auf Lärm.
  if (now >= timer.endsAt) {
    return null;
  }

  const candidates: SetTimerCue[] = ['half', 'final'];
  let due: SetTimerCue | null = null;

  for (const cue of candidates) {
    if (!isCueWorthwhile(timer, cue)) {
      continue;
    }

    const dueAt = cueDueAt(timer, cue);

    if (dueAt > now) {
      continue;
    }

    // Sind beide überschritten - etwa nach einem eingefrorenen Takt -, zählt
    // die spätere: die frühere ist ohnehin nichts mehr wert.
    if (!due || dueAt > cueDueAt(timer, due)) {
      due = cue;
    }
  }

  if (!due) {
    return null;
  }

  /*
   * Die Frische gilt hier für beide Kanäle, anders als beim Ablauf, wo die
   * Vibration bewusst auch verspätet meldet. Der Unterschied liegt in der
   * Aussage: "der Timer ist um" bleibt beliebig lange wahr, "noch zehn
   * Sekunden" verfällt in Sekunden und wäre eine halbe Minute später schlicht
   * falsch - und wer am Boden liegt und sich danach einteilt, ließe zum
   * falschen Zeitpunkt los. Deshalb steckt die Prüfung hier drin und nicht
   * daneben: ein Prädikat, eine Entscheidung.
   */
  return now - cueDueAt(timer, due) <= SET_TIMER_CUE_MAX_DELAY_MS ? due : null;
}

/**
 * Kennung einer bereits gemeldeten Ansage.
 *
 * Das Ende trägt die Kennung: ein Timer wird nie verlängert, aber verworfen und
 * neu gestartet - und derselbe Satz soll dann wieder angesagt werden.
 */
export function setTimerCueKey(timer: SetTimerState, cue: SetTimerCue) {
  return `${timer.setLogId}@${timer.endsAt}:${cue}`;
}

/**
 * Was gesagt wird.
 *
 * Die Zahl ist ausgeschrieben, damit keine Stimme und kein Sprachrückfall "ten"
 * daraus macht.
 */
export function setTimerCueSpeech(cue: SetTimerCue) {
  return cue === 'half' ? 'Halbzeit' : 'Noch zehn Sekunden';
}

/**
 * Vibrationsmuster der Ansage.
 *
 * Die drei Signale der App müssen sich ohne Hinsehen unterscheiden, und die
 * Schnittstelle kennt nur Anzahl und Länge der Stöße - keine Stärke. Also nach
 * Dringlichkeit gestaffelt: ein kurzer Stoß zur Halbzeit (eine Information,
 * kein Handlungsaufruf, und die einzige Form ganz ohne Rhythmus), drei Ticks,
 * die sich wie ein Countdown anfühlen, und zuletzt die zwei langen des Ablaufs.
 */
export function setTimerCueVibrationPattern(cue: SetTimerCue) {
  return cue === 'half' ? [120] : [70, 70, 70, 70, 70];
}
