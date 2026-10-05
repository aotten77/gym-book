import type { PlanEntry, PlanEntryKind } from "@/domain/models";
import {
  PLAN_MESSAGES,
  validatePlanEntryValues,
  type PlanEntryValues,
} from "@/domain/plan";
import { durationFromParts, formatPace, splitDuration } from "@/domain/run";
import { parseNumberInput, toInputValue } from "@/lib/number-input";

/*
 * Der Formularzustand eines Termins - Strings, wie sie im Feld stehen.
 * Wie `run-form.ts`: die Umrechnung zwischen Feld und Datensatz gibt es nur
 * hier, die Regeln selbst stehen in `plan.ts`. Anders als beim Lauf ist jede
 * Vorgabe optional: ein leeres Feld heißt `null`, nicht "fehlt".
 */

export type PlanEntryFormField =
  | "date"
  | "kind"
  | "templateId"
  | "title"
  | "distance"
  | "hours"
  | "minutes"
  | "seconds"
  | "pace"
  | "elevation"
  | "heartRate"
  | "instructions"
  | "notes";

export type PlanEntryFormState = Record<PlanEntryFormField, string>;

export const PACE_MESSAGE = "Pace bitte als m:ss, z. B. 5:30.";

/** `5:30` → 330, `5` → 300, leer → `null`, alles andere (auch `5:75`) → `'invalid'`. */
export function parsePaceInput(value: string): number | null | "invalid" {
  const trimmed = value.trim();

  if (trimmed === "") {
    return null;
  }

  const match = /^(\d{1,3})(?::(\d{1,2}))?$/.exec(trimmed);

  if (!match) {
    return "invalid";
  }

  const minutes = Number(match[1]);
  const seconds = match[2] === undefined ? 0 : Number(match[2]);

  return seconds > 59 ? "invalid" : minutes * 60 + seconds;
}

export function toPlanEntryFormState(
  entry: PlanEntry | undefined,
  defaults: { date: string; kind?: PlanEntryKind },
): PlanEntryFormState {
  const duration =
    entry?.targetDurationSeconds !== undefined
      ? splitDuration(entry.targetDurationSeconds)
      : undefined;

  return {
    date: entry?.date ?? defaults.date,
    kind: entry?.kind ?? defaults.kind ?? "workout",
    templateId: entry?.templateId ?? "",
    title: entry?.title ?? "",
    distance: toInputValue(entry?.targetDistanceKm),
    hours: duration ? String(duration.hours) : "",
    minutes: duration ? String(duration.minutes) : "",
    seconds: duration ? String(duration.seconds) : "",
    pace:
      entry?.targetPaceSecondsPerKm !== undefined
        ? formatPace(entry.targetPaceSecondsPerKm)
        : "",
    elevation: toInputValue(entry?.targetElevationGainM),
    heartRate: toInputValue(entry?.targetAverageHeartRate),
    instructions: entry?.instructions ?? "",
    notes: entry?.notes ?? "",
  };
}

type Errors = Partial<Record<PlanEntryFormField, string>>;

/** Ein Dauerfeld: leer zählt als 0, sonst eine ganze Zahl (ggf. unter dem Limit). */
function readDurationPart(
  raw: string,
  max?: number,
): { value?: number; error?: string } {
  const parsed = parseNumberInput(raw);

  if (parsed.status === "empty") {
    return { value: 0 };
  }

  if (
    parsed.status === "invalid" ||
    !Number.isInteger(parsed.value) ||
    parsed.value < 0 ||
    (max !== undefined && parsed.value > max)
  ) {
    return { error: max === undefined ? "Ganze Zahl" : `0–${max}` };
  }

  return { value: parsed.value };
}

function optionalNumber(
  raw: string,
  message: string,
  errors: Errors,
  field: PlanEntryFormField,
) {
  const parsed = parseNumberInput(raw);

  if (parsed.status === "invalid") {
    errors[field] = message;
    return null;
  }

  return parsed.status === "valid" ? parsed.value : null;
}

export function readPlanEntryForm(state: PlanEntryFormState): {
  values?: PlanEntryValues;
  errors: Errors;
} {
  const errors: Errors = {};
  const kind: PlanEntryKind = state.kind === "run" ? "run" : "workout";

  let targetDistanceKm: number | null = null;
  let targetDurationSeconds: number | null = null;
  let targetElevationGainM: number | null = null;
  let targetAverageHeartRate: number | null = null;
  let targetPaceSecondsPerKm: number | null = null;

  // Vorgaben der anderen Art werden ignoriert, nicht geprüft - wie in `validatePlanEntryValues`.
  if (kind === "run") {
    targetDistanceKm = optionalNumber(
      state.distance,
      PLAN_MESSAGES.distance,
      errors,
      "distance",
    );
    targetElevationGainM = optionalNumber(
      state.elevation,
      PLAN_MESSAGES.elevation,
      errors,
      "elevation",
    );
    targetAverageHeartRate = optionalNumber(
      state.heartRate,
      PLAN_MESSAGES.heartRate,
      errors,
      "heartRate",
    );

    const pace = parsePaceInput(state.pace);
    if (pace === "invalid") {
      errors.pace = PACE_MESSAGE;
    } else {
      targetPaceSecondsPerKm = pace;
    }

    const hours = readDurationPart(state.hours);
    const minutes = readDurationPart(state.minutes, 59);
    const seconds = readDurationPart(state.seconds, 59);
    if (hours.error) errors.hours = hours.error;
    if (minutes.error) errors.minutes = minutes.error;
    if (seconds.error) errors.seconds = seconds.error;

    if (
      hours.value !== undefined &&
      minutes.value !== undefined &&
      seconds.value !== undefined
    ) {
      const total = durationFromParts(
        hours.value,
        minutes.value,
        seconds.value,
      );
      // Drei leere Felder sind keine Dauer von 0, sondern keine Vorgabe.
      targetDurationSeconds =
        total === 0 &&
        state.hours.trim() + state.minutes.trim() + state.seconds.trim() === ""
          ? null
          : total;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  const title = state.title.trim();
  const instructions = state.instructions.trim();
  const notes = state.notes.trim();
  const values: PlanEntryValues = {
    date: state.date.trim(),
    kind,
    templateId: kind === "workout" ? state.templateId.trim() || null : null,
    title: kind === "run" ? title || null : null,
    targetDistanceKm,
    targetDurationSeconds,
    targetElevationGainM,
    targetAverageHeartRate,
    targetPaceSecondsPerKm,
    instructions: instructions || null,
    notes: notes || null,
  };

  const message = validatePlanEntryValues(values);

  if (message) {
    const fieldByMessage = new Map<string, PlanEntryFormField>([
      [PLAN_MESSAGES.dateInvalid, "date"],
      [PLAN_MESSAGES.workoutMissing, "templateId"],
      [PLAN_MESSAGES.titleMissing, "title"],
      [PLAN_MESSAGES.distance, "distance"],
      [PLAN_MESSAGES.duration, "hours"],
      [PLAN_MESSAGES.pace, "pace"],
      [PLAN_MESSAGES.elevation, "elevation"],
      [PLAN_MESSAGES.heartRate, "heartRate"],
    ]);

    return { errors: { [fieldByMessage.get(message) ?? "date"]: message } };
  }

  return { values, errors };
}
