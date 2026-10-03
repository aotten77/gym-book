import { describe, expect, it } from 'vitest';
import { parseMarkdownLite, toPlainText } from '@/lib/markdown-lite';

describe('parseMarkdownLite', () => {
  it('lässt einzeiligen Fließtext genau einen Absatz sein', () => {
    expect(parseMarkdownLite('Knie ca. 90 Grad. Fuß nah am Körper.')).toEqual([
      { kind: 'paragraph', lines: [[{ text: 'Knie ca. 90 Grad. Fuß nah am Körper.' }]] },
    ]);
  });

  it('hält einen einfachen Zeilenumbruch als zweite Zeile desselben Absatzes', () => {
    expect(parseMarkdownLite('Erste Zeile\nZweite Zeile')).toEqual([
      { kind: 'paragraph', lines: [[{ text: 'Erste Zeile' }], [{ text: 'Zweite Zeile' }]] },
    ]);
  });

  it('trennt Absätze an Leerzeilen, auch an mehreren', () => {
    expect(parseMarkdownLite('Absatz eins\n\n\nAbsatz zwei')).toEqual([
      { kind: 'paragraph', lines: [[{ text: 'Absatz eins' }]] },
      { kind: 'paragraph', lines: [[{ text: 'Absatz zwei' }]] },
    ]);
  });

  it('liest CRLF wie LF', () => {
    expect(parseMarkdownLite('a\r\nb')).toEqual([
      { kind: 'paragraph', lines: [[{ text: 'a' }], [{ text: 'b' }]] },
    ]);
  });

  it('erkennt ungeordnete Listen mit - und *', () => {
    expect(parseMarkdownLite('- eins\n* zwei')).toEqual([
      { kind: 'list', ordered: false, start: 1, items: [[{ text: 'eins' }], [{ text: 'zwei' }]] },
    ]);
  });

  it('erkennt nummerierte Listen und behält die Startzahl', () => {
    expect(parseMarkdownLite('3. drei\n4. vier')).toEqual([
      { kind: 'list', ordered: true, start: 3, items: [[{ text: 'drei' }], [{ text: 'vier' }]] },
    ]);
  });

  it('erkennt Überschriften der Ebenen eins bis drei gleich', () => {
    for (const source of ['# A', '## A', '### A']) {
      expect(parseMarkdownLite(source)).toEqual([{ kind: 'heading', content: [{ text: 'A' }] }]);
    }
  });

  it('lässt ###A und #### A wörtlich stehen', () => {
    expect(parseMarkdownLite('###A')).toEqual([{ kind: 'paragraph', lines: [[{ text: '###A' }]] }]);
    expect(parseMarkdownLite('#### A')).toEqual([
      { kind: 'paragraph', lines: [[{ text: '#### A' }]] },
    ]);
  });

  it('beendet eine Liste, wenn eine Zeile ohne Marker folgt', () => {
    expect(parseMarkdownLite('- eins\nText danach')).toEqual([
      { kind: 'list', ordered: false, start: 1, items: [[{ text: 'eins' }]] },
      { kind: 'paragraph', lines: [[{ text: 'Text danach' }]] },
    ]);
  });

  it('beendet einen Absatz an einer Überschrift und umgekehrt', () => {
    expect(parseMarkdownLite('### Steigerung\nStart 10 kg')).toEqual([
      { kind: 'heading', content: [{ text: 'Steigerung' }] },
      { kind: 'paragraph', lines: [[{ text: 'Start 10 kg' }]] },
    ]);
  });

  it('erkennt Fett im Listenpunkt', () => {
    expect(parseMarkdownLite('- Ellbogen **hoch** halten')).toEqual([
      {
        kind: 'list',
        ordered: false,
        start: 1,
        items: [[{ text: 'Ellbogen ' }, { text: 'hoch', strong: true }, { text: ' halten' }]],
      },
    ]);
  });

  it('erkennt Kursiv mit * und _', () => {
    expect(parseMarkdownLite('*kursiv* und _auch_')).toEqual([
      {
        kind: 'paragraph',
        lines: [
          [{ text: 'kursiv', emphasis: true }, { text: ' und ' }, { text: 'auch', emphasis: true }],
        ],
      },
    ]);
  });

  it('verschachtelt Kursiv in Fett', () => {
    expect(parseMarkdownLite('**fett *beides* fett**')).toEqual([
      {
        kind: 'paragraph',
        lines: [
          [
            { text: 'fett ', strong: true },
            { text: 'beides', strong: true, emphasis: true },
            { text: ' fett', strong: true },
          ],
        ],
      },
    ]);
  });

  it.each([
    'nur **offen',
    '3 * 5 * 2',
    'Kurzhantel_rechts_unten',
    '** fett **',
    '<b>x</b>',
    '[Link](http://x)',
    '-ohne Leerzeichen',
  ])('lässt %j wörtlich stehen', (source) => {
    expect(parseMarkdownLite(source)).toEqual([
      { kind: 'paragraph', lines: [[{ text: source }]] },
    ]);
  });

  it('liefert für leeren Text keine Blöcke', () => {
    expect(parseMarkdownLite('')).toEqual([]);
    expect(parseMarkdownLite(' \n \n')).toEqual([]);
  });
});

describe('toPlainText', () => {
  it('entfernt die Auszeichnung', () => {
    expect(
      toPlainText([{ text: 'Ellbogen ' }, { text: 'hoch', strong: true }, { text: ' halten' }]),
    ).toBe('Ellbogen hoch halten');
  });
});
