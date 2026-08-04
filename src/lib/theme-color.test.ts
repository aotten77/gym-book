import { afterEach, describe, expect, it } from 'vitest';
import { APP_THEME_COLOR, applyThemeColor } from '@/lib/theme-color';

afterEach(() => {
  document.head.innerHTML = '';
});

function addMeta(content = APP_THEME_COLOR) {
  const meta = document.createElement('meta');

  meta.name = 'theme-color';
  meta.content = content;
  document.head.append(meta);

  return meta;
}

describe('applyThemeColor', () => {
  it('setzt die Leistenfarbe und stellt die vorherige wieder her', () => {
    const meta = addMeta();

    const restore = applyThemeColor('#0c1210');

    expect(meta.content).toBe('#0c1210');

    restore();

    expect(meta.content).toBe(APP_THEME_COLOR);
  });

  it('stellt den Wert wieder her, der vorher wirklich dastand', () => {
    const meta = addMeta('#123456');

    applyThemeColor('#0c1210')();

    expect(meta.content).toBe('#123456');
  });

  it('ohne Meta-Element passiert nichts - und nichts wirft', () => {
    expect(() => applyThemeColor('#0c1210')()).not.toThrow();
  });
});
