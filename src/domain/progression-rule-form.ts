import type { Exercise } from '@/domain/models';
import {
  supportsBand,
  supportsHeight,
  supportsReps,
  supportsSeconds,
  supportsWeight,
} from '@/domain/tracking';
import { optionalNumberInput, toInputValue } from '@/lib/number-input';

/*
 * Der Formularzustand einer Wochenregel - Strings, wie sie im Feld stehen.
 *
 * Liegt neben der Komponente und nicht in ihr, wie `set-log-draft.ts` neben
 * dem Satz-Editor: zwei Bildschirme pflegen dieselbe Regel (die Wochenansicht
 * und die Wochenprogression im Workout), und die Umrechnung zwischen Feld und
 * Datensatz darf es nur einmal geben.
 */

export interface ProgressionRuleFormState {
  targetReps: string;
  targetRepsMax: string;
  targetSeconds: string;
  targetWeight: string;
  targetBandId: string;
  targetHeightCm: string;
  notes: string;
}

export const emptyProgressionRuleForm: ProgressionRuleFormState = {
  targetReps: '',
  targetRepsMax: '',
  targetSeconds: '',
  targetWeight: '',
  targetBandId: '',
  targetHeightCm: '',
  notes: '',
};

/** Formularzustand aus einer gespeicherten Regel - leer heißt "keine Regel". */
export function buildProgressionRuleForm(rule?: {
  targetReps?: number;
  targetRepsMax?: number;
  targetSeconds?: number;
  targetWeight?: number;
  targetBandId?: string;
  targetHeightCm?: number;
  notes?: string;
}): ProgressionRuleFormState {
  return {
    targetReps: toInputValue(rule?.targetReps),
    targetRepsMax: toInputValue(rule?.targetRepsMax),
    targetSeconds: toInputValue(rule?.targetSeconds),
    targetWeight: toInputValue(rule?.targetWeight),
    targetBandId: rule?.targetBandId ?? '',
    targetHeightCm: toInputValue(rule?.targetHeightCm),
    notes: rule?.notes ?? '',
  };
}

/**
 * Was aus dem Formular an `saveProgressionRule` geht.
 *
 * Felder, die die Übung gar nicht kennt, werden ausdrücklich `undefined` -
 * sonst schriebe ein Bandwechsel der Übung später eine Kilo-Vorgabe fort, die
 * niemand mehr sieht.
 */
export function toProgressionRuleInput(
  form: ProgressionRuleFormState,
  /*
   * `trackingMode` ist hier optional, anders als auf `Exercise` selbst: die
   * Wochenansicht kennt auch Zeilen, deren Übung gelöscht wurde. Ohne
   * Erfassung gibt es dann kein Feld und also auch keinen Wert.
   */
  exercise:
    | (Partial<Pick<Exercise, 'trackingMode'>> & Pick<Exercise, 'loadKind' | 'tracksHeight'>)
    | undefined,
) {
  return {
    targetReps: supportsReps(exercise?.trackingMode)
      ? optionalNumberInput(form.targetReps)
      : undefined,
    targetRepsMax: supportsReps(exercise?.trackingMode)
      ? optionalNumberInput(form.targetRepsMax)
      : undefined,
    targetSeconds: supportsSeconds(exercise?.trackingMode)
      ? optionalNumberInput(form.targetSeconds)
      : undefined,
    targetWeight: supportsWeight(exercise?.trackingMode, exercise?.loadKind)
      ? optionalNumberInput(form.targetWeight)
      : undefined,
    targetBandId: supportsBand(exercise?.trackingMode, exercise?.loadKind)
      ? form.targetBandId
      : undefined,
    targetHeightCm: supportsHeight(exercise?.tracksHeight)
      ? optionalNumberInput(form.targetHeightCm)
      : undefined,
    notes: form.notes,
  };
}
