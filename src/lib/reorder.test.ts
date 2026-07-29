import { describe, expect, it } from 'vitest';
import { moveItem } from '@/lib/reorder';

describe('moveItem', () => {
  it('verschiebt einen Eintrag nach oben und nach unten', () => {
    expect(moveItem(['a', 'b', 'c'], 1, 0)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 1, 2)).toEqual(['a', 'c', 'b']);
  });

  it('gibt bei Zielen außerhalb der Liste dieselbe Referenz zurück', () => {
    const items = ['a', 'b', 'c'];

    // Genau der Fall am Listenrand: der Pfeil ist dort deaktiviert, aber die
    // Funktion darf auch dann nichts kaputt machen.
    expect(moveItem(items, 0, -1)).toBe(items);
    expect(moveItem(items, 2, 3)).toBe(items);
    expect(moveItem(items, -1, 0)).toBe(items);
    expect(moveItem(items, 1, 1)).toBe(items);
  });

  it('lässt die Eingabe unverändert', () => {
    const items = ['a', 'b', 'c'];
    moveItem(items, 0, 2);

    expect(items).toEqual(['a', 'b', 'c']);
  });
});
