/**
 * Welcher Stand gerade läuft.
 *
 * Eine installierte PWA sieht nach einem Update genauso aus wie davor, und die
 * meisten Änderungen - eine Regel im Timer, ein Feld im Export - erkennt man
 * nicht auf den ersten Blick. Ob ein Update tatsächlich angekommen ist, ließ
 * sich deshalb nur raten. Das hier beantwortet es: Vite schreibt beim Build den
 * Commit ins Bundle (siehe `define` in vite.config.ts), und die
 * Einstellungsseite zeigt, was *dieses* Bundle ist - nicht, was zuletzt
 * deployt wurde. Genau das ist die Frage, wenn der Service Worker hängt.
 */

export interface BuildInfo {
  /** Voller Commit-Hash, oder `null`, wenn beim Build kein Git erreichbar war. */
  commit: string | null;
  /** Erste Zeile der Commit-Nachricht - der lesbare Teil der Version. */
  subject: string | null;
  /** Zeitpunkt des Commits als ISO-String. */
  committedAt: string | null;
  /** Zeitpunkt des Builds als ISO-String. */
  builtAt: string;
  /** Lokal gebaut mit nicht committeten Änderungen - im Deploy immer `false`. */
  dirty: boolean;
}

/*
 * Wird von Vite textuell ersetzt. In vitest gibt es kein `define`, dort ist der
 * Bezeichner gar nicht deklariert - `typeof` ist die eine Form, die das ohne
 * ReferenceError übersteht.
 */
declare const __BUILD_INFO__: BuildInfo | undefined;

export function readBuildInfo(): BuildInfo | null {
  return typeof __BUILD_INFO__ === 'undefined' ? null : __BUILD_INFO__;
}

/** Die sieben Zeichen, unter denen `git log --oneline` einen Commit nennt. */
export const SHORT_COMMIT_LENGTH = 7;

/**
 * Der Kurz-Hash, wie man ihn neben `git log --oneline` wiedererkennt.
 *
 * Ein lokaler Build mit offenen Änderungen bekommt ein `+` - sonst stünde dort
 * ein Commit, der den laufenden Code gar nicht vollständig beschreibt.
 */
export function formatBuildVersion(info: BuildInfo | null): string {
  if (!info?.commit) {
    return 'unbekannt';
  }

  return `${info.commit.slice(0, SHORT_COMMIT_LENGTH)}${info.dirty ? '+' : ''}`;
}
