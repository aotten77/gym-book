import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTimerSpeechSupported, speakTimerAnnouncement } from '@/lib/speech';

interface SpokenUtterance {
  text: string;
  lang: string;
  volume: number;
}

/**
 * Setzt eine aufzeichnende Sprachausgabe ein.
 *
 * jsdom bringt keine mit - genau der Fall, den das Modul stumm überstehen muss.
 */
function installSpeechStub() {
  const spoken: SpokenUtterance[] = [];
  const calls: string[] = [];

  class UtteranceStub {
    lang = '';
    rate = 1;
    pitch = 1;
    volume = 1;

    constructor(public text: string) {}
  }

  vi.stubGlobal('SpeechSynthesisUtterance', UtteranceStub);
  vi.stubGlobal('speechSynthesis', {
    cancel() {
      calls.push('cancel');
    },
    speak(utterance: UtteranceStub) {
      calls.push('speak');
      spoken.push({ text: utterance.text, lang: utterance.lang, volume: utterance.volume });
    },
  });

  return { spoken, calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isTimerSpeechSupported', () => {
  it('reports nothing to speak with when the API is missing', () => {
    expect(isTimerSpeechSupported()).toBe(false);
  });

  it('needs the utterance constructor, not just the service', () => {
    // Es gibt Stände und Testdoppel mit nur einer der beiden Hälften.
    vi.stubGlobal('speechSynthesis', { cancel() {}, speak() {} });

    expect(isTimerSpeechSupported()).toBe(false);
  });
});

describe('speakTimerAnnouncement', () => {
  it('stays silent instead of throwing when the device cannot speak', () => {
    expect(() => speakTimerAnnouncement('Halbzeit')).not.toThrow();
  });

  it('cancels a pending utterance before speaking', () => {
    // Eine hängende Warteschlange ließe die Ansage Minuten zu spät ankommen.
    const { calls, spoken } = installSpeechStub();

    speakTimerAnnouncement('Halbzeit');

    expect(calls).toEqual(['cancel', 'speak']);
    expect(spoken).toEqual([{ text: 'Halbzeit', lang: 'de-DE', volume: 1 }]);
  });
});
