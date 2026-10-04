import { describe, expect, it } from 'vitest';
import type { RunLog } from '@/domain/models';
import { readRunForm, toRunFormState, type RunFormState } from '@/domain/run-form';

const today = new Date(2026, 9, 4, 18);
const base: RunFormState = { ...toRunFormState(undefined, today), distance: '10', minutes: '52' };
const read = (patch: Partial<RunFormState>) => readRunForm({ ...base, ...patch }, today);

describe('readRunForm', () => {
  it('liest Komma und Punkt', () => {
    expect(read({ distance: '7,5' }).values?.distanceKm).toBe(7.5);
    expect(read({ distance: '7.5' }).values?.distanceKm).toBe(7.5);

    const bad = read({ distance: '7,5,1' });
    expect(bad.errors.distance).toBeDefined();
    expect(bad.values).toBeUndefined();
  });

  it('leere Std/Sek neben Min zählen als 0', () => {
    expect(read({ hours: '', minutes: '52', seconds: '' }).values?.durationSeconds).toBe(3120);
  });

  it('Min und Sek über 59 sind ein Feldfehler', () => {
    expect(read({ minutes: '75' }).errors.minutes).toBe('0–59');
    expect(read({ seconds: '60' }).errors.seconds).toBe('0–59');
  });

  it('ganz leere Dauer ist ein Fehler', () => {
    const result = read({ hours: '', minutes: '', seconds: '' });
    expect(result.errors.hours).toBe('Bitte eine Dauer eintragen.');
    expect(result.values).toBeUndefined();
  });

  it('leere optionale Felder werden null', () => {
    const { values } = read({ elevation: '', heartRate: '', notes: '' });
    expect(values?.elevationGainM).toBeNull();
    expect(values?.averageHeartRate).toBeNull();
    expect(values?.notes).toBeNull();
    expect(read({ notes: '  locker  ' }).values?.notes).toBe('locker');
  });

  it('Pace erscheint, sobald Strecke und Dauer gültig sind', () => {
    const result = read({ distance: '10', hours: '0', minutes: '52', seconds: '0', heartRate: '12x' });
    expect(result.paceSecondsPerKm).toBe(312);
    expect(result.errors.heartRate).toBeDefined();
    expect(result.values).toBeUndefined();
  });

  it('legt Fachfehler ans passende Feld', () => {
    expect(read({ date: '2026-10-05' }).errors.date).toBe('Ein Lauf kann nicht in der Zukunft liegen.');
    expect(read({ heartRate: '20' }).errors.heartRate).toBe('Puls bitte zwischen 30 und 250.');
    expect(read({ elevation: '1,5' }).errors.elevation).toBe('Höhenmeter bitte als ganze Zahl ab 0.');
  });
});

describe('toRunFormState', () => {
  it('ist die Umkehrung', () => {
    const run: RunLog = {
      id: 'r1',
      date: '2026-10-01',
      distanceKm: 7.5,
      durationSeconds: 4865,
      elevationGainM: 180,
      createdAt: '',
      updatedAt: '',
    };
    expect(toRunFormState(run, today)).toMatchObject({
      date: '2026-10-01',
      distance: '7,5',
      hours: '1',
      minutes: '21',
      seconds: '5',
      elevation: '180',
      heartRate: '',
    });
  });

  it('startet leer mit dem heutigen Tag', () => {
    expect(toRunFormState(undefined, today).date).toBe('2026-10-04');
  });
});
