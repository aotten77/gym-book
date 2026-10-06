import { describe, expect, it } from 'vitest';
import type { PlanEntry } from '@/domain/models';
import { PLAN_MESSAGES } from '@/domain/plan';
import {
  parsePaceInput,
  readPlanEntryForm,
  toPlanEntryFormState,
  visiblePlanEntryError,
  type PlanEntryFormField,
  type PlanEntryFormState,
} from '@/domain/plan-entry-form';

const runBase: PlanEntryFormState = {
  ...toPlanEntryFormState(undefined, { date: '2026-10-06', kind: 'run' }),
  title: 'Dauerlauf',
};
const read = (patch: Partial<PlanEntryFormState>) => readPlanEntryForm({ ...runBase, ...patch });

describe('parsePaceInput', () => {
  it('liest m:ss und ganze Minuten', () => {
    expect(parsePaceInput('5:30')).toBe(330);
    expect(parsePaceInput('5')).toBe(300);
    expect(parsePaceInput('')).toBeNull();
    expect(parsePaceInput('5:75')).toBe('invalid');
    expect(parsePaceInput('abc')).toBe('invalid');
  });
});

describe('readPlanEntryForm', () => {
  it('leere Vorgaben werden null', () => {
    const result = read({});

    expect(result.errors).toEqual({});
    expect(result.values).toMatchObject({
      kind: 'run',
      title: 'Dauerlauf',
      targetDistanceKm: null,
      targetDurationSeconds: null,
      targetElevationGainM: null,
      targetAverageHeartRate: null,
      targetPaceSecondsPerKm: null,
    });
  });

  it('Dauer aus Std/Min/Sek', () => {
    expect(read({ hours: '', minutes: '45', seconds: '' }).values?.targetDurationSeconds).toBe(2700);
    expect(read({ minutes: '75' }).errors.minutes).toBe('0–59');
  });

  it('Dauer 0/0/0 ist ein Fehler am Stundenfeld', () => {
    const result = read({ hours: '0', minutes: '0', seconds: '0' });

    expect(result.errors.hours).toBe(PLAN_MESSAGES.duration);
    expect(result.values).toBeUndefined();
  });

  it('Anleitung nur am Lauf', () => {
    const run = read({ instructions: ' - 2 km einlaufen ' });
    const workout = readPlanEntryForm({
      ...runBase,
      kind: 'workout',
      templateId: 'A',
      instructions: '- 2 km einlaufen',
    });

    expect(run.values?.instructions).toBe('- 2 km einlaufen');
    expect(workout.values?.instructions).toBeNull();
  });

  it('Pace ungültig', () => {
    const result = read({ pace: '5:75' });

    expect(result.errors.pace).toBe('Pace bitte als m:ss, z. B. 5:30.');
    expect(result.values).toBeUndefined();
  });

  it('Workout ohne Wahl', () => {
    const result = readPlanEntryForm({ ...runBase, kind: 'workout', templateId: '' });

    expect(result.errors.templateId).toBe(PLAN_MESSAGES.workoutMissing);
  });
});

describe('toPlanEntryFormState', () => {
  it('Umkehrung', () => {
    const entry: PlanEntry = {
      id: 'p1',
      date: '2026-10-06',
      orderInDay: 1,
      kind: 'run',
      title: 'Tempo',
      targetPaceSecondsPerKm: 330,
      targetDistanceKm: 7.5,
      createdAt: '',
      updatedAt: '',
    };
    const state = toPlanEntryFormState(entry, { date: '2026-01-01' });

    expect(state.pace).toBe('5:30');
    expect(state.distance).toBe('7,5');
    expect(state.kind).toBe('run');
  });
});

describe('visiblePlanEntryError', () => {
  const errors = readPlanEntryForm({ ...runBase, hours: '', minutes: '0', seconds: '0' }).errors;
  const touched = (...fields: PlanEntryFormField[]) => new Set<PlanEntryFormField>(fields);

  it('zeigt den Dauerfehler, sobald irgendein Dauerfeld berührt ist', () => {
    expect(errors.hours).toBe(PLAN_MESSAGES.duration);
    expect(visiblePlanEntryError(errors, touched(), 'hours')).toBeUndefined();
    expect(visiblePlanEntryError(errors, touched('minutes'), 'hours')).toBe(PLAN_MESSAGES.duration);
    expect(visiblePlanEntryError(errors, touched('seconds'), 'hours')).toBe(PLAN_MESSAGES.duration);
  });

  it('andere Felder erst, wenn sie selbst berührt sind', () => {
    const paceErrors = read({ pace: '5:75' }).errors;

    expect(visiblePlanEntryError(paceErrors, touched('title'), 'pace')).toBeUndefined();
    expect(visiblePlanEntryError(paceErrors, touched('pace'), 'pace')).toBe('Pace bitte als m:ss, z. B. 5:30.');
  });
});
