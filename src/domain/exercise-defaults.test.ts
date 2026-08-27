import { describe, expect, it } from 'vitest';
import { prefillTargetReps } from '@/domain/exercise-defaults';

describe('prefillTargetReps', () => {
  it('setzt die Empfehlung der Übung in ein leeres Feld', () => {
    expect(prefillTargetReps('', { trackingMode: 'reps_weight', defaultTargetReps: 10 })).toBe('10');
  });

  it('lässt eine bestehende Eingabe stehen - sie ist bereits eine Entscheidung', () => {
    expect(prefillTargetReps('5', { trackingMode: 'reps_weight', defaultTargetReps: 10 })).toBe('5');
  });

  it('lässt das Feld leer, wenn die Übung keine Empfehlung trägt', () => {
    expect(prefillTargetReps('', { trackingMode: 'reps_weight' })).toBe('');
  });

  it('schreibt keine Wiederholungen an eine Zeitübung', () => {
    expect(prefillTargetReps('', { trackingMode: 'time', defaultTargetReps: 10 })).toBe('');
  });

  it('kommt ohne gewählte Übung aus', () => {
    expect(prefillTargetReps('')).toBe('');
  });
});
