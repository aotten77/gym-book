import { describe, expect, it } from 'vitest';
import {
  GUIDED_SIGNAL_MAX_DELAY_MS,
  addGuidedEvent,
  deriveGuidedRunState,
  guidedRunEndsAt,
  isGuidedSession,
} from '@/domain/guided-run';
import type { GuidedEvent, GuidedStep } from '@/domain/models';

const T0 = 1_000_000;
const START: GuidedEvent[] = [{ type: 'start', at: T0 }];

// Abschnitte: Wechsel 5, Hund 10, Wechsel 5, Taube L 20, Seitenwechsel 3, Taube R 20.
// Summe 63 s.
const STEPS: GuidedStep[] = [
  { name: 'Hund', seconds: 10 },
  { name: 'Taube', seconds: 20, bothSides: true },
];

const at = (seconds: number) => T0 + seconds * 1000;

describe('deriveGuidedRunState', () => {
  it('steht ohne Start-Ereignis im ersten Wechsel, ohne Zeit zu rechnen', () => {
    const state = deriveGuidedRunState(STEPS, [], at(100));

    expect(state.phase).toBe('transition');
    expect(state.sectionIndex).toBe(0);
    expect(state.elapsedSeconds).toBe(0);
    expect(state.dueSignal).toBeNull();
  });

  it('beginnt mit dem 5-s-Wechsel in den ersten Schritt', () => {
    const state = deriveGuidedRunState(STEPS, START, at(1.2));

    expect(state.phase).toBe('transition');
    expect(state.current).toMatchObject({ kind: 'transition', stepIndex: 0 });
    expect(state.remainingSeconds).toBe(4);
    expect(state.stepIndex).toBe(0);
    expect(state.nextExercise).toMatchObject({ kind: 'exercise', stepIndex: 0 });
    expect(state.totalSeconds).toBe(63);
  });

  it('läuft nach dem Wechsel in die Übung und nennt die nächste', () => {
    const state = deriveGuidedRunState(STEPS, START, at(5));

    expect(state.phase).toBe('exercise');
    expect(state.sectionIndex).toBe(1);
    expect(state.remainingSeconds).toBe(10);
    expect(state.nextExercise).toMatchObject({ stepIndex: 1, side: 'left' });
  });

  it('rundet die Restzeit auf, damit die Uhr nie vor dem Ende 0 zeigt', () => {
    expect(deriveGuidedRunState(STEPS, START, at(14.2)).remainingSeconds).toBe(1);
    expect(deriveGuidedRunState(STEPS, START, at(14.9)).remainingSeconds).toBe(1);
  });

  it('führt durch Seitenwechsel und beide Seiten', () => {
    const left = deriveGuidedRunState(STEPS, START, at(21));
    const switching = deriveGuidedRunState(STEPS, START, at(41));
    const right = deriveGuidedRunState(STEPS, START, at(44));

    expect(left.current).toMatchObject({ kind: 'exercise', side: 'left' });
    expect(left.nextExercise).toMatchObject({ stepIndex: 1, side: 'right' });
    expect(switching.phase).toBe('transition');
    expect(switching.current).toMatchObject({ kind: 'sideSwitch', side: 'right' });
    expect(right.current).toMatchObject({ kind: 'exercise', side: 'right' });
    expect(right.nextExercise).toBeNull();
  });

  it('ist am Ende fertig und trägt den Gesamtfortschritt', () => {
    const state = deriveGuidedRunState(STEPS, START, at(63));

    expect(state.phase).toBe('finished');
    expect(state.current).toBeNull();
    expect(state.progress).toBe(1);
    expect(state.remainingTotalSeconds).toBe(0);
    expect(state.stepProgress).toEqual([1, 1]);
  });

  it('bleibt fertig, auch Minuten später', () => {
    const state = deriveGuidedRunState(STEPS, START, at(63 + 300));

    expect(state.phase).toBe('finished');
    expect(state.elapsedSeconds).toBe(63);
  });

  it('rechnet Fortschritt und Rest über die ganze Einheit', () => {
    const state = deriveGuidedRunState(STEPS, START, at(15.5));

    expect(state.elapsedSeconds).toBeCloseTo(15.5);
    expect(state.progress).toBeCloseTo(15.5 / 63);
    expect(state.remainingTotalSeconds).toBe(48);
  });

  it('teilt den Fortschritt je Schritt, Wechsel und Seitenwechsel eingerechnet', () => {
    // Schritt 0 umfasst 0 bis 15 s, Schritt 1 umfasst 15 bis 63 s.
    const state = deriveGuidedRunState(STEPS, START, at(15 + 24));

    expect(state.stepProgress[0]).toBe(1);
    expect(state.stepProgress[1]).toBeCloseTo(24 / 48);
    expect(state.stepIndex).toBe(1);
  });

  it('rechnet nach Minuten im Hintergrund die Zeit richtig weiter', () => {
    const state = deriveGuidedRunState(STEPS, START, at(50));

    expect(state.current).toMatchObject({ kind: 'exercise', side: 'right' });
    expect(state.remainingSeconds).toBe(13);
  });

  it('läuft für das Wechselsignal erst nach dem Ende der Übung', () => {
    expect(deriveGuidedRunState(STEPS, START, at(14.9)).dueSignal).toBeNull();
  });
});

