/**
 * Gesprochene Zwischenansagen für Sätze auf Zeit.
 *
 * Geschwister von [sound.ts] und mit derselben Haltung gebaut: wirft nie,
 * schweigt, wo es nicht geht - eine Ansage, an der ein Timer scheitert, wäre
 * der schlechtere Tausch.
 *
 * Anders als beim Chime ist Sprache hier nicht die Ergänzung, sondern der
 * eigentliche Kanal: Safari auf iOS kennt die Vibration API nicht, das Muster
 * daneben erreicht also nur Android und den Schreibtisch. Was das Gerät mit dem
 * Klingelschalter macht, ist offen und lässt sich nur dort klären.
 */

/** Einmal pro Seitenlauf freigeschaltet - siehe [primeTimerSpeech]. */
let primed = false;

/** Eine Ansage, die noch auf ihren Versatz wartet - siehe [speakTimerAnnouncement]. */
let pendingAnnouncement: ReturnType<typeof setTimeout> | null = null;

type SpeechWindow = Window &
  typeof globalThis & {
    speechSynthesis?: SpeechSynthesis;
    SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
  };

/**
 * Gibt es die API überhaupt?
 *
 * Beide Hälften werden geprüft: es gibt Stände und Testdoppel, die nur den
 * Sprachdienst mitbringen, aber keinen Konstruktor für die Äußerung.
 */
export function isTimerSpeechSupported() {
  if (typeof window === 'undefined') {
    return false;
  }

  const candidate = window as SpeechWindow;

  return Boolean(candidate.speechSynthesis) && typeof candidate.SpeechSynthesisUtterance === 'function';
}

function createUtterance(text: string) {
  const candidate = window as SpeechWindow;
  const Utterance = candidate.SpeechSynthesisUtterance;

  if (!Utterance) {
    return null;
  }

  const utterance = new Utterance(text);

  /*
   * Nur die Sprache wird gesetzt, keine Stimme: `getVoices()` ist in WebKit
   * beim ersten Aufruf leer und füllt sich erst mit `voiceschanged`. Eine
   * benannte Stimme brächte nichts und schüfe einen Fehlerfall - ist sie nicht
   * installiert, schweigen manche Dienste ganz, statt auf die Vorgabe
   * zurückzufallen.
   */
  utterance.lang = 'de-DE';
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.volume = 1;

  return utterance;
}

/**
 * Macht die Sprachausgabe spielbereit, solange noch eine Geste läuft.
 *
 * Anders als beim `AudioContext` gibt es hier keine dokumentierte Sperre, die
 * eine Geste verlangt - es gibt aber Berichte, dass die erste Äußerung eines
 * Seitenlaufs verschluckt wird, während die Stimmen noch laden. Eine stumme
 * Äußerung vorweg kostet nichts und räumt das aus.
 *
 * Listener wie in [primeTimerSound] braucht es nicht: der Satz-Timer startet
 * nur auf einen Tipp, es gibt also Sekunden vor jeder Ansage eine frische
 * Geste. Einmal pro Seitenlauf, weil auch eine Äußerung ohne Lautstärke die
 * Audiositzung von iOS kurz öffnen und laufende Musik ducken kann.
 */
export function primeTimerSpeech() {
  if (primed || !isTimerSpeechSupported()) {
    return;
  }

  primed = true;

  try {
    const utterance = createUtterance(' ');

    if (!utterance) {
      return;
    }

    utterance.volume = 0;
    (window as SpeechWindow).speechSynthesis?.speak(utterance);
  } catch {
    // Siehe oben: die Ansage ist Beiwerk, der Timer läuft auch ohne sie.
  }
}

/**
 * Sagt einen Satz an, sofern das Gerät sprechen kann.
 *
 * Vor jeder Äußerung wird abgebrochen: die Warteschlange ist global und
 * überlebt jeden Seitenwechsel, und WebKit lässt sie nach einem Aufenthalt im
 * Hintergrund gelegentlich hängen. Eine wartende Ansage käme dann Minuten zu
 * spät - genau das Versagen, das diese Funktion nicht haben darf. Etwas anderes
 * spricht in dieser App nicht, es geht also nie eine echte Ansage verloren.
 */
function speakNow(text: string) {
  if (!isTimerSpeechSupported()) {
    return;
  }

  try {
    const synth = (window as SpeechWindow).speechSynthesis;
    const utterance = createUtterance(text);

    if (!synth || !utterance) {
      return;
    }

    synth.cancel();
    synth.speak(utterance);
  } catch {
    // Siehe oben.
  }
}

/**
 * Sagt einen Satz an, auf Wunsch erst nach einer Wartezeit.
 *
 * *Ob* und *wie lange* gewartet wird, entscheidet
 * [decideTimerNotifications](@/domain/timer-notifications) - hier wird nur
 * ausgeführt. Der Versatz liegt in diesem Modul und nicht im Effekt der
 * `SessionPage`: der läuft im Sekundentakt neu, und ein Aufräumen beim
 * Neulauf schnitte die wartende Ansage ab, bevor sie fällig wird.
 *
 * Eine noch wartende Ansage wird von der nächsten abgeräumt - dieselbe Haltung
 * wie das `cancel()` darunter: es gilt, was gerade ansteht, nicht was einmal
 * anstand.
 */
export function speakTimerAnnouncement(text: string, delayMs = 0) {
  if (pendingAnnouncement !== null) {
    clearTimeout(pendingAnnouncement);
    pendingAnnouncement = null;
  }

  if (delayMs <= 0) {
    speakNow(text);
    return;
  }

  pendingAnnouncement = setTimeout(() => {
    pendingAnnouncement = null;
    speakNow(text);
  }, delayMs);
}

/**
 * Probe aus einer Nutzergeste heraus, wie [playTimerChimeFromGesture].
 *
 * Sie darf freischalten - beim ersten Antippen ist die Sprachausgabe sonst
 * womöglich noch nicht bereit, und genau das soll die Probe zeigen. Anders als
 * beim Chime ist nichts abzuwarten: es gibt keinen Kontext, der erst wieder
 * anlaufen müsste. Die stumme Äußerung des Freischaltens räumt das `cancel()`
 * darunter gleich wieder weg.
 */
export function speakTimerAnnouncementFromGesture(text: string) {
  primeTimerSpeech();
  speakTimerAnnouncement(text);
}
