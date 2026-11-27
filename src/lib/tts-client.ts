/**
 * Client für Google Cloud Text-to-Speech - der einzige Netzweg der App.
 *
 * Er dient nur dazu, Ansagen zu erzeugen, und liegt nie im Trainingsablauf:
 * fällt er aus, läuft die geführte Einheit mit "Nur Ton". Übertragen aus
 * yt-brain (`tts.py`); `post` und `sleep` sind injizierbar, damit die Tests
 * ohne echten Aufruf laufen.
 *
 * Der Schlüssel reist im Header `X-Goog-Api-Key`, nie in der URL, und steht in
 * keiner Meldung und in keiner Konsolenausgabe. Hier wird deshalb nirgends
 * `console` benutzt, und jede Meldung läuft vor der Ausgabe durch [scrubKey].
 */

const TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';
const TIMEOUT_MS = 30_000;
const RETRY_WAIT_MS = 5_000;
const ERROR_CHARS = 200;

export const MISSING_KEY_MESSAGE = 'Kein Google-Schlüssel – in Einstellungen eintragen';
export const FAILED_MESSAGE = 'Ansagen nicht erzeugt';
const NO_CONNECTION_MESSAGE = `Keine Verbindung zu Google – ${FAILED_MESSAGE}`;
const TIMEOUT_MESSAGE = `Google hat nicht rechtzeitig geantwortet – ${FAILED_MESSAGE}`;
const NO_AUDIO_MESSAGE = 'Google-Antwort ohne Audio';

/** Die Meldung ist immer anzeigbar und enthält nie den Schlüssel. */
export class TtsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TtsError';
  }
}

export type TtsPost = (
  url: string,
  body: string,
  timeoutMs: number,
  headers: Record<string, string>,
) => Promise<{ status: number; body: string }>;

export interface SynthesizeOptions {
  apiKey: string | undefined;
  voice: string;
  text: string;
  post?: TtsPost;
  sleep?: (ms: number) => Promise<void>;
}

export const fetchPost: TtsPost = async (url, body, timeoutMs, headers) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });

    return { status: response.status, body: await response.text() };
  } finally {
    clearTimeout(timer);
  }
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function scrubKey(message: string, apiKey: string) {
  return apiKey ? message.split(apiKey).join('…') : message;
}

function googleMessage(status: number, body: string, apiKey: string) {
  let text = '';

  try {
    const parsed: unknown = JSON.parse(body);
    const message = (parsed as { error?: { message?: unknown } })?.error?.message;

    if (typeof message === 'string') {
      text = message;
    }
  } catch {
    // Kein JSON - dann bleibt der Statuscode.
  }

  // Erst ausmaskieren, dann kürzen: ein abgeschnittener Schlüssel ließe Reste stehen.
  return scrubKey(text, apiKey).slice(0, ERROR_CHARS) || `Google ${status}`;
}

function decodeAudio(body: string) {
  try {
    const content = (JSON.parse(body) as { audioContent?: unknown }).audioContent;

    if (typeof content !== 'string' || !content) {
      return null;
    }

    const binary = atob(content);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return new Blob([bytes], { type: 'audio/mpeg' });
  } catch {
    return null;
  }
}

/** Erzeugt eine Ansage als MP3. Wirft ausschließlich [TtsError]. */
export async function synthesizeSpeech({
  apiKey,
  voice,
  text,
  post = fetchPost,
  sleep = defaultSleep,
}: SynthesizeOptions): Promise<Blob> {
  const key = apiKey?.trim() ?? '';

  if (!key) {
    throw new TtsError(MISSING_KEY_MESSAGE);
  }

  const body = JSON.stringify({
    input: { text },
    voice: { languageCode: voice.split('-').slice(0, 2).join('-'), name: voice },
    audioConfig: { audioEncoding: 'MP3' },
  });
  const headers = { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key };

  // Was beim letzten Versuch schiefging - die Meldung nennt es, damit man
  // Netz, Frist und Google auseinanderhalten kann.
  let lastFailure = FAILED_MESSAGE;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: { status: number; body: string } | null = null;

    try {
      response = await post(TTS_URL, body, TIMEOUT_MS, headers);
    } catch (error) {
      // Nur die Art des Fehlers zählt; die Ausnahme selbst wird bewusst nicht weitergereicht.
      const timedOut =
        error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError');

      lastFailure = timedOut ? TIMEOUT_MESSAGE : NO_CONNECTION_MESSAGE;
    }

    if (response) {
      if (response.status === 200) {
        const blob = decodeAudio(response.body);

        if (!blob || blob.size === 0) {
          throw new TtsError(NO_AUDIO_MESSAGE);
        }

        return blob;
      }

      if (response.status < 500) {
        throw new TtsError(googleMessage(response.status, response.body, key));
      }

      lastFailure = `Google-Fehler ${response.status} – ${FAILED_MESSAGE}`;
    }

    if (attempt === 0) {
      await sleep(RETRY_WAIT_MS);
    }
  }

  throw new TtsError(lastFailure);
}
