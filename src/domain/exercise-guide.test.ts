import { describe, expect, it } from 'vitest';
import { buildExerciseGuide } from '@/domain/exercise-guide';

describe('buildExerciseGuide', () => {
  it('liest die Anleitung als Markdown-Blöcke', () => {
    const guide = buildExerciseGuide({
      instructions: '- Ferse bleibt am Boden\r\n- Knie über den Zeh',
    });

    expect(guide?.blocks).toEqual([
      {
        kind: 'list',
        ordered: false,
        start: 1,
        items: [[{ text: 'Ferse bleibt am Boden' }], [{ text: 'Knie über den Zeh' }]],
      },
    ]);
    expect(guide?.teaser).toBe('Ferse bleibt am Boden');
  });

  it('lässt Fließtext einen Absatz - "ca. 90 Grad" ist keine zweite Regel', () => {
    const guide = buildExerciseGuide({
      instructions: 'Knie ca. 90 Grad. Fuß nah am Körper.',
    });

    expect(guide?.blocks).toEqual([
      { kind: 'paragraph', lines: [[{ text: 'Knie ca. 90 Grad. Fuß nah am Körper.' }]] },
    ]);
    expect(guide?.teaser).toBe('Knie ca. 90 Grad. Fuß nah am Körper.');
  });

  it('überspringt Überschriften und nimmt den ersten Listenpunkt als Teaser', () => {
    const guide = buildExerciseGuide({
      instructions: '### Ausführung\n- Ellbogen **hoch** halten\n- Sauber tief',
    });

    expect(guide?.teaser).toBe('Ellbogen hoch halten');
  });

  it('nimmt die erste Absatzzeile ohne Auszeichnung als Teaser', () => {
    const guide = buildExerciseGuide({
      instructions: 'Langsam absenken, **kein Schwung**\nOben halten',
    });

    expect(guide?.teaser).toBe('Langsam absenken, kein Schwung');
  });

  it('trägt Tempo und Workout-Notiz getrimmt mit', () => {
    const guide = buildExerciseGuide({
      instructions: 'Ellbogen hoch',
      tempo: ' 3-1-1 ',
      notes: ' RPE 7-8 ',
    });

    expect(guide).toEqual({
      blocks: [{ kind: 'paragraph', lines: [[{ text: 'Ellbogen hoch' }]] }],
      tempo: '3-1-1',
      notes: 'RPE 7-8',
      teaser: 'Ellbogen hoch',
    });
  });

  it('lässt ohne Anleitung erst die Notiz, dann das Tempo nachrücken', () => {
    expect(buildExerciseGuide({ notes: 'Direkt nach dem Couch Stretch', tempo: '2-0-2' })?.teaser).toBe(
      'Direkt nach dem Couch Stretch',
    );
    expect(buildExerciseGuide({ tempo: '2-0-2' })?.teaser).toBe('Tempo 2-0-2');
  });

  it('fällt bei einer Anleitung nur aus Überschrift auf Notiz, sonst die Überschrift zurück', () => {
    expect(buildExerciseGuide({ instructions: '### Achtung', notes: 'RPE 7' })?.teaser).toBe('RPE 7');

    const headingOnly = buildExerciseGuide({ instructions: '### Achtung' });

    expect(headingOnly).not.toBeNull();
    expect(headingOnly?.teaser).toBe('Achtung');
  });

  it('liefert null, wenn es nichts zu sagen gibt', () => {
    expect(buildExerciseGuide({})).toBeNull();
    expect(buildExerciseGuide({ instructions: ' \n ', tempo: ' ', notes: '' })).toBeNull();
  });
});
