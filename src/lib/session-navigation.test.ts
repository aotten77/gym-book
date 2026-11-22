import { describe, expect, it, vi } from 'vitest';
import {
  navigateToGuidedStart,
  navigateToStartedSession,
  readGuidedStartState,
  readOpenFocusState,
} from './session-navigation';

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

describe('navigateToGuidedStart', () => {
  it('führt auf den Start-Screen der Vorlage', () => {
    const navigate = vi.fn();

    navigateToGuidedStart(navigate, 'abc');

    expect(navigate).toHaveBeenCalledWith('/guided/abc', { state: {} });
  });

  it('gibt den Termin als State mit, für den später gestartet wird', () => {
    const navigate = vi.fn();

    navigateToGuidedStart(navigate, 'abc', { planEntryId: 'entry-1' });

    expect(navigate).toHaveBeenCalledWith('/guided/abc', { state: { planEntryId: 'entry-1' } });
  });
});

describe('readGuidedStartState', () => {
  it('liest den Termin aus dem State', () => {
    expect(readGuidedStartState({ planEntryId: 'entry-1' })).toEqual({ planEntryId: 'entry-1' });
  });

  it.each([[null], [undefined], [{}], ['x'], [42], [{ planEntryId: 7 }], [{ planEntryId: '' }]])(
    '%j nennt keinen Termin',
    (state) => {
      expect(readGuidedStartState(state)).toEqual({});
    },
  );
});
