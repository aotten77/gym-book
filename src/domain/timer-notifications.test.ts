import { describe, expect, it } from 'vitest';
import type { RestTimerTrack, SetTimerState } from '@/domain/models';
import { SET_TIMER_MAX_OVERTIME_SECONDS } from '@/domain/set-timer';
import {
  decideTimerNotifications,
  isChimeFresh,
  EXPIRY_SPEECH_DELAY_MS,
  SET_TIMER_END_SPEECH,
  type TimerNotificationsInput,
} from '@/domain/timer-notifications';

const NOW = 1_700_000_000_000;

function restTrack(values: Partial<RestTimerTrack> = {}): RestTimerTrack {
  return {
    sessionExerciseId: 'session-exercise-1',
    side: 'both',
    endsAt: NOW,
    durationSeconds: 90,
    ...values,
  };
}

function setTimer(values: Partial<SetTimerState> = {}): SetTimerState {
  return { setLogId: 'set-log-1', endsAt: NOW, durationSeconds: 60, ...values };
}

function decide(input: Partial<TimerNotificationsInput> = {}) {
  return decideTimerNotifications({
    restTracks: [],
    now: NOW,
    realNow: NOW,
    soundEnabled: true,
    notifiedKeys: new Set(),
    ...input,
  });
}

describe('isChimeFresh', () => {
  it('meldet den Ablauf, der gerade passiert ist', () => {
    expect(isChimeFresh(NOW, NOW)).toBe(true);
    expect(isChimeFresh(NOW - 3_000, NOW)).toBe(true);
  });

  it('bleibt still, wenn der Ablauf lange zurückliegt', () => {
    // Der Fall nach dem Zurückwechseln aus dem Hintergrund: dort tickt keine
    // Uhr, der Ablauf fällt erst Minuten später auf.
    expect(isChimeFresh(NOW - 60_000, NOW)).toBe(false);
  });

  it('behandelt eine Uhr, die zurückgesprungen ist, als frisch', () => {
    // Zeitumstellung oder eine korrigierte Systemuhr sollen den Ton nicht
    // unterdrücken - der Timer ist trotzdem gerade abgelaufen.
    expect(isChimeFresh(NOW + 5_000, NOW)).toBe(true);
  });
});

describe('Ablauf einer Pause', () => {
  it('meldet zwei gleichzeitig abgelaufene Spuren als ein Signal', () => {
    // Zwei übereinandergelegte Zweitonfolgen sind kein doppelter Hinweis.
    const result = decide({
      restTracks: [
        restTrack({ sessionExerciseId: 'a' }),
        restTrack({ sessionExerciseId: 'b' }),
      ],
    });

    expect(result.vibrate).toEqual([180, 90, 180]);
    expect(result.chime).toBe(true);
    expect(result.notifiedKeys.size).toBe(2);
  });

  it('meldet dieselbe Spur nur einmal', () => {
    const tracks = [restTrack()];
    const first = decide({ restTracks: tracks });
    const second = decide({ restTracks: tracks, notifiedKeys: first.notifiedKeys });

    expect(second.vibrate).toBeNull();
    expect(second.chime).toBe(false);
  });

  it('meldet eine verlängerte Spur wieder', () => {
    // Der Schlüssel trägt das Ende: nach `+30 s` ist es ein anderer Ablauf,
    // und dass die frühere Meldung schon lief, darf ihn nicht verschlucken.
    const first = decide({ restTracks: [restTrack()] });
    const extended = decide({
      restTracks: [restTrack({ endsAt: NOW + 30_000 })],
      now: NOW + 30_000,
      realNow: NOW + 30_000,
      notifiedKeys: first.notifiedKeys,
    });

    expect(extended.vibrate).toEqual([180, 90, 180]);
    expect(extended.chime).toBe(true);
  });

  it('vergisst Spuren, die nicht mehr anliegen', () => {
    // Sonst wüchse die Menge über die ganze Einheit - und dieselbe Übung
    // könnte nach einem Neustart nicht wieder melden.
    const first = decide({ restTracks: [restTrack()] });
    expect(first.notifiedKeys.size).toBe(1);

    const cleared = decide({ restTracks: [], notifiedKeys: first.notifiedKeys });
    expect(cleared.notifiedKeys.size).toBe(0);
  });

  it('vibriert auch verspätet, klingelt aber nicht mehr', () => {
    /*
     * Die zwei Kanäle bewerten dieselbe Verspätung verschieden: "die Pause ist
     * vorbei" bleibt beliebig lange wahr, ein Ton nach Minuten im Hintergrund
     * ist ein Schreck. Dafür sind die zwei Uhren da - `now` findet den Ablauf,
     * `realNow` sagt, wie alt er ist.
     */
    const result = decide({
      restTracks: [restTrack({ endsAt: NOW - 600_000 })],
      realNow: NOW + 600_000,
    });

    expect(result.vibrate).toEqual([180, 90, 180]);
    expect(result.chime).toBe(false);
  });

  it('sagt beim Ablauf nie etwas', () => {
    // Sprache und AudioContext im selben Moment sind die eine Kombination, die
    // den bestehenden Ton kosten kann - und die Warnung kam schon vorher.
    expect(decide({ restTracks: [restTrack()] }).speak).toBeNull();
  });

  it('schweigt, solange die Pause läuft', () => {
    const result = decide({ restTracks: [restTrack({ endsAt: NOW + 5_000 })] });

    expect(result.vibrate).toBeNull();
    expect(result.chime).toBe(false);
    expect(result.notifiedKeys.size).toBe(0);
  });

  it('lässt den Ton weg, wenn er abgeschaltet ist - die Vibration bleibt', () => {
    const result = decide({ restTracks: [restTrack()], soundEnabled: false });

    expect(result.vibrate).toEqual([180, 90, 180]);
    expect(result.chime).toBe(false);
  });
});

