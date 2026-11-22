import { acquireAudioContextFromGesture, setAmbientAudioSession } from '@/lib/sound';

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
