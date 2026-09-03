import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  collectNavigableFields,
  findFieldIndex,
  isNavigableField,
  moveFieldFocus,
} from '@/lib/field-navigation';

// jsdom kennt kein Layout und bringt `scrollIntoView` deshalb nicht mit.
Element.prototype.scrollIntoView = vi.fn();

function render(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);

  return root;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('collectNavigableFields', () => {
  it('liefert Eingabefelder in DOM-Reihenfolge', () => {
    const root = render(`
      <input id="reps" />
      <input id="weight" />
      <select id="band"></select>
      <textarea id="notes"></textarea>
    `);

    expect(collectNavigableFields(root).map((field) => field.id)).toEqual([
      'reps',
      'weight',
      'band',
      'notes',
    ]);
  });

  it('lässt Knöpfe, Kästchen und gesperrte Felder aus', () => {
    const root = render(`
      <button id="minus">-</button>
      <input id="reps" />
      <input id="check" type="checkbox" />
      <input id="submit" type="submit" />
      <input id="locked" disabled />
      <input id="weight" />
    `);

    expect(collectNavigableFields(root).map((field) => field.id)).toEqual(['reps', 'weight']);
  });

  it('überspringt Felder unter einem versteckten Zweig', () => {
    const root = render(`
      <input id="reps" />
      <div hidden><input id="weight" /></div>
    `);

    expect(collectNavigableFields(root).map((field) => field.id)).toEqual(['reps']);
  });

  it('bleibt bei fehlendem Wurzelelement leer', () => {
    expect(collectNavigableFields(null)).toEqual([]);
  });
});

describe('isNavigableField', () => {
  it('erkennt ein Eingabefeld und lehnt Knopf, gesperrtes Feld und null ab', () => {
    const root = render(`
      <input id="reps" />
      <input id="locked" disabled />
      <button id="minus">-</button>
    `);

    expect(isNavigableField(root.querySelector('#reps'))).toBe(true);
    expect(isNavigableField(root.querySelector('#locked'))).toBe(false);
    expect(isNavigableField(root.querySelector('#minus'))).toBe(false);
    expect(isNavigableField(null)).toBe(false);
  });
});

describe('findFieldIndex', () => {
  it('findet die Position und meldet -1 für Fremdelemente', () => {
    const root = render('<input id="reps" /><input id="weight" />');
    const fields = collectNavigableFields(root);

    expect(findFieldIndex(fields, root.querySelector('#weight'))).toBe(1);
    expect(findFieldIndex(fields, root.querySelector('input') && document.body)).toBe(-1);
    expect(findFieldIndex(fields, null)).toBe(-1);
  });
});

describe('moveFieldFocus', () => {
  it('springt vorwärts und rückwärts durch die Kette', () => {
    const root = render('<input id="reps" /><input id="weight" /><select id="band"></select>');
    root.querySelector<HTMLInputElement>('#reps')?.focus();

    expect(moveFieldFocus(root, 1)).toBe(true);
    expect(document.activeElement?.id).toBe('weight');

    expect(moveFieldFocus(root, 1)).toBe(true);
    expect(document.activeElement?.id).toBe('band');

    expect(moveFieldFocus(root, -1)).toBe(true);
    expect(document.activeElement?.id).toBe('weight');
  });

  it('bricht am Anschlag nicht um', () => {
    const root = render('<input id="reps" /><input id="weight" />');
    root.querySelector<HTMLInputElement>('#reps')?.focus();

    expect(moveFieldFocus(root, -1)).toBe(false);
    expect(document.activeElement?.id).toBe('reps');

    root.querySelector<HTMLInputElement>('#weight')?.focus();

    expect(moveFieldFocus(root, 1)).toBe(false);
    expect(document.activeElement?.id).toBe('weight');
  });

  it('überspringt ein gesperrtes Feld zwischen zwei offenen', () => {
    const root = render('<input id="reps" /><input id="locked" disabled /><input id="weight" />');
    root.querySelector<HTMLInputElement>('#reps')?.focus();

    expect(moveFieldFocus(root, 1)).toBe(true);
    expect(document.activeElement?.id).toBe('weight');
  });

  it('tut nichts, wenn der Fokus außerhalb der Kette steht', () => {
    const root = render('<input id="reps" /><button id="minus">-</button>');
    root.querySelector<HTMLButtonElement>('#minus')?.focus();

    expect(moveFieldFocus(root, 1)).toBe(false);
    expect(document.activeElement?.id).toBe('minus');
  });
});