describe('fälliges Signal', () => {
  it('kommt genau am Ende einer Übung', () => {
    const state = deriveGuidedRunState(STEPS, START, at(15.2));

    expect(state.dueSignal).toEqual({ key: 'exercise-end:1', dueAt: at(15) });
  });

  it('kommt auch am Ende der ersten Seite, vor dem Seitenwechsel', () => {
    expect(deriveGuidedRunState(STEPS, START, at(40.5)).dueSignal?.key).toBe('exercise-end:3');
  });

  it('kommt am Ende der letzten Übung, wenn die Einheit fertig ist', () => {
    const state = deriveGuidedRunState(STEPS, START, at(63.5));

    expect(state.phase).toBe('finished');
    expect(state.dueSignal?.key).toBe('exercise-end:5');
  });

  it('gibt es weder im Wechsel noch mitten in der Übung', () => {
    expect(deriveGuidedRunState(STEPS, START, at(2)).dueSignal).toBeNull();
    expect(deriveGuidedRunState(STEPS, START, at(8)).dueSignal).toBeNull();
    expect(deriveGuidedRunState(STEPS, START, at(30)).dueSignal).toBeNull();
  });

  it('gilt nur etwa 2 Sekunden lang (Frische-Regel)', () => {
    const fresh = at(15) + GUIDED_SIGNAL_MAX_DELAY_MS;

    expect(deriveGuidedRunState(STEPS, START, fresh).dueSignal).not.toBeNull();
    expect(deriveGuidedRunState(STEPS, START, fresh + 1).dueSignal).toBeNull();
  });

  it('holt nach der Rückkehr aus dem Hintergrund nichts nach', () => {
    // Drei Minuten später: die Einheit ist durch, aber kein Signal ist fällig.
    expect(deriveGuidedRunState(STEPS, START, at(63 + 180)).dueSignal).toBeNull();
    // Mitten im Ablauf nach einer Lücke: die Zeit stimmt, das verpasste Signal nicht.
    const state = deriveGuidedRunState(STEPS, START, at(42.5));

    expect(state.current).toMatchObject({ kind: 'sideSwitch' });
    expect(state.dueSignal).toBeNull();
  });
});

describe('addGuidedEvent', () => {
  it('hängt den Start an eine leere Liste', () => {
    expect(addGuidedEvent([], { type: 'start', at: 5 })).toEqual([{ type: 'start', at: 5 }]);
  });

  it('lässt die ursprüngliche Liste unberührt', () => {
    const events: GuidedEvent[] = [];

    addGuidedEvent(events, { type: 'start', at: 5 });

    expect(events).toEqual([]);
  });

  it('lehnt einen zweiten Start ab', () => {
    expect(() => addGuidedEvent(START, { type: 'start', at: at(1) })).toThrow(/läuft bereits/);
  });
});

