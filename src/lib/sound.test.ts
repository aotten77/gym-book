import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Ein AudioContext, der wie der von iOS beginnt: schlafend.
 *
 * Nur so viel, wie das Modul anfasst - gezählt wird, wie viele Oszillatoren
 * tatsächlich gestartet wurden.
 */
interface FakeBufferSource {
  buffer: unknown;
  stopCalls: number;
  connect: () => void;
  start: () => void;
  stop: () => void;
}

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

  sources: FakeBufferSource[] = [];
  /** Lässt `stop` werfen - wie bei einer Quelle, die nie gestartet wurde. */
  stopThrows = false;

  createBufferSource(): FakeBufferSource {
    const source: FakeBufferSource = {
      buffer: null,
      stopCalls: 0,
      connect: () => {},
      start: () => {},
      stop: () => {
        source.stopCalls += 1;

        if (this.stopThrows) {
          throw new Error('InvalidStateError');
        }
      },
    };

    this.sources.push(source);
    return source;
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

describe('playGuidedSignal', () => {
  it('setzt die Audio-Sitzung auf ambient und spielt genau einen Ton', async () => {
    const context = new FakeAudioContext();
    context.state = 'running';
    const audioSession = { type: 'auto' };
    vi.stubGlobal(
      'AudioContext',
      class {
        constructor() {
          return context;
        }
      },
    );
    vi.stubGlobal('navigator', { audioSession });

    const { playGuidedSignal } = await loadSoundModule();

    playGuidedSignal();

    expect(audioSession.type).toBe('ambient');
    expect(context.startedOscillators).toBe(1);
  });

  it('weckt einen eingeschlafenen Kontext wie das Timer-Signal', async () => {
    const context = new FakeAudioContext();
    vi.stubGlobal(
      'AudioContext',
      class {
        constructor() {
          return context;
        }
      },
    );

    const { playGuidedSignal } = await loadSoundModule();

    playGuidedSignal();
    expect(context.startedOscillators).toBe(0);

    context.letResumeThrough();
    await vi.waitFor(() => expect(context.startedOscillators).toBe(1));
  });
});

describe('eine laufende Ansage', () => {
  function stubRunningContext() {
    const context = new FakeAudioContext();

    context.state = 'running';
    vi.stubGlobal(
      'AudioContext',
      class {
        constructor() {
          return context;
        }
      },
    );

    return context;
  }

  it('stoppt die laufende, bevor eine neue startet', async () => {
    const context = stubRunningContext();
    const { playAudioBufferWhenAwake } = await loadSoundModule();

    playAudioBufferWhenAwake({} as AudioBuffer);
    playAudioBufferWhenAwake({} as AudioBuffer);

    expect(context.sources.map((source) => source.stopCalls)).toEqual([1, 0]);
  });

  it('stoppt sie auf Wunsch genau einmal', async () => {
    const context = stubRunningContext();
    const { playAudioBufferWhenAwake, stopAnnouncement } = await loadSoundModule();

    playAudioBufferWhenAwake({} as AudioBuffer);
    stopAnnouncement();
    stopAnnouncement();

    expect(context.sources[0].stopCalls).toBe(1);
  });

  it('bleibt still, wenn das Stoppen wirft', async () => {
    const context = stubRunningContext();
    const { playAudioBufferWhenAwake, stopAnnouncement } = await loadSoundModule();

    context.stopThrows = true;
    playAudioBufferWhenAwake({} as AudioBuffer);

    expect(() => stopAnnouncement()).not.toThrow();
    expect(() => playAudioBufferWhenAwake({} as AudioBuffer)).not.toThrow();
  });
});
