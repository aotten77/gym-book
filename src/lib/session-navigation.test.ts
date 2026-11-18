import { describe, expect, it, vi } from 'vitest';
import { navigateToStartedSession, readOpenFocusState } from './session-navigation';

describe('readOpenFocusState', () => {
  it('erkennt den Navigationsstate eines frischen Starts', () => {
    expect(readOpenFocusState({ openFocus: true })).toBe(true);
  });

  it.each([[null], [undefined], [{}], ['x'], [42], [{ openFocus: false }], [{ openFocus: 'true' }]])(
    '%j öffnet nichts',
    (state) => {
      expect(readOpenFocusState(state)).toBe(false);
    },
  );
});

describe('navigateToStartedSession', () => {
  it('führt in die Session und gibt den Öffnen-Wunsch als State mit', () => {
    const navigate = vi.fn();

    navigateToStartedSession(navigate, 'abc');

    expect(navigate).toHaveBeenCalledWith('/session/abc', { state: { openFocus: true } });
  });
});