describe('Pause, Weiter und Schritt neu starten', () => {
  const PAUSED: GuidedEvent[] = [...START, { type: 'pause', at: at(12) }];
  const RESUMED: GuidedEvent[] = [...PAUSED, { type: 'resume', at: at(32) }];

  it('hält die Zeit an: während der Pause ändert sich nichts', () => {
    const early = deriveGuidedRunState(STEPS, PAUSED, at(13));
    const late = deriveGuidedRunState(STEPS, PAUSED, at(500));

    expect(early.phase).toBe('paused');
    expect(late.phase).toBe('paused');
    expect(late.elapsedSeconds).toBe(12);
    expect(late.current).toMatchObject({ kind: 'exercise', stepIndex: 0 });
    expect(late.remainingSeconds).toBe(3);
  });

  it('verschiebt nach Weiter alles Spätere um die Dauer der Pause', () => {
    const state = deriveGuidedRunState(STEPS, RESUMED, at(34));

    expect(state.phase).toBe('exercise');
    expect(state.elapsedSeconds).toBe(14);
    expect(guidedRunEndsAt(STEPS, RESUMED)).toBe(at(63 + 20));
  });

  it('gibt es ohne Weiter kein Ende', () => {
    expect(guidedRunEndsAt(STEPS, PAUSED)).toBeNull();
  });

  it('lässt während der Pause kein Signal fällig werden und holt es danach zur neuen Zeit', () => {
    const paused = [...START, { type: 'pause', at: at(14.9) } satisfies GuidedEvent];

    expect(deriveGuidedRunState(STEPS, paused, at(15.2)).dueSignal).toBeNull();

    const resumed: GuidedEvent[] = [...paused, { type: 'resume', at: at(30) }];

    expect(deriveGuidedRunState(STEPS, resumed, at(30.3)).dueSignal?.key).toBe('exercise-end:1');
  });

  it('rechnet mehrere Pausen zusammen', () => {
    const events: GuidedEvent[] = [
      ...RESUMED,
      { type: 'pause', at: at(40) }, // gespielt: 12 + 8 = 20
      { type: 'resume', at: at(100) },
    ];

    expect(deriveGuidedRunState(STEPS, events, at(105)).elapsedSeconds).toBe(25);
    expect(guidedRunEndsAt(STEPS, events)).toBe(at(100 + 43));
  });

  it('startet die Übung neu: Sie beginnt wieder bei ihrem vollen Wert', () => {
    const events: GuidedEvent[] = [...START, { type: 'restart', at: at(12) }];
    const state = deriveGuidedRunState(STEPS, events, at(12.5));

    expect(state.current).toMatchObject({ kind: 'exercise', stepIndex: 0 });
    expect(state.remainingSeconds).toBe(10);
    expect(guidedRunEndsAt(STEPS, events)).toBe(at(12 + 58));
  });

  it('startet bei beidseitigen Schritten nur die aktuelle Seite neu', () => {
    // 50 s: Taube rechts (Beginn bei 43 s) - links bleibt erledigt.
    const events: GuidedEvent[] = [...START, { type: 'restart', at: at(50) }];
    const state = deriveGuidedRunState(STEPS, events, at(50.5));

    expect(state.current).toMatchObject({ kind: 'exercise', side: 'right' });
    expect(state.remainingSeconds).toBe(20);
    expect(state.stepProgress[0]).toBe(1);
  });

  it('startet im Wechsel den Wechsel neu', () => {
    const events: GuidedEvent[] = [...START, { type: 'restart', at: at(3) }];

    expect(deriveGuidedRunState(STEPS, events, at(3)).remainingSeconds).toBe(5);
  });

  it('bleibt beim Neustart in der Pause stehen und läuft mit Weiter von vorn', () => {
    const events: GuidedEvent[] = [
      ...START,
      { type: 'pause', at: at(50) },
      { type: 'restart', at: at(51) },
    ];

    expect(deriveGuidedRunState(STEPS, events, at(90))).toMatchObject({
      phase: 'paused',
      remainingSeconds: 20,
    });

    const resumed: GuidedEvent[] = [...events, { type: 'resume', at: at(100) }];

    expect(deriveGuidedRunState(STEPS, resumed, at(105)).remainingSeconds).toBe(15);
  });

  it('lässt das Signal der neu gespielten Übung noch einmal klingen', () => {
    const events: GuidedEvent[] = [...START, { type: 'restart', at: at(12) }];
    const first = deriveGuidedRunState(STEPS, START, at(15.2)).dueSignal?.key;
    const again = deriveGuidedRunState(STEPS, events, at(12 + 10 + 0.2)).dueSignal?.key;

    expect(first).toBe('exercise-end:1');
    expect(again).toBeTruthy();
    expect(again).not.toBe(first);
  });

  it('wirft eine springende Uhr nicht in die negative Zeit', () => {
    const events: GuidedEvent[] = [...START, { type: 'pause', at: at(-5) }];

    expect(deriveGuidedRunState(STEPS, events, at(10)).elapsedSeconds).toBe(0);
  });
});

describe('addGuidedEvent: Pause, Weiter, Neustart', () => {
  it('lehnt Weiter ohne Pause ab', () => {
    expect(() => addGuidedEvent(START, { type: 'resume', at: at(1) })).toThrow(/nicht pausiert/);
  });

  it('lehnt eine zweite Pause ab', () => {
    const paused = addGuidedEvent(START, { type: 'pause', at: at(1) });

    expect(() => addGuidedEvent(paused, { type: 'pause', at: at(2) })).toThrow(/schon pausiert/);
  });

  it('lehnt jedes Steuer-Ereignis vor dem Start ab', () => {
    for (const type of ['pause', 'resume', 'restart'] as const) {
      expect(() => addGuidedEvent([], { type, at: 1 })).toThrow(/noch nicht begonnen/);
    }
  });

  it('nimmt Pause, Weiter und Neustart in gültiger Folge an', () => {
    let events = addGuidedEvent(START, { type: 'pause', at: at(1) });

    events = addGuidedEvent(events, { type: 'restart', at: at(2) });
    events = addGuidedEvent(events, { type: 'resume', at: at(3) });

    expect(events.map((event) => event.type)).toEqual(['start', 'pause', 'restart', 'resume']);
  });
});

describe('guidedRunEndsAt', () => {
  it('ist der Start plus die Gesamtdauer', () => {
    expect(guidedRunEndsAt(STEPS, START)).toBe(at(63));
  });

  it('gibt es ohne Start nicht', () => {
    expect(guidedRunEndsAt(STEPS, [])).toBeNull();
  });
});

describe('isGuidedSession', () => {
  it('erkennt eine Session mit Ablauf', () => {
    expect(isGuidedSession({ guided: { steps: STEPS, events: START } })).toBe(true);
    expect(isGuidedSession({})).toBe(false);
    expect(isGuidedSession(undefined)).toBe(false);
  });
});
