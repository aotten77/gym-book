/**
 * Signalton beim Ablauf der Timer - Ergänzung zur Vibration, kein Ersatz.
 *
 * Bewusst synthetisiert statt abgespielt: eine Audiodatei wäre ein weiteres
 * Asset, das der Service Worker für den Offline-Betrieb vorhalten müsste. Ein
 * Oszillator braucht nichts davon und klingt auf jedem Gerät gleich.
 */

/** Ab dieser Verspätung bleibt der Ton aus - siehe [isChimeFresh]. */
const CHIME_MAX_DELAY_MS = 4000;

/** Zwei kurze Töne, im Rhythmus der Vibration [180, 90, 180]. */
const CHIME_TONES = [
  { offsetSeconds: 0, durationSeconds: 0.18, frequency: 880 },
  { offsetSeconds: 0.27, durationSeconds: 0.22, frequency: 1174.7 },
];

const PEAK_GAIN = 0.22;

/**
 * Wie lange ein `resume()` beim Ablauf höchstens brauchen darf.
 *
 * Läuft der Kontext, kehrt es in Millisekunden zurück. Wartet es länger, wartet
 * es in Wahrheit auf eine Berührung - und die kommt womöglich erst Minuten
 * später. Der Ton wäre dann derselbe Schreck, den [isChimeFresh] verhindert.
 */
const RESUME_GRACE_MS = 1000;

type AudioContextConstructor = typeof AudioContext;

let audioContext: AudioContext | null = null;
let unlockListenersActive = false;
let documentListenersActive = false;

function resolveAudioContextConstructor(): AudioContextConstructor | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  // Ältere WebKit-Stände kennen nur das Präfix.
  const candidate = window as Window &
    typeof globalThis & { webkitAudioContext?: AudioContextConstructor };

  return candidate.AudioContext ?? candidate.webkitAudioContext;
}

/**
 * Lesen des Zustands hinter einem Funktionsaufruf.
 *
 * Direkte Vergleiche würden nach einem früheren `state === 'running'` als
 * unerreichbar gelten - der Zustand ändert sich aber genau dazwischen.
 */
function isRunning(context: AudioContext) {
  return context.state === 'running';
}

function ensureAudioContext(): AudioContext | null {
  if (audioContext) {
    return audioContext;
  }

  const AudioContextClass = resolveAudioContextConstructor();

  if (!AudioContextClass) {
    return null;
  }

  try {
    audioContext = new AudioContextClass();
    watchAudioContext(audioContext);
  } catch {
    // Kein Audio - kein Grund, den Ablauf des Timers scheitern zu lassen.
    audioContext = null;
  }

  return audioContext;
}

/**
 * Hängt sich an den Kontext, damit er nach dem Einschlafen wieder aufwacht.
 *
 * Das ist der Grund, warum der Ton beim Ablauf lange stumm blieb, während "Ton
 * testen" klang: iOS legt den Kontext schlafen, sobald das Dokument nicht mehr
 * sichtbar ist - App-Switcher, Mitteilung, kurzes Sperren genügen. Freigegeben
 * wurde er aber nur ein einziges Mal, beim Betreten der Session; danach räumten
 * sich die Listener ab und niemand fragte je wieder nach. Der Testknopf kam
 * durch, weil er aus einer Geste heraus selbst `resume()` abwartet.
 *
 * Zwei Anlässe wecken jetzt: der Zustandswechsel des Kontexts und die Rückkehr
 * ins Sichtbare. Beim zweiten wird zusätzlich sofort probiert - nach dem
 * Zurückwechseln lässt WebKit das oft ohne Berührung zu, und wenn nicht, liegen
 * die Listener bereit.
 */
function watchAudioContext(context: AudioContext) {
  try {
    context.addEventListener('statechange', () => {
      if (!isRunning(context)) {
        armUnlockListeners();
      }
    });
  } catch {
    // Ohne Ereignis bleibt es beim bisherigen Verhalten.
  }

  if (documentListenersActive || typeof document === 'undefined') {
    return;
  }

  documentListenersActive = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !audioContext || isRunning(audioContext)) {
      return;
    }

    armUnlockListeners();
    void audioContext.resume().catch(() => undefined);
  });
}

function removeUnlockListeners() {
  if (!unlockListenersActive) {
    return;
  }

  document.removeEventListener('pointerdown', handleUnlockGesture);
  document.removeEventListener('touchend', handleUnlockGesture);
  document.removeEventListener('keydown', handleUnlockGesture);
  unlockListenersActive = false;
}

/** Legt die Freischaltung auf die nächste Berührung. Mehrfach aufrufbar. */
function armUnlockListeners() {
  if (unlockListenersActive || typeof document === 'undefined') {
    return;
  }

  document.addEventListener('pointerdown', handleUnlockGesture);
  document.addEventListener('touchend', handleUnlockGesture);
  document.addEventListener('keydown', handleUnlockGesture);
  unlockListenersActive = true;
}

