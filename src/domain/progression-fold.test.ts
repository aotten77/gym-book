import { describe, expect, it } from 'vitest';
import type { ProgressionRule, WorkoutTemplateExercise } from '@/domain/models';
import { foldProgressionRule, overriddenTargetFields } from '@/domain/progression-fold';

const templateExercise: WorkoutTemplateExercise = {
  id: 'te-1',
  templateId: 'tpl-1',
  exerciseId: 'ex-1',
  orderIndex: 1,
  workSetCount: 3,
  targetReps: 8,
  targetWeight: 60,
  targetHeightCm: 20,
  restSeconds: 120,
  notes: 'Basis-Notiz',
};

function rule(overrides: Partial<ProgressionRule> = {}): ProgressionRule {
  return {
    id: 'rule-1',
    templateExerciseId: 'te-1',
    programWeekId: 'week-3',
    ...overrides,
  };
}

describe('foldProgressionRule', () => {
  it('nimmt ohne Regel die Basiswerte unverändert', () => {
    expect(foldProgressionRule(templateExercise)).toEqual({
      workSetCount: 3,
      targetReps: 8,
      targetRepsMax: undefined,
      targetSeconds: undefined,
      targetWeight: 60,
      targetBandId: undefined,
      targetHeightCm: 20,
      notes: 'Basis-Notiz',
    });
  });

  it('überschreibt feldweise und lässt die übrigen Ziele stehen', () => {
    const folded = foldProgressionRule(templateExercise, rule({ targetWeight: 85 }));

    expect(folded.targetWeight).toBe(85);
    expect(folded.targetReps).toBe(8);
    expect(folded.targetHeightCm).toBe(20);
    expect(folded.notes).toBe('Basis-Notiz');
  });

  it('löscht mit einer Regel, die nur eine Notiz trägt, kein einziges Ziel', () => {
    // Der Fehler, den diese Zeile verhindert: die Regel als Ganzes über die
    // Basiswerte zu legen. `undefined` heißt "nichts vorgegeben", nie "weg".
    const folded = foldProgressionRule(templateExercise, rule({ notes: 'Deload, ruhig bleiben' }));

    expect(folded.notes).toBe('Deload, ruhig bleiben');
    expect(folded.targetReps).toBe(8);
    expect(folded.targetWeight).toBe(60);
    expect(folded.targetHeightCm).toBe(20);
  });

  it('lässt die Decke stehen, wenn die Woche nur den unteren Rand anhebt', () => {
    const folded = foldProgressionRule(
      { ...templateExercise, targetRepsMax: 10 },
      rule({ targetReps: 9 }),
    );

    expect(folded.targetReps).toBe(9);
    expect(folded.targetRepsMax).toBe(10);
  });

  it('nimmt eine eigene Decke aus der Regel', () => {
    const folded = foldProgressionRule(
      { ...templateExercise, targetRepsMax: 10 },
      rule({ targetRepsMax: 12 }),
    );

    expect(folded.targetRepsMax).toBe(12);
    expect(folded.targetReps).toBe(8);
  });

  it('nimmt die Satzzahl aus der Regel - so wird eine Deload-Woche ausdrückbar', () => {
    const folded = foldProgressionRule(templateExercise, rule({ workSetCount: 2 }));

    expect(folded.workSetCount).toBe(2);
    // Die Last bleibt: reduziert wird hier der Umfang, nicht das Gewicht.
    expect(folded.targetWeight).toBe(60);
  });

  it('setzt auch Sekunden und Band aus der Regel', () => {
    const folded = foldProgressionRule(
      { ...templateExercise, targetSeconds: 12, targetBandId: 'band-gelb' },
      rule({ targetSeconds: 16, targetBandId: 'band-gruen' }),
    );

    expect(folded.targetSeconds).toBe(16);
    expect(folded.targetBandId).toBe('band-gruen');
  });

  it('lässt eine 0 aus der Regel gelten - nur undefined fällt zurück', () => {
    const folded = foldProgressionRule(templateExercise, rule({ targetWeight: 0 }));

    expect(folded.targetWeight).toBe(0);
  });
});

describe('overriddenTargetFields', () => {
  it('meldet ohne Regel nichts', () => {
    expect(overriddenTargetFields()).toEqual([]);
  });

  it('meldet genau die Felder, die die Regel gesetzt hat', () => {
    expect(overriddenTargetFields(rule({ targetWeight: 85, targetReps: 5 }))).toEqual([
      'targetReps',
      'targetWeight',
    ]);
  });

  it('meldet ein Feld auch dann, wenn es dem Basiswert entspricht', () => {
    // Die Markierung sagt "kommt aus der Woche", nicht "ist anders". Sonst
    // spränge sie um, sobald jemand den Basiswert auf denselben Wert stellt.
    expect(overriddenTargetFields(rule({ targetWeight: 60 }))).toEqual(['targetWeight']);
  });

  it('zählt eine reine Notiz-Regel mit', () => {
    expect(overriddenTargetFields(rule({ notes: 'Deload' }))).toEqual(['notes']);
  });
});
