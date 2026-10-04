import type { RunLog } from '@/domain/models';
import {
  RUN_MESSAGES,
  durationFromParts,
  paceSecondsPerKm,
  splitDuration,
  validateRunLogValues,
  type RunLogValues,
} from '@/domain/run';
import { toDateInputValue } from '@/domain/program';
import { parseNumberInput, toInputValue } from '@/lib/number-input';

/*
 * Der Formularzustand eines Laufs - Strings, wie sie im Feld stehen.
 * Wie `progression-rule-form.ts`: die Umrechnung zwischen Feld und Datensatz
 * gibt es nur hier, die Regeln selbst stehen in `run.ts`.
 */

export type RunFormField =
  | 'date'
  | 'distance'
  | 'hours'
  | 'minutes'
  | 'seconds'
  | 'elevation'
  | 'heartRate'
  | 'notes';

export type RunFormState = Record<RunFormField, string>;

export function toRunFormState(run: RunLog | undefined, today: Date): RunFormState {
  if (!run) {
    return {
      date: toDateInputValue(today),
      distance: '',
      hours: '',
      minutes: '',
      seconds: '',
      elevation: '',
      heartRate: '',
      notes: '',
    };
  }

  const { hours, minutes, seconds } = splitDuration(run.durationSeconds);

  return {
    date: run.date,
    distance: toInputValue(run.distanceKm),
    hours: String(hours),
    minutes: String(minutes),
    seconds: String(seconds),
    elevation: toInputValue(run.elevationGainM),
    heartRate: toInputValue(run.averageHeartRate),
    notes: run.notes ?? '',
  };
}

/** Ein Dauerfeld: leer zählt als 0, alles andere muss eine ganze Zahl sein (und ggf. unter dem Limit). */
function readDurationPart(raw: string, max?: number): { value?: number; error?: string } {
  const parsed = parseNumberInput(raw);

  if (parsed.status === 'empty') {
    return { value: 0 };
  }

  if (parsed.status === 'invalid' || !Number.isInteger(parsed.value)) {
    return { error: max === undefined ? 'Ganze Zahl' : `0–${max}` };
  }

  if (max !== undefined && parsed.value > max) {
    return { error: `0–${max}` };
  }

  return { value: parsed.value };
}

export function readRunForm(
  state: RunFormState,
  today: Date = new Date(),
): {
  values?: RunLogValues;
  errors: Partial<Record<RunFormField, string>>;
  paceSecondsPerKm?: number;
} {
  const errors: Partial<Record<RunFormField, string>> = {};

  const distance = parseNumberInput(state.distance);
  let distanceKm: number | undefined;
  if (distance.status === 'valid') {
    distanceKm = distance.value;
  } else {
    errors.distance = RUN_MESSAGES.distance;
  }

  const hours = readDurationPart(state.hours);
  const minutes = readDurationPart(state.minutes, 59);
  const seconds = readDurationPart(state.seconds, 59);
  if (hours.error) errors.hours = hours.error;
  if (minutes.error) errors.minutes = minutes.error;
  if (seconds.error) errors.seconds = seconds.error;

  let durationSeconds: number | undefined;
  if (hours.value !== undefined && minutes.value !== undefined && seconds.value !== undefined) {
    durationSeconds = durationFromParts(hours.value, minutes.value, seconds.value);

    if (durationSeconds === 0 && !errors.hours) {
      errors.hours = RUN_MESSAGES.duration;
    }
  }

  const elevation = parseNumberInput(state.elevation);
  if (elevation.status === 'invalid') errors.elevation = RUN_MESSAGES.elevation;

  const heartRate = parseNumberInput(state.heartRate);
  if (heartRate.status === 'invalid') errors.heartRate = RUN_MESSAGES.heartRate;

  const pace =
    distanceKm !== undefined && durationSeconds !== undefined
      ? paceSecondsPerKm(distanceKm, durationSeconds)
      : undefined;

  if (Object.keys(errors).length > 0 || distanceKm === undefined || durationSeconds === undefined) {
    return { errors, paceSecondsPerKm: pace };
  }

  const notes = state.notes.trim();
  const values: RunLogValues = {
    date: state.date.trim(),
    distanceKm,
    durationSeconds,
    elevationGainM: elevation.status === 'valid' ? elevation.value : null,
    averageHeartRate: heartRate.status === 'valid' ? heartRate.value : null,
    notes: notes || null,
  };

  const message = validateRunLogValues(values, today);

  if (message) {
    const field: RunFormField =
      message === RUN_MESSAGES.distance
        ? 'distance'
        : message === RUN_MESSAGES.duration
          ? 'hours'
          : message === RUN_MESSAGES.elevation
            ? 'elevation'
            : message === RUN_MESSAGES.heartRate
              ? 'heartRate'
              : 'date';

    return { errors: { [field]: message }, paceSecondsPerKm: pace };
  }

  return { values, errors, paceSecondsPerKm: pace };
}
