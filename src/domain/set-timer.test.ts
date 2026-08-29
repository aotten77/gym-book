import { describe, expect, it } from 'vitest';
import type { SetTimerState } from '@/domain/models';
import {
  DEFAULT_SET_TIMER_SECONDS,
  SET_TIMER_MAX_OVERTIME_SECONDS,
  clampSetTimerSeconds,
  elapsedSetTimerSeconds,
  formatSetTimerClock,
  isSetTimerActive,
  isSetTimerFor,
  overtimeSetTimerSeconds,
  remainingSetTimerSeconds,
  resolveSetTimerSeconds,
} from '@/domain/set-timer';

function createTimer(overrides: Partial<SetTimerState> = {}): SetTimerState {
  return {
    setLogId: 'log-1',
    endsAt: 1_000_000,
    durationSeconds: 120,
    ...overrides,
  };
}

describe('resolveSetTimerSeconds', () => {
  it('prefers the value entered in the set over the target of the exercise', () => {
    expect(resolveSetTimerSeconds(90, 120)).toBe(90);
  });

  it('falls back to the target of the exercise', () => {
    expect(resolveSetTimerSeconds(undefined, 120)).toBe(120);
  });

  it('falls back to the default when nothing is given', () => {
    expect(resolveSetTimerSeconds()).toBe(DEFAULT_SET_TIMER_SECONDS);
  });

  it('ignores zero and skips to the next candidate', () => {
    // Sonst startete ein Satz mit "0" einen Timer, der sofort abläuft.
    expect(resolveSetTimerSeconds(0, 120)).toBe(120);
    expect(resolveSetTimerSeconds(0, 0)).toBe(DEFAULT_SET_TIMER_SECONDS);
  });

  it('clamps out-of-range values instead of starting an absurd timer', () => {
    expect(resolveSetTimerSeconds(1)).toBe(5);
    expect(resolveSetTimerSeconds(99_999)).toBe(3600);
  });
});

describe('clampSetTimerSeconds', () => {
  it('rounds to whole seconds', () => {
    expect(clampSetTimerSeconds(90.4)).toBe(90);
  });

  it('replaces a non-number with the default', () => {
    expect(clampSetTimerSeconds(Number.NaN)).toBe(DEFAULT_SET_TIMER_SECONDS);
  });
});

describe('remainingSetTimerSeconds', () => {
  it('counts down to the end', () => {
    expect(remainingSetTimerSeconds(createTimer(), 1_000_000 - 45_000)).toBe(45);
  });

  it('never goes below zero once the timer has run out', () => {
    expect(remainingSetTimerSeconds(createTimer(), 1_000_000 + 30_000)).toBe(0);
  });

  it('reports zero without a timer', () => {
    expect(remainingSetTimerSeconds(undefined, 1_000_000)).toBe(0);
  });
});

describe('overtimeSetTimerSeconds', () => {
  it('stays at zero before the timer runs out', () => {
    expect(overtimeSetTimerSeconds(createTimer(), 1_000_000 - 13_000)).toBe(0);
    expect(overtimeSetTimerSeconds(createTimer(), 1_000_000)).toBe(0);
  });

  it('counts up once the target is reached', () => {
    // Abgerundet: eine angefangene Sekunde ist noch nicht gehalten.
    expect(overtimeSetTimerSeconds(createTimer(), 1_000_000 + 12_800)).toBe(12);
  });

  it('caps the overtime so a forgotten timer stays a measurement', () => {
    expect(overtimeSetTimerSeconds(createTimer(), 1_000_000 + 600_000)).toBe(
      SET_TIMER_MAX_OVERTIME_SECONDS,
    );
  });

  it('reports zero without a timer', () => {
    expect(overtimeSetTimerSeconds(undefined, 1_000_000)).toBe(0);
  });
});

describe('elapsedSetTimerSeconds', () => {
  it('reports the time actually held when stopped early', () => {
    // 120s gestartet, noch 13s übrig - gehalten wurden 107s.
    expect(elapsedSetTimerSeconds(createTimer(), 1_000_000 - 13_000)).toBe(107);
  });

  it('counts the overtime, so a longer hold reaches the set', () => {
    // 120s vorgegeben, 22s länger gehalten.
    expect(elapsedSetTimerSeconds(createTimer(), 1_000_000 + 22_000)).toBe(142);
  });

  it('caps at duration plus overtime when the timer ran out in the background', () => {
    expect(elapsedSetTimerSeconds(createTimer(), 1_000_000 + 600_000)).toBe(
      120 + SET_TIMER_MAX_OVERTIME_SECONDS,
    );
  });

  it('reports zero at the very start', () => {
    expect(elapsedSetTimerSeconds(createTimer(), 1_000_000 - 120_000)).toBe(0);
  });
});

describe('isSetTimerActive', () => {
  it('holds while the timer exists, also past the target', () => {
    expect(isSetTimerActive(createTimer())).toBe(true);
  });

  it('is false without a timer and for a broken one', () => {
    expect(isSetTimerActive(undefined)).toBe(false);
    expect(isSetTimerActive(createTimer({ durationSeconds: 0 }))).toBe(false);
  });
});

describe('formatSetTimerClock', () => {
  it('shows the remaining time while the countdown runs', () => {
    expect(formatSetTimerClock(45, 0)).toBe('00:45');
  });

  it('shows the overtime with a plus once the target is passed', () => {
    // Ein Plus, kein Minus: über der Vorgabe ist keine Unterdeckung.
    expect(formatSetTimerClock(0, 12)).toBe('+00:12');
  });
});

describe('isSetTimerFor', () => {
  it('matches only the set log the timer was started on', () => {
    expect(isSetTimerFor(createTimer(), 'log-1')).toBe(true);
    expect(isSetTimerFor(createTimer(), 'log-2')).toBe(false);
    expect(isSetTimerFor(undefined, 'log-1')).toBe(false);
  });
});
