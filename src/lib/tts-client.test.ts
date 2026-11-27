import { describe, expect, it, vi } from 'vitest';
import { synthesizeSpeech, TtsError, type TtsPost } from '@/lib/tts-client';

const KEY = 'PLATZHALTER-SCHLUESSEL-9876';
const VOICE = 'de-DE-Chirp3-HD-Iapetus';

function audioResponse(bytes = 'MP3-BYTES') {
  return { status: 200, body: JSON.stringify({ audioContent: btoa(bytes) }) };
}

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as TtsError;
  }
  throw new Error('Erwartet war ein Fehler.');
}

describe('synthesizeSpeech', () => {
  it('sendet den Schlüssel im Header, nie in der URL, und verlangt MP3', async () => {
    const post = vi.fn<TtsPost>().mockResolvedValue(audioResponse());

    const blob = await synthesizeSpeech({ apiKey: KEY, voice: VOICE, text: 'Taube, links', post });

    expect(post).toHaveBeenCalledTimes(1);
    const [url, body, timeoutMs, headers] = post.mock.calls[0];
    expect(url).toBe('https://texttospeech.googleapis.com/v1/text:synthesize');
    expect(url).not.toContain('key=');
    expect(url).not.toContain(KEY);
    expect(headers['X-Goog-Api-Key']).toBe(KEY);
    expect(headers['Content-Type']).toBe('application/json');
    expect(timeoutMs).toBe(30_000);
    expect(JSON.parse(body)).toEqual({
      input: { text: 'Taube, links' },
      voice: { languageCode: 'de-DE', name: VOICE },
      audioConfig: { audioEncoding: 'MP3' },
    });
    expect(body).not.toContain(KEY);
    expect(blob.type).toBe('audio/mpeg');
    expect(blob.size).toBe('MP3-BYTES'.length);
  });

  it('meldet fehlenden Schlüssel ohne Request', async () => {
    const post = vi.fn<TtsPost>();

    for (const apiKey of [undefined, '', '   ']) {
      const error = await failure(synthesizeSpeech({ apiKey, voice: VOICE, text: 'Hallo', post }));
      expect(error).toBeInstanceOf(TtsError);
      expect(error.message).toBe('Kein Google-Schlüssel – in Einstellungen eintragen');
    }

    expect(post).not.toHaveBeenCalled();
  });

  it('bricht bei 4xx sofort ab und zeigt Googles Meldung, auf 200 Zeichen gekürzt', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const post = vi.fn<TtsPost>().mockResolvedValue({
      status: 400,
      body: JSON.stringify({ error: { message: 'x'.repeat(500) } }),
    });

    const error = await failure(synthesizeSpeech({ apiKey: KEY, voice: VOICE, text: 'Hallo', post, sleep }));

    expect(post).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(error.message).toBe('x'.repeat(200));
  });

  it('nutzt bei 4xx ohne lesbare Meldung den Statuscode', async () => {
    const post = vi.fn<TtsPost>().mockResolvedValue({ status: 403, body: '' });

    const error = await failure(synthesizeSpeech({ apiKey: KEY, voice: VOICE, text: 'Hallo', post }));

    expect(error.message).toContain('403');
  });

  it('wiederholt bei Netzfehler genau einmal nach 5 Sekunden', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const post = vi
      .fn<TtsPost>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(audioResponse());

    const blob = await synthesizeSpeech({ apiKey: KEY, voice: VOICE, text: 'Hallo', post, sleep });

    expect(post).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(5000);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('gibt nach zwei Fehlschlägen auf und nennt, woran es lag', async () => {
    for (const [post, message] of [
      [
        vi.fn<TtsPost>().mockResolvedValue({ status: 503, body: '{}' }),
        'Google-Fehler 503 – Ansagen nicht erzeugt',
      ],
      [
        vi.fn<TtsPost>().mockRejectedValue(new TypeError('Load failed')),
        'Keine Verbindung zu Google – Ansagen nicht erzeugt',
      ],
    ] as const) {
      const sleep = vi.fn().mockResolvedValue(undefined);
      const error = await failure(synthesizeSpeech({ apiKey: KEY, voice: VOICE, text: 'Hallo', post, sleep }));

      expect(error.message).toBe(message);
      expect(post).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledTimes(1);
    }
  });

  it('meldet einen Timeout als zu späte Antwort, auch als Abbruch der eigenen Frist', async () => {
    for (const name of ['TimeoutError', 'AbortError']) {
      const post = vi.fn<TtsPost>().mockRejectedValue(new DOMException('Abbruch', name));

      const error = await failure(
        synthesizeSpeech({ apiKey: KEY, voice: VOICE, text: 'Hallo', post, sleep: async () => {} }),
      );

      expect(error.message).toBe('Google hat nicht rechtzeitig geantwortet – Ansagen nicht erzeugt');
    }
  });

  it('meldet eine Antwort ohne Audio', async () => {
    const post = vi.fn<TtsPost>().mockResolvedValue({ status: 200, body: '{"foo":1}' });

    const error = await failure(synthesizeSpeech({ apiKey: KEY, voice: VOICE, text: 'Hallo', post }));

    expect(error.message).toBe('Google-Antwort ohne Audio');
  });

  it('lässt den Schlüssel in keiner Meldung stehen, auch wenn Google ihn zurückspielt', async () => {
    const post = vi.fn<TtsPost>().mockResolvedValue({
      status: 400,
      body: JSON.stringify({ error: { message: `API key not valid: ${KEY}. Please pass a valid key ${KEY}` } }),
    });

    const error = await failure(synthesizeSpeech({ apiKey: KEY, voice: VOICE, text: 'Hallo', post }));

    expect(error.message).not.toContain(KEY);
    expect(error.message).not.toContain('9876');
    expect(error.message).toContain('API key not valid');
  });

  it('schreibt den Schlüssel nie in die Konsole', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) =>
      vi.spyOn(console, name).mockImplementation(() => {}),
    );
    const post = vi.fn<TtsPost>().mockResolvedValue({ status: 500, body: KEY });

    await failure(synthesizeSpeech({ apiKey: KEY, voice: VOICE, text: 'Hallo', post, sleep: async () => {} }));

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});