describe('Ablauf des Satz-Timers', () => {
  /** Der Zeitpunkt, an dem die Überzeit ausgeschöpft ist. */
  const CAP_AT = NOW + SET_TIMER_MAX_OVERTIME_SECONDS * 1000;

  it('meldet ihn, trägt aber nichts ein', () => {
    /*
     * Der Ablauf ist das Signal, nicht das Ende: die Uhr zählt weiter, und was
     * gehalten wurde, entscheidet erst das Stoppen. Vorher stand hier immer
     * exakt die Vorgabe im Satz - und die Sekundenkurve war eine Waagerechte.
     */
    const result = decide({ setTimer: setTimer() });

    expect(result.vibrate).toEqual([180, 90, 180]);
    expect(result.chime).toBe(true);
    // Still gestartet: der Helfer setzt kein `cuesEnabled`, also bleibt es beim
    // Ton. Die Ansage hängt an der Startart, nicht am Ablauf.
    expect(result.speak).toBeNull();
    expect(result.finishSetTimerSeconds).toBeNull();
  });

  it('sagt "Ende", wenn der Lauf mit Ansagen gestartet wurde', () => {
    /*
     * Der Zweiton geht im Gym unter - laute Umgebung, Klingelschalter auf
     * stumm, und auf iOS gibt es die Vibration daneben gar nicht. Ausgerechnet
     * das Signal, auf das man reagieren muss, kam damit am seltensten an.
     */
    const result = decide({ setTimer: setTimer({ cuesEnabled: true }) });

    expect(result.speak).toBe(SET_TIMER_END_SPEECH);
    expect(result.chime).toBe(true);
    expect(result.vibrate).toEqual([180, 90, 180]);
  });

  it('lässt dem Ton den Vortritt und sagt versetzt an', () => {
    // Sprache und AudioContext im selben Moment sind die Kombination, die den
    // Ton kosten kann.
    const result = decide({ setTimer: setTimer({ cuesEnabled: true }) });

    expect(result.speakDelayMs).toBe(EXPIRY_SPEECH_DELAY_MS);
  });

  it('sagt ohne Versatz an, wenn gar kein Ton spielt', () => {
    // Der Schalter in den Einstellungen nimmt den Ton, nicht die Sprache - und
    // ohne Ton gibt es nichts zu umgehen.
    const result = decide({ setTimer: setTimer({ cuesEnabled: true }), soundEnabled: false });

    expect(result.speak).toBe(SET_TIMER_END_SPEECH);
    expect(result.chime).toBe(false);
    expect(result.speakDelayMs).toBe(0);
  });

  it('sagt nichts, wenn die App den Ablauf erst aus dem Hintergrund entdeckt', () => {
    // Dieselbe Frische wie der Ton: ein "Ende" für einen Timer von vor zwanzig
    // Minuten ist ein Schreck, kein Hinweis.
    const result = decide({
      setTimer: setTimer({ cuesEnabled: true }),
      realNow: NOW + 600_000,
    });

    expect(result.speak).toBeNull();
    expect(result.chime).toBe(false);
    // Die Vibration meldet auch nachträglich - "der Timer ist um" bleibt wahr.
    expect(result.vibrate).toEqual([180, 90, 180]);
  });

  it('sagt "Ende" nur einmal', () => {
    const timer = setTimer({ cuesEnabled: true });
    const first = decide({ setTimer: timer });
    const second = decide({
      setTimer: timer,
      now: NOW + 12_000,
      realNow: NOW + 12_000,
      notifiedKeys: first.notifiedKeys,
    });

    expect(first.speak).toBe(SET_TIMER_END_SPEECH);
    expect(second.speak).toBeNull();
  });

  it('lässt eine abgelaufene Pause kein "Ende" auslösen', () => {
    /*
     * In `expiries` liegen beide nebeneinander. Angesagt wird nur der
     * Satz-Timer: eine Pause hat kein Ende, sie ist der Moment, in dem es
     * weitergeht.
     */
    const result = decide({
      restTracks: [restTrack()],
      // 50 Sekunden Rest bei 60 Sekunden Dauer: weder abgelaufen noch auf
      // einer der beiden Marken.
      setTimer: setTimer({ cuesEnabled: true, endsAt: NOW + 50_000 }),
    });

    expect(result.chime).toBe(true);
    expect(result.speak).toBeNull();
  });

  it('meldet auch in der Überzeit nicht ein zweites Mal', () => {
    const timer = setTimer();
    const first = decide({ setTimer: timer });
    const second = decide({
      setTimer: timer,
      now: NOW + 12_000,
      realNow: NOW + 12_000,
      notifiedKeys: first.notifiedKeys,
    });

    expect(second.vibrate).toBeNull();
    expect(second.chime).toBe(false);
    expect(second.finishSetTimerSeconds).toBeNull();
  });

  it('fasst ihn mit einer gleichzeitig abgelaufenen Pause zu einem Signal zusammen', () => {
    const result = decide({ restTracks: [restTrack()], setTimer: setTimer() });

    expect(result.vibrate).toEqual([180, 90, 180]);
    expect(result.chime).toBe(true);
  });

  it('schließt am Deckel mit Vorgabe plus Überzeit ab', () => {
    const result = decide({ setTimer: setTimer(), now: CAP_AT, realNow: CAP_AT });

    expect(result.finishSetTimerSeconds).toBe(60 + SET_TIMER_MAX_OVERTIME_SECONDS);
    // Gemeldet wurde beim Ablauf; der Deckel ist der Notausgang, kein Signal.
    expect(result.chime).toBe(false);
  });

  it('schließt am Deckel nur einmal ab', () => {
    // Zwischen dem Abschließen und dem nächsten Emit der Live-Query tickt die
    // Sekunde weiter - ohne Merker liefe die Aktion zweimal.
    const timer = setTimer();
    const first = decide({ setTimer: timer, now: CAP_AT, realNow: CAP_AT });
    const second = decide({
      setTimer: timer,
      now: CAP_AT + 1_000,
      realNow: CAP_AT + 1_000,
      notifiedKeys: first.notifiedKeys,
    });

    expect(first.finishSetTimerSeconds).toBe(60 + SET_TIMER_MAX_OVERTIME_SECONDS);
    expect(second.finishSetTimerSeconds).toBeNull();
  });

  it('trägt nichts ein, wenn die App den Deckel im Hintergrund erreicht hat', () => {
    /*
     * Zwei Minuten über der Vorgabe hat dann niemand gehalten - das Handy lag
     * in der Tasche. Die Uhr bleibt bei "+02:00" stehen und wartet auf Stoppen
     * oder Verwerfen: lieber keine Zahl als eine erfundene.
     */
    const result = decide({
      setTimer: setTimer(),
      now: CAP_AT,
      realNow: CAP_AT + 600_000,
    });

    expect(result.finishSetTimerSeconds).toBeNull();
  });

  it('wird von einer gleich endenden Pause nicht abgeschlossen', () => {
    // Die Zuordnung läuft über den eigenen Schlüssel, nicht über den Zeitpunkt.
    const result = decide({
      restTracks: [restTrack({ endsAt: NOW })],
      setTimer: setTimer(),
    });

    expect(result.finishSetTimerSeconds).toBeNull();
    expect(result.vibrate).toEqual([180, 90, 180]);
  });

  it('rührt einen Timer ohne Dauer nicht an', () => {
    const result = decide({
      setTimer: setTimer({ durationSeconds: 0 }),
      now: CAP_AT,
      realNow: CAP_AT,
    });

    expect(result.finishSetTimerSeconds).toBeNull();
    expect(result.vibrate).toBeNull();
  });
});

