import { afterEach, describe, expect, it } from 'vitest';
import { lockBodyScroll } from '@/lib/scroll-lock';

describe('lockBodyScroll', () => {
  afterEach(() => {
    document.body.style.overflow = '';
  });

  it('sperrt und gibt wieder frei', () => {
    const release = lockBodyScroll();
    expect(document.body.style.overflow).toBe('hidden');

    release();
    expect(document.body.style.overflow).toBe('');
  });

  it('gibt erst frei, wenn die letzte Sperre fällt - in beliebiger Reihenfolge', () => {
    const sheet = lockBodyScroll();
    const dialog = lockBodyScroll();

    sheet();
    expect(document.body.style.overflow).toBe('hidden');

    dialog();
    expect(document.body.style.overflow).toBe('');
  });

  it('übersteht ein Neu-Sperren mitten im Stapel', () => {
    // Das Sheet läuft bei jedem Render seiner Seite neu an, während das Modal
    // darüber offen ist: freigeben und neu sperren darf den Ausgangswert
    // nicht durch das "hidden" des Modals ersetzen.
    const sheet = lockBodyScroll();
    const dialog = lockBodyScroll();
    sheet();
    const sheetAgain = lockBodyScroll();

    sheetAgain();
    dialog();
    expect(document.body.style.overflow).toBe('');
  });

  it('stellt einen vorher gesetzten Wert wieder her', () => {
    document.body.style.overflow = 'scroll';
    const release = lockBodyScroll();

    release();
    expect(document.body.style.overflow).toBe('scroll');
  });

  it('zählt eine doppelte Freigabe nur einmal', () => {
    const first = lockBodyScroll();
    const second = lockBodyScroll();

    first();
    first();
    expect(document.body.style.overflow).toBe('hidden');

    second();
    expect(document.body.style.overflow).toBe('');
  });
});
