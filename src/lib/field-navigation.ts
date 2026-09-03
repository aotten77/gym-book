/**
 * Von einem Feld ins nächste, ohne die Tastatur zu schließen.
 *
 * Auf dem Zielgerät gibt es dafür sonst nichts: die Wertefelder tragen
 * `inputMode="numeric"` bzw. `"decimal"`, und der Zahlenblock von iOS hat gar
 * keine Return-Taste - `enterKeyHint` allein löst dort also nie etwas aus. Und
 * die Formularleiste mit den ‹ ›-Pfeilen, die Safari über der Tastatur
 * einblendet, fehlt in einer vom Homescreen gestarteten App. Also bauen wir sie
 * selbst, und die Regel dafür steht hier statt zweimal im Code: die Leiste im
 * Sheet-Fuß braucht sie, und die Return-Taste einer Hardware-Tastatur auch.
 *
 * Wie [edge-widget.ts] entscheidet dieses Modul und die Komponente misst - nur
 * ist die Messung hier der Fokus selbst, der im DOM steht und nirgends sonst.
 */

/**
 * Die Felder, zwischen denen navigiert wird - in DOM-Reihenfolge.
 *
 * Nur was eine Eingabe entgegennimmt. Kästchen und Schalter fallen bewusst raus:
 * sie brauchen keine Tastatur, und eine Leiste, die über der Tastatur zu einem
 * Ziel springt, das sie schließt, wäre eine Sackgasse.
 */
const EXCLUDED_INPUT_TYPES = ['hidden', 'button', 'submit', 'reset', 'checkbox', 'radio'];

const NAVIGABLE_SELECTOR = [
  `input${EXCLUDED_INPUT_TYPES.map((type) => `:not([type="${type}"])`).join('')}`,
  'select',
  'textarea',
].join(',');

export type NavigableField = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** Ob dieses Element in der Kette vorkommt - für den Fokuswechsel im Sheet. */
export function isNavigableField(element: Element | null): element is NavigableField {
  if (!element) {
    return false;
  }

  return element.matches(NAVIGABLE_SELECTOR) && !isUnreachable(element);
}

/*
 * Kein `offsetParent`-Test: jsdom kennt kein Layout und meldete damit *jedes*
 * Feld als unsichtbar. Die App blendet Felder ohnehin nicht aus, sie hängt sie
 * aus dem Baum - übrig bleiben die beiden Fälle, die man im Markup wirklich
 * findet.
 */
function isUnreachable(element: Element): boolean {
  return element.matches('[disabled]') || element.closest('[hidden]') !== null;
}

/** Alle navigierbaren Felder unterhalb von `root`, in DOM-Reihenfolge. */
export function collectNavigableFields(root: HTMLElement | null): NavigableField[] {
  if (!root) {
    return [];
  }

  return Array.from(root.querySelectorAll<NavigableField>(NAVIGABLE_SELECTOR)).filter(
    (field) => !isUnreachable(field),
  );
}

/** Position eines Feldes in der Kette, `-1` wenn es nicht dazugehört. */
export function findFieldIndex(fields: NavigableField[], element: Element | null): number {
  if (!element) {
    return -1;
  }

  return fields.findIndex((field) => field === element);
}

/**
 * Setzt den Fokus auf das nächste (`1`) oder vorige (`-1`) Feld.
 *
 * Liefert `false`, wenn es in dieser Richtung keines gibt - am Anschlag wird
 * nicht umgebrochen, wie in Safaris eigener Leiste. `block: 'nearest'` statt
 * `'center'`: iOS scrollt ein fokussiertes Feld selbst über die Tastatur, und
 * zwei Scrolls übereinander ruckeln.
 */
export function moveFieldFocus(root: HTMLElement | null, direction: 1 | -1): boolean {
  if (!root) {
    return false;
  }

  const fields = collectNavigableFields(root);
  const current = findFieldIndex(fields, root.ownerDocument.activeElement);
  const next = fields[current + direction];

  if (current === -1 || !next) {
    return false;
  }

  next.focus();
  next.scrollIntoView({ block: 'nearest' });

  return true;
}
