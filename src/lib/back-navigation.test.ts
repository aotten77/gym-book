import { describe, expect, it, vi } from 'vitest';
import { FROM_PLAN_STATE, goBackToOrigin, readFromPlanState } from './back-navigation';

describe('readFromPlanState', () => {
  it('erkennt die Markierung des Plans', () => {
    expect(readFromPlanState({ from: 'plan' })).toBe(true);
    expect(readFromPlanState(FROM_PLAN_STATE)).toBe(true);
  });

  it.each([[null], [undefined], [{}], ['plan'], [42], [{ from: 'history' }], [{ from: true }]])(
    '%j gilt nicht als Plan',
    (state) => {
      expect(readFromPlanState(state)).toBe(false);
    },
  );
});

describe('goBackToOrigin', () => {
  it('geht aus dem Plan einen Schritt zurück', () => {
    const navigate = vi.fn();

    goBackToOrigin(navigate, { from: 'plan' });

    expect(navigate).toHaveBeenCalledWith(-1);
  });

  it.each([[null], [undefined], [{ openFocus: true }]])(
    'führt ohne Herkunft (%j) in den Verlauf, nie ins Leere',
    (state) => {
      const navigate = vi.fn();

      goBackToOrigin(navigate, state);

      expect(navigate).toHaveBeenCalledWith('/history');
    },
  );
});
