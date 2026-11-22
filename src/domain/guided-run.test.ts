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