describe('Zwischenansagen', () => {
  /** Ein 60-Sekunden-Lauf mit Ansagen, `now` an der gewünschten Marke. */
  function atRemaining(remainingSeconds: number, values: Partial<SetTimerState> = {}) {
    const timer = setTimer({ cuesEnabled: true, durationSeconds: 60, ...values });

    return { setTimer: timer, now: timer.endsAt - remainingSeconds * 1000 };
  }

  it('sagt die Halbzeit an und vibriert dazu kurz', () => {
    const result = decide(atRemaining(30));

    expect(result.speak).toBe('Halbzeit');
    expect(result.vibrate).toEqual([120]);
    expect(result.chime).toBe(false);
  });

  it('sagt die Zehn-Sekunden-Marke mit ausgeschriebener Zahl an', () => {
    // Ausgeschrieben, damit keine Stimme "ten" daraus macht.
    expect(decide(atRemaining(10)).speak).toBe('Noch zehn Sekunden');
  });

  it('bringt Halbzeit und Zehn-Sekunden-Marke nie ins selbe Fenster', () => {
    /*
     * Bei 30 Sekunden Gesamtdauer läge die Halbzeit fünf Sekunden vor dem
     * Schluss - zwei Meldungen dicht hintereinander sind kein Hinweis mehr.
     * Unterhalb der Schwelle fällt die Halbzeit deshalb ganz weg.
     */
    expect(decide(atRemaining(15, { durationSeconds: 30 })).speak).toBeNull();
    expect(decide(atRemaining(10, { durationSeconds: 30 })).speak).toBe('Noch zehn Sekunden');

    // Und bei 45 Sekunden, der kleinsten Dauer mit Halbzeit, liegen die beiden
    // Marken 12,5 Sekunden auseinander.
    expect(decide(atRemaining(22.5, { durationSeconds: 45 })).speak).toBe('Halbzeit');
  });

  it('lässt eine veraltete Ansage ganz aus - auch die Vibration', () => {
    /*
     * Anders als beim Ablauf: "noch zehn Sekunden" ist eine Position im
     * Countdown und verfällt. Wer am Boden liegt und sich danach einteilt,
     * ließe sonst zum falschen Zeitpunkt los.
     */
    const timer = setTimer({ cuesEnabled: true, durationSeconds: 60 });
    const result = decide({ setTimer: timer, now: timer.endsAt - 30_000 + 5_000 });

    expect(result.speak).toBeNull();
    expect(result.vibrate).toBeNull();
  });

  it('schweigt, wenn der Lauf still gestartet wurde', () => {
    // Die Wahl fällt am Startknopf, nicht in den Einstellungen.
    const timer = setTimer({ cuesEnabled: false, durationSeconds: 60 });

    expect(decide({ setTimer: timer, now: timer.endsAt - 30_000 }).speak).toBeNull();
  });

  it('sagt dieselbe Marke nur einmal', () => {
    const input = atRemaining(30);
    const first = decide(input);
    const second = decide({ ...input, notifiedKeys: first.notifiedKeys });

    expect(second.speak).toBeNull();
    expect(second.vibrate).toBeNull();
  });

  it('lässt dem Ablauf den Vortritt bei der Vibration, sagt aber trotzdem an', () => {
    // Zwei Muster gleichzeitig wären eines zu viel; die Ansage betrifft eine
    // andere Übung als die Pause, die gerade um ist.
    const timer = setTimer({ cuesEnabled: true, durationSeconds: 60 });
    const now = timer.endsAt - 30_000;
    const result = decide({
      restTracks: [restTrack({ endsAt: now })],
      setTimer: timer,
      now,
      realNow: now,
    });

    expect(result.vibrate).toEqual([180, 90, 180]);
    expect(result.chime).toBe(true);
    expect(result.speak).toBe('Halbzeit');
  });
});
