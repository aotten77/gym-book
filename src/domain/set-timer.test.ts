import { describe, expect, it } from 'vitest';
import type { SetTimerState } from '@/domain/models';
import {
  DEFAULT_SET_TIMER_SECONDS,
  clampSetTimerSeconds,
  elapsedSetTimerSeconds,
  isSetTimerFor,
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

describe('elapsedSetTimerSeconds', () => {
  it('reports the time actually held when stopped early', () => {
    // 120s gestartet, noch 13s übrig - gehalten wurden 107s.
    expect(elapsedSetTimerSeconds(createTimer(), 1_000_000 - 13_000)).toBe(107);
  });

  it('caps at the started duration when the timer ran out in the background', () => {
    expect(elapsedSetTimerSeconds(createTimer(), 1_000_000 + 600_000)).toBe(120);
  });

  it('reports zero at the very start', () => {
    expect(elapsedSetTimerSeconds(createTimer(), 1_000_000 - 120_000)).toBe(0);
  });
});

describe('isSetTimerFor', () => {
  it('matches only the set log the timer was started on', () => {
    expect(isSetTimerFor(createTimer(), 'log-1')).toBe(true);
    expect(isSetTimerFor(createTimer(), 'log-2')).toBe(false);
    expect(isSetTimerFor(undefined, 'log-1')).toBe(false);
  });
});
