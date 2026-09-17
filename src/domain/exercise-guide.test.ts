import { describe, expect, it } from 'vitest';
import { buildExerciseGuide } from '@/domain/exercise-guide';

describe('buildExerciseGuide', () => {
  it('zerlegt eine Anleitung an Zeilenumbrüchen und lässt leere Zeilen weg', () => {
    const guide = buildExerciseGuide({
      instructions: '  Ferse bleibt am Boden\r\n\nKnie über den Zeh\n  ',
    });

    expect(guide?.lines).toEqual(['Ferse bleibt am Boden', 'Knie über den Zeh']);
    expect(guide?.teaser).toBe('Ferse bleibt am Boden');
  });

  it('lässt Fließtext eine Zeile - "ca. 90 Grad" ist keine zweite Regel', () => {
    const guide = buildExerciseGuide({
      instructions: 'Knie ca. 90 Grad. Fuß nah am Körper.',
    });

    expect(guide?.lines).toEqual(['Knie ca. 90 Grad. Fuß nah am Körper.']);
  });

  it('trägt Tempo und Workout-Notiz getrimmt mit', () => {
    const guide = buildExerciseGuide({
      instructions: 'Ellbogen hoch',
      tempo: ' 3-1-1 ',
      notes: ' RPE 7-8 ',
    });

    expect(guide).toEqual({
      lines: ['Ellbogen hoch'],
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

  it('liefert null, wenn es nichts zu sagen gibt', () => {
    expect(buildExerciseGuide({})).toBeNull();
    expect(buildExerciseGuide({ instructions: ' \n ', tempo: ' ', notes: '' })).toBeNull();
  });
});