function handleUnlockGesture() {
  const context = ensureAudioContext();

  if (!context) {
    removeUnlockListeners();
    return;
  }

  if (isRunning(context)) {
    removeUnlockListeners();
    return;
  }

  /*
   * Auf iOS reicht `resume()` allein nicht zuverlässig: erst ein tatsächlich
   * gestarteter - hier stummer - Puffer innerhalb der Geste macht den Kontext
   * dauerhaft spielbereit.
   */
  try {
    const buffer = context.createBuffer(1, 1, context.sampleRate);
    const source = context.createBufferSource();

    source.buffer = buffer;
    source.connect(context.destination);
    source.start(0);
  } catch {
    // Egal - entscheidend ist der resume() darunter.
  }

  void context
    .resume()
    .then(() => {
      if (isRunning(context)) {
        removeUnlockListeners();
      }
    })
    .catch(() => undefined);
}

/**
 * Macht den Ton spielbereit, solange noch eine Nutzergeste läuft.
 *
 * Ohne das bliebe der erste Signalton stumm: Browser starten einen
 * `AudioContext` gesperrt und geben ihn nur innerhalb einer Geste frei - der
 * Ablauf eines Timers ist aber keine. Der Aufruf ist billig und idempotent;
 * die Listener räumen sich selbst ab, sobald der Kontext läuft.
 */
export function primeTimerSound() {
  const context = ensureAudioContext();

  if (!context) {
    return;
  }

  if (isRunning(context)) {
    removeUnlockListeners();
    return;
  }

  handleUnlockGesture();

  if (isRunning(context)) {
    return;
  }

  // Der Aufruf kam offenbar nicht aus einer Geste heraus (etwa nach einem
  // `await`) - dann übernimmt die nächste Berührung.
  armUnlockListeners();
}

/**
 * Spielt das Ablaufsignal und weckt den Kontext, falls er eingeschlafen ist.
 *
 * Bleibt still statt zu werfen, wenn Web Audio fehlt: ein Timer, der wegen des
 * Tons in einen Fehler läuft, wäre der schlechtere Tausch. Auf einem
 * stummgeschalteten iPhone spielt WebKit ohnehin nichts ab - deshalb bleibt die
 * Vibration das eigentliche Signal, wo es sie gibt.
 */
export function playTimerChime() {
  const context = ensureAudioContext();

  if (!context) {
    return;
  }

  if (isRunning(context)) {
    playChimeTones(context);
    return;
  }

  /*
   * Eingeschlafen - dann erst wecken und dann spielen, statt wie früher still
   * aufzugeben. Die Frist verhindert das Gegenteil des Fehlers: hängt das
   * `resume()` an der nächsten Berührung, kommt der Ton womöglich Minuten
   * später, und dann soll er gar nicht mehr kommen.
   */
  const requestedAt = Date.now();

  armUnlockListeners();

  void context
    .resume()
    .then(() => {
      if (isRunning(context) && Date.now() - requestedAt <= RESUME_GRACE_MS) {
        playChimeTones(context);
      }
    })
    .catch(() => undefined);
}

function playChimeTones(context: AudioContext) {
  try {
    const startedAt = context.currentTime;

    for (const tone of CHIME_TONES) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const toneStart = startedAt + tone.offsetSeconds;
      const toneEnd = toneStart + tone.durationSeconds;

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(tone.frequency, toneStart);

      /*
       * Hüllkurve statt hartem Ein/Aus: ein abrupt geschalteter Oszillator
       * knackt hörbar.
       */
      gain.gain.setValueAtTime(0.0001, toneStart);
      gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, toneStart + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, toneEnd);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(toneStart);
      oscillator.stop(toneEnd + 0.02);
    }
  } catch {
    // Siehe oben: Audio ist Beiwerk.
  }
}

/**
 * Probe aus einer Nutzergeste heraus.
 *
 * Anders als [playTimerChime] darf sie den Kontext selbst freischalten und auf
 * das Ergebnis warten - beim ersten Antippen läuft er sonst noch nicht, und
 * genau die Probe soll zeigen, dass der Ton funktioniert.
 */
export async function playTimerChimeFromGesture() {
  const context = ensureAudioContext();

  if (!context) {
    return;
  }

  primeTimerSound();

  if (!isRunning(context)) {
    try {
      await context.resume();
    } catch {
      return;
    }
  }

  playTimerChime();
}

/**
 * Ob ein abgelaufener Timer noch einen Ton wert ist.
 *
 * Im Hintergrund tickt keine Uhr: liegt die App eine Viertelstunde im
 * App-Switcher, fällt der Ablauf erst beim Zurückwechseln auf. Ein Ton wäre
 * dort kein Hinweis mehr, sondern ein Schreck. Die Vibration ist davon nicht
 * betroffen - sie meldet auch nachträglich nur, dass die Pause vorbei ist.
 */
export function isChimeFresh(expiredAt: number, now: number) {
  return now - expiredAt <= CHIME_MAX_DELAY_MS;
}
