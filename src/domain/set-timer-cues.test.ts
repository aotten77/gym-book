import { describe, expect, it } from 'vitest';
import type { SetTimerState } from '@/domain/models';
import {
  SET_TIMER_FINAL_CUE_SECONDS,
  findDueSetTimerCue,
  setTimerCueKey,
  setTimerCueSpeech,
  setTimerCueVibrationPattern,
} from '@/domain/set-timer-cues';

const ENDS_AT = 1_000_000;

function createTimer(overrides: Partial<SetTimerState> = {}): SetTimerState {
  return {
    setLogId: 'log-1',
    endsAt: ENDS_AT,
    durationSeconds: 60,
    ...overrides,
  };
}

/** Zeitpunkt, an dem noch `seconds` Sekunden übrig sind. */
function remaining(seconds: number) {
  return ENDS_AT - seconds * 1000;
}

describe('findDueSetTimerCue', () => {
  it('reports nothing without a timer', () => {
    expect(findDueSetTimerCue(undefined, ENDS_AT)).toBeNull();
  });

  it('stays quiet before half time', () => {
    expect(findDueSetTimerCue(createTimer(), remaining(31))).toBeNull();
  });

  it('announces half time exactly on the mark', () => {
    expect(findDueSetTimerCue(createTimer(), remaining(30))).toBe('half');
  });

  it('still announces half time after one missed tick', () => {
    // Der Sekundentakt kann knapp vor dem Zeitpunkt abtasten - eine verpasste
    // Probe darf die Ansage nicht kosten.
    expect(findDueSetTimerCue(createTimer(), remaining(30) + 1500)).toBe('half');
  });

  it('drops a half-time announcement that is already stale', () => {
    // Fünf Sekunden alt: die App lag im Hintergrund, und "Halbzeit" ist dann
    // keine Ortsangabe mehr, sondern falsch.
    expect(findDueSetTimerCue(createTimer(), remaining(30) + 5000)).toBeNull();
  });

  it('stays quiet between the two marks', () => {
    expect(findDueSetTimerCue(createTimer(), remaining(20))).toBeNull();
  });

  it('announces the last ten seconds', () => {
    expect(findDueSetTimerCue(createTimer(), remaining(10))).toBe('final');
  });

  it('reports nothing at or after the end of the timer', () => {
    expect(findDueSetTimerCue(createTimer(), ENDS_AT)).toBeNull();
    expect(findDueSetTimerCue(createTimer(), ENDS_AT + 3000)).toBeNull();
  });

  it('keeps half time out of short timers', () => {
    const timer = createTimer({ durationSeconds: 44 });

    expect(findDueSetTimerCue(timer, remaining(22))).toBeNull();
    expect(findDueSetTimerCue(timer, remaining(10))).toBe('final');
  });

  it('treats the half-time minimum as inclusive', () => {
    expect(findDueSetTimerCue(createTimer({ durationSeconds: 45 }), remaining(22.5))).toBe('half');
  });

  it('treats the minimum for the last ten seconds as inclusive', () => {
    expect(findDueSetTimerCue(createTimer({ durationSeconds: 24 }), remaining(10))).toBeNull();
    expect(findDueSetTimerCue(createTimer({ durationSeconds: 25 }), remaining(10))).toBe('final');
  });

  it('takes the later mark when both were crossed at once', () => {
    // 45s: die Halbzeit lag 13,5s zurück und ist abgestanden, die zweite Marke
    // ist eine Sekunde alt - angesagt wird nur sie.
    expect(findDueSetTimerCue(createTimer({ durationSeconds: 45 }), remaining(9))).toBe('final');
  });
});

describe('findDueSetTimerCue over a whole run', () => {
  /*
   * Der eigentliche Schutz der Funktion: kein Takt darf eine Ansage
   * unbeobachtbar machen. Die drei Schrittweiten stehen für den Sekundentakt
   * der Seite, für einen gedrosselten und für einen leicht zu schnellen - die
   * Phase zwischen dem Start des Timers und dem Intervall ist zufällig.
   */
  const stepsMs = [1000, 1250, 950];

  function collectCues(durationSeconds: number, stepMs: number) {
    const timer = createTimer({ durationSeconds });
    const seen: string[] = [];
    const cues: string[] = [];

    for (let now = timer.endsAt - durationSeconds * 1000; now < timer.endsAt; now += stepMs) {
      const cue = findDueSetTimerCue(timer, now);

      if (!cue) {
        continue;
      }

      const key = setTimerCueKey(timer, cue);

      if (!seen.includes(key)) {
        seen.push(key);
        cues.push(cue);
      }
    }

    return cues;
  }

  it.each(stepsMs)('announces both marks on long timers with a %ims tick', (stepMs) => {
    for (const durationSeconds of [45, 46, 60, 90, 120, 3600]) {
      expect(collectCues(durationSeconds, stepMs)).toEqual(['half', 'final']);
    }
  });

  it.each(stepsMs)('announces only the last ten seconds in between with a %ims tick', (stepMs) => {
    for (const durationSeconds of [25, 30, 44]) {
      expect(collectCues(durationSeconds, stepMs)).toEqual(['final']);
    }
  });

  it.each(stepsMs)('stays silent on short timers with a %ims tick', (stepMs) => {
    for (const durationSeconds of [5, 20, 24]) {
      expect(collectCues(durationSeconds, stepMs)).toEqual([]);
    }
  });

  it('never lets the two marks land in the same neighbourhood', () => {
    for (const durationSeconds of [45, 46, 60, 90, 120, 3600]) {
      const timer = createTimer({ durationSeconds });
      const halfAt = timer.endsAt - durationSeconds * 500;

      expect((timer.endsAt - halfAt) / 1000).toBeGreaterThan(SET_TIMER_FINAL_CUE_SECONDS);
    }
  });
});

describe('setTimerCueKey', () => {
  it('separates the two marks of the same timer', () => {
    const timer = createTimer();

    expect(setTimerCueKey(timer, 'half')).not.toBe(setTimerCueKey(timer, 'final'));
  });

  it('changes when the same set is timed again', () => {
    // Verwerfen und neu starten schreibt ein neues Ende - und der zweite
    // Anlauf soll wieder angesagt werden.
    expect(setTimerCueKey(createTimer(), 'half')).not.toBe(
      setTimerCueKey(createTimer({ endsAt: ENDS_AT + 60_000 }), 'half'),
    );
  });
});

describe('setTimerCueSpeech', () => {
  it('spells the number out', () => {
    expect(setTimerCueSpeech('half')).toBe('Halbzeit');
    expect(setTimerCueSpeech('final')).toBe('Noch zehn Sekunden');
  });
});

describe('setTimerCueVibrationPattern', () => {
  it('keeps all three signals of the app distinguishable', () => {
    const half = setTimerCueVibrationPattern('half');
    const final = setTimerCueVibrationPattern('final');
    // Das Muster des Ablaufs, wie es SessionPage vibriert.
    const expiry = [180, 90, 180];

    expect(half).not.toEqual(final);
    expect(half).not.toEqual(expiry);
    expect(final).not.toEqual(expiry);
  });
});
