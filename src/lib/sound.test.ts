import { afterEach, describe, expect, it, vi } from 'vitest';
import { isChimeFresh } from '@/lib/sound';

/**
 * Ein AudioContext, der wie der von iOS beginnt: schlafend.
 *
 * Nur so viel, wie das Modul anfasst - gezählt wird, wie viele Oszillatoren
 * tatsächlich gestartet wurden.
 */
class FakeAudioContext {
  state: 'suspended' | 'running' = 'suspended';
  currentTime = 0;
  sampleRate = 44_100;
  destination = {};
  startedOscillators = 0;
  private resumeGate: (() => void) | null = null;

  addEventListener() {}

  createBuffer() {
    return {};
  }

  createBufferSource(): { buffer: unknown; connect: () => void; start: () => void } {
    return { buffer: null, connect: () => {}, start: () => {} };
  }

  createGain() {
    return {
      gain: {
        setValueAtTime: () => {},
        exponentialRampToValueAtTime: () => {},
      },
      connect: () => {},
    };
  }

  createOscillator() {
    return {
      type: '',
      frequency: { setValueAtTime: () => {} },
      connect: () => {},
      start: () => {
        this.startedOscillators += 1;
      },
      stop: () => {},
    };
  }

  resume() {
    return new Promise<void>((resolve) => {
      this.resumeGate = () => {
        this.state = 'running';
        resolve();
      };
    });
  }

  /** Lässt das ausstehende `resume()` durchgehen - wie eine Berührung. */
  letResumeThrough() {
    this.resumeGate?.();
    this.resumeGate = null;
  }
}

/** Frisches Modul je Test: der AudioContext ist eine Modulvariable. */
async function loadSoundModule() {
  vi.resetModules();
  return import('@/lib/sound');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isChimeFresh', () => {
  const now = 1_700_000_000_000;

  it('meldet den Ablauf, der gerade passiert ist', () => {
    expect(isChimeFresh(now, now)).toBe(true);
    expect(isChimeFresh(now - 3_000, now)).toBe(true);
  });

  it('bleibt still, wenn der Ablauf lange zurückliegt', () => {
    // Der Fall nach dem Zurückwechseln aus dem Hintergrund: dort tickt keine
    // Uhr, der Ablauf fällt erst Minuten später auf.
    expect(isChimeFresh(now - 60_000, now)).toBe(false);
  });

  it('behandelt eine Uhr, die zurückgesprungen ist, als frisch', () => {
    // Zeitumstellung oder eine korrigierte Systemuhr sollen den Ton nicht
    // unterdrücken - der Timer ist trotzdem gerade abgelaufen.
    expect(isChimeFresh(now + 5_000, now)).toBe(true);
  });
});

describe('playTimerChime bei eingeschlafenem Kontext', () => {
  it('weckt ihn und spielt dann, statt still aufzugeben', async () => {
    /*
     * Der Fehler, an dem der Ton beim Ablauf lange stumm blieb: iOS legt den
     * Kontext bei jedem Wechsel in den Hintergrund schlafen, und früher kehrte
     * das Abspielen dann einfach zurück - für den Rest des Seitenlaufs.
     */
    const context = new FakeAudioContext();
    vi.stubGlobal(
      'AudioContext',
      class {
        constructor() {
          return context;
        }
      },
    );

    const { playTimerChime } = await loadSoundModule();

    playTimerChime();
    expect(context.startedOscillators).toBe(0);

    context.letResumeThrough();
    await vi.waitFor(() => expect(context.startedOscillators).toBeGreaterThan(0));
  });

  it('lässt den Ton aus, wenn das Wecken zu lange gedauert hat', async () => {
    // Hängt das `resume()` an der nächsten Berührung, kommt sie womöglich erst
    // Minuten später - dann wäre der Ton ein Schreck, kein Hinweis.
    const context = new FakeAudioContext();
    vi.stubGlobal(
      'AudioContext',
      class {
        constructor() {
          return context;
        }
      },
    );

    const { playTimerChime } = await loadSoundModule();

    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
      playTimerChime();
      vi.advanceTimersByTime(60_000);
      context.letResumeThrough();
      await vi.waitFor(() => expect(context.state).toBe('running'));
    } finally {
      vi.useRealTimers();
    }

    expect(context.startedOscillators).toBe(0);
  });
});
