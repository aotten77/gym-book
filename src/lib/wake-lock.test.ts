import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isScreenWakeLockSupported, keepScreenAwake } from '@/lib/wake-lock';

/**
 * Der Sentinel, den die echte API zurückgibt - reduziert auf das, was hier
 * benutzt wird. `release` merkt sich den Aufruf, damit die Freigabe prüfbar
 * bleibt; das `release`-Ereignis steht für den Fall, dass das System die
 * Sperre von sich aus wegnimmt.
 */
function createSentinel() {
  const listeners = new Set<() => void>();

  return {
    released: false,
    release: vi.fn(function (this: { released: boolean }) {
      this.released = true;
      return Promise.resolve();
    }),
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    /** Das System hat die Sperre genommen - so wie beim Sperren des Geräts. */
    emitSystemRelease: () => listeners.forEach((listener) => listener()),
  };
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('keepScreenAwake', () => {
  let sentinels: ReturnType<typeof createSentinel>[];
  let request: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sentinels = [];
    request = vi.fn(() => {
      const sentinel = createSentinel();

      sentinels.push(sentinel);
      return Promise.resolve(sentinel);
    });

    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request },
    });
    setVisibility('visible');
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'wakeLock');
    Reflect.deleteProperty(document, 'visibilityState');
  });

  it('fordert die Sperre für den Bildschirm an', async () => {
    const stop = keepScreenAwake();

    await vi.waitFor(() => expect(request).toHaveBeenCalledWith('screen'));

    stop();
  });

  it('holt die Sperre zurück, nachdem das Gerät entsperrt wurde', async () => {
    // Der eigentliche Fall: iOS nimmt die Sperre beim Ausschalten des Displays
    // weg. Ohne die Neuanforderung wäre sie nach dem ersten Sperren für den
    // Rest der Einheit verloren.
    const stop = keepScreenAwake();

    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    sentinels[0].emitSystemRelease();
    setVisibility('hidden');
    setVisibility('visible');

    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));

    stop();
  });

  it('fordert nichts an, solange das Dokument im Hintergrund liegt', async () => {
    // Die API verweigert das dort ohnehin - der Versuch würde nur einen
    // Fehler erzeugen, den niemand liest.
    setVisibility('hidden');

    const stop = keepScreenAwake();

    await Promise.resolve();
    expect(request).not.toHaveBeenCalled();

    stop();
  });

  it('gibt die Sperre am Ende der Einheit frei', async () => {
    const stop = keepScreenAwake();

    await vi.waitFor(() => expect(sentinels).toHaveLength(1));

    stop();

    expect(sentinels[0].release).toHaveBeenCalled();
  });

  it('gibt eine Sperre frei, die erst nach dem Ende eintrifft', async () => {
    // Zwischen Anforderung und Antwort liegt ein await; wird die Einheit genau
    // dort beendet, hätte niemand mehr eine Referenz auf den Sentinel.
    const stop = keepScreenAwake();

    stop();

    await vi.waitFor(() => expect(sentinels).toHaveLength(1));
    await vi.waitFor(() => expect(sentinels[0].release).toHaveBeenCalled());
  });

  it('reagiert nach dem Ende nicht mehr auf Sichtbarkeitswechsel', async () => {
    const stop = keepScreenAwake();

    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    stop();
    setVisibility('hidden');
    setVisibility('visible');

    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('bleibt folgenlos, wenn das Gerät die API nicht kennt', () => {
    Reflect.deleteProperty(navigator, 'wakeLock');

    expect(isScreenWakeLockSupported()).toBe(false);
    expect(() => keepScreenAwake()()).not.toThrow();
  });
});
