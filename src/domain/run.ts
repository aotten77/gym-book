import { parseLocalDate } from '@/domain/calendar-week';
import { toDateInputValue } from '@/domain/program';

/*
 * Reine Regeln für Läufe. Die Pace wird nie gespeichert - sie folgt aus
 * Strecke und Dauer und wird hier jedes Mal neu gerechnet.
 */

export const RUN_HEART_RATE_MIN = 30;
export const RUN_HEART_RATE_MAX = 250;

export const RUN_MESSAGES = {
  distance: 'Bitte eine Strecke über 0 km eintragen.',
  duration: 'Bitte eine Dauer eintragen.',
  dateInvalid: 'Bitte ein gültiges Datum eintragen.',
  dateFuture: 'Ein Lauf kann nicht in der Zukunft liegen.',
  elevation: 'Höhenmeter bitte als ganze Zahl ab 0.',
  heartRate: `Puls bitte zwischen ${RUN_HEART_RATE_MIN} und ${RUN_HEART_RATE_MAX}.`,
} as const;

/** Die Werte eines Laufs, wie sie geschrieben werden; `null` heißt "nicht erfasst". */
export interface RunLogValues {
  date: string;
  distanceKm: number;
  durationSeconds: number;
  elevationGainM: number | null;
  averageHeartRate: number | null;
  notes: string | null;
}

export function durationFromParts(hours: number, minutes: number, seconds: number): number {
  return hours * 3600 + minutes * 60 + seconds;
}

export function splitDuration(totalSeconds: number): { hours: number; minutes: number; seconds: number } {
  const total = Math.max(0, Math.round(totalSeconds));

  return {
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

export function paceSecondsPerKm(distanceKm: number, durationSeconds: number): number | undefined {
  if (!(distanceKm > 0) || !(durationSeconds > 0)) {
    return undefined;
  }

  return durationSeconds / distanceKm;
}

/** `5:12` - ohne Einheit. Gerundet wird zuerst, damit 299,6 s zu `5:00` wird und nicht zu `4:60`. */
export function formatPace(secondsPerKm: number): string {
  const total = Math.round(secondsPerKm);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** `52:30`, ab einer Stunde `1:21:05`. */
export function formatRunDuration(totalSeconds: number): string {
  const { hours, minutes, seconds } = splitDuration(totalSeconds);
  const ss = String(seconds).padStart(2, '0');

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${ss}`
    : `${minutes}:${ss}`;
}

/** Die erste deutsche Fehlermeldung oder `undefined`, wenn der Lauf geschrieben werden darf. */
export function validateRunLogValues(values: RunLogValues, today: Date): string | undefined {
  if (!(values.distanceKm > 0)) {
    return RUN_MESSAGES.distance;
  }

  if (!(values.durationSeconds > 0)) {
    return RUN_MESSAGES.duration;
  }

  // `parseLocalDate` rollt 2026-02-30 in den März; nur ein Datum, das sich
  // unverändert zurückschreibt, ist ein echter Kalendertag.
  const parsed = parseLocalDate(values.date);

  if (!parsed || toDateInputValue(parsed) !== values.date) {
    return RUN_MESSAGES.dateInvalid;
  }

  if (values.date > toDateInputValue(today)) {
    return RUN_MESSAGES.dateFuture;
  }

  if (
    values.elevationGainM !== null &&
    (!Number.isInteger(values.elevationGainM) || values.elevationGainM < 0)
  ) {
    return RUN_MESSAGES.elevation;
  }

  if (
    values.averageHeartRate !== null &&
    (!Number.isInteger(values.averageHeartRate) ||
      values.averageHeartRate < RUN_HEART_RATE_MIN ||
      values.averageHeartRate > RUN_HEART_RATE_MAX)
  ) {
    return RUN_MESSAGES.heartRate;
  }

  return undefined;
}
