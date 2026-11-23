import {
  acquireAudioContextFromGesture,
  getSharedAudioContext,
  playAudioBufferWhenAwake,
  setAmbientAudioSession,
} from '@/lib/sound';

/**
 * Spielt eine MP3-Ansage über Web Audio ab, gemischt mit laufender Musik.
 *
 * `speechSynthesis` wird hier bewusst nicht benutzt - es stoppt auf dem iPhone
 * die Musik. Aus einer Nutzergeste heraus aufrufen; die Funktion wirft mit
 * anzeigbarer Meldung, wenn nichts abspielbar ist.
 */
export async function playAnnouncementFromGesture(blob: Blob): Promise<void> {
  setAmbientAudioSession();

  const context = await acquireAudioContextFromGesture();

  if (!context) {
    throw new Error('Ton ist auf diesem Gerät nicht verfügbar.');
  }

  let buffer: AudioBuffer;

  try {
    buffer = await context.decodeAudioData(await blob.arrayBuffer());
  } catch {
    throw new Error('Die Ansage ließ sich nicht abspielen.');
  }

  const source = context.createBufferSource();

  source.buffer = buffer;
  source.connect(context.destination);
  source.start();
}

/**
 * Dekodiert die Ansagen einer Einheit einmal beim Start, damit beim Wechsel
 * nichts mehr geladen oder dekodiert wird. Der Kontext darf noch gesperrt
 * sein. Was sich nicht dekodieren lässt, fehlt in der Antwort - dann bleibt
 * es bei dem Signal. Die Eingabepuffer werden dabei abgelöst. `onDecoded`
 * meldet jede Ansage, sobald sie fertig ist - in der Reihenfolge der Eingabe.
 */
export async function decodeAnnouncements(
  audio: ReadonlyMap<string, ArrayBuffer>,
  onDecoded?: (text: string, buffer: AudioBuffer) => void,
): Promise<Map<string, AudioBuffer>> {
  const decoded = new Map<string, AudioBuffer>();
  const context = getSharedAudioContext();

  if (!context) {
    return decoded;
  }

  for (const [text, data] of audio) {
    try {
      const buffer = await context.decodeAudioData(data);

      decoded.set(text, buffer);
      onDecoded?.(text, buffer);
    } catch {
      // Eine kaputte Ansage ist kein Grund, die Einheit zu stören.
    }
  }

  return decoded;
}

/**
 * Spielt eine dekodierte Ansage im Ablauf, ohne Geste: der Kontext wurde beim
 * Start entsperrt. `delaySeconds` legt sie hinter das Wechselsignal.
 */
export function playDecodedAnnouncement(buffer: AudioBuffer, delaySeconds: number) {
  playAudioBufferWhenAwake(buffer, delaySeconds);
}
