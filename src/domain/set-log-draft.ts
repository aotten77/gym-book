import type { LoadKind, TrackingMode, WorkoutSetLog } from '@/domain/models';
import type { SetLogValuesInput, SetValues } from '@/domain/history';
import { SET_TIMER_STEP_SECONDS } from '@/domain/set-timer';
import {
  supportsBand,
  supportsHeight,
  supportsReps,
  supportsSeconds,
  supportsWeight,
} from '@/domain/tracking';
import { parseNumberInput, toInputValue } from '@/lib/number-input';

/*
 * Was der Satz-Editor rechnet, ohne zu zeichnen.
 *
 * Die Regeln standen auf Modulebene in `SessionExerciseStage.tsx` und waren
 * dort schon rein - sie importieren nichts aus React. Getestet werden konnten
 * sie trotzdem nicht: die Datei zieht eine ganze Komponentenwelt mit.
 *
 * Der Editor selbst - die feldweise Draft-Abgleichung gegen die Live-Query,
 * der 600-ms-Autosave, das Übernehmen der Platzhalter beim Abhaken - bleibt,
 * wo er ist. Jede seiner Zeilen ist ein Bug, der schon einmal Daten gekostet
 * hat.
 */

/**
 * Schrittweite der Knöpfe neben der Wertebox.
 *
 * 2,5 kg, weil die kleinste Scheibe 1,25 wiegt und die Stange zwei davon
 * bekommt. Für Sekunden gilt der Schritt des Satz-Timers - dort verschieben
 * dieselben Knöpfe die Zielzeit, nicht einen eingetragenen Wert. 5 cm für die
 * Höhe, weil Stufen, Boxen und Hantelscheiben-Stapel in dieser Teilung
 * kommen: 20, 25, 30.
 */
export const STEP_BY_FIELD = {
  reps: 1,
  seconds: SET_TIMER_STEP_SECONDS,
  weight: 2.5,
  heightCm: 5,
} as const;

/** Die Zahlenfelder eines Satzes - das Band ist eine Auswahl, kein Wert. */
export type SetLogFieldKey = 'reps' | 'seconds' | 'weight' | 'heightCm';

export interface SetLogDraft {
  reps: string;
  seconds: string;
  weight: string;
  heightCm: string;
  /** Leerstring heißt "kein Band gewählt" - `undefined` gibt es im Draft nicht. */
  bandId: string;
}

export function createSetLogDraft(log: WorkoutSetLog): SetLogDraft {
  return {
    reps: toInputValue(log.reps),
    seconds: toInputValue(log.seconds),
    weight: toInputValue(log.weight),
    heightCm: toInputValue(log.heightCm),
    bandId: log.bandId ?? '',
  };
}

/**
 * Die Zahlenfelder eines Satzes.
 *
 * Das Band steht bewusst nicht in dieser Liste: es ist eine Auswahl, kann
 * daher nicht "ungültig" sein und braucht weder Parser noch Autosave-Pause.
 */
export const SET_LOG_FIELDS: ReadonlyArray<{
  key: SetLogFieldKey;
  supported: (trackingMode: TrackingMode, loadKind?: LoadKind, tracksHeight?: boolean) => boolean;
}> = [
  { key: 'reps', supported: (trackingMode) => supportsReps(trackingMode) },
  {
    key: 'seconds',
    supported: (trackingMode) => supportsSeconds(trackingMode),
  },
  { key: 'weight', supported: supportsWeight },
  // Die Höhe hängt allein am Schalter der Übung: sie steht neben Kilo oder
  // Band, nicht an deren Stelle.
  {
    key: 'heightCm',
    supported: (_trackingMode, _loadKind, tracksHeight) => supportsHeight(tracksHeight),
  },
];

/**
 * Einheit in der Wertebox.
 *
 * Kurz gehalten, weil sie neben der Zahl steht: auf 320px bricht schon "Wdh
 * links" um und schiebt die Box in die Höhe. Die Seite steht ohnehin über der
 * Box und auf der Seitenkarte; im zugänglichen Namen des Feldes kommt sie
 * trotzdem vor.
 */
export const SET_LOG_FIELD_UNITS = {
  reps: 'Wdh',
  seconds: 'Sek.',
  weight: 'kg',
  heightCm: 'cm',
} as const;

/** Zugänglicher Name des Feldes - "kg" allein sagt in einer Vorleseliste nichts. */
export const SET_LOG_FIELD_LABELS = {
  reps: 'Wdh',
  seconds: 'Sekunden',
  weight: 'Gewicht in kg',
  heightCm: 'Höhe in cm',
} as const;

/**
 * Sammelt die Felder, die tatsächlich geschrieben werden sollen.
 *
 * Ungültige Eingaben werden ausgelassen statt als `undefined` gesendet -
 * sonst würde eine Fehleingabe den gespeicherten Wert löschen. Ein bewusst
 * geleertes Feld wird dagegen als `undefined` übernommen.
 */
export function collectSetLogChanges(
  draft: SetLogDraft,
  log: WorkoutSetLog,
  trackingMode: TrackingMode,
  loadKind?: LoadKind,
  tracksHeight?: boolean,
) {
  const changes: SetLogValuesInput = {};
  let hasChange = false;

  for (const { key, supported } of SET_LOG_FIELDS) {
    if (!supported(trackingMode, loadKind, tracksHeight)) {
      continue;
    }

    const parsed = parseNumberInput(draft[key]);

    if (parsed.status === 'invalid') {
      continue;
    }

    const nextValue = parsed.status === 'valid' ? parsed.value : undefined;

    if (nextValue !== log[key]) {
      changes[key] = nextValue;
      hasChange = true;
    }
  }

  if (supportsBand(trackingMode, loadKind)) {
    const nextBandId = draft.bandId.trim() || undefined;

    if (nextBandId !== log.bandId) {
      changes.bandId = nextBandId;
      hasChange = true;
    }
  }

  return hasChange ? changes : null;
}

export function findInvalidSetLogFields(
  draft: SetLogDraft,
  trackingMode: TrackingMode,
  loadKind?: LoadKind,
  tracksHeight?: boolean,
) {
  return SET_LOG_FIELDS.filter(
    ({ key, supported }) =>
      supported(trackingMode, loadKind, tracksHeight) &&
      parseNumberInput(draft[key]).status === 'invalid',
  ).map(({ key }) => key);
}

/**
 * Übernimmt die Werte der letzten Woche in leer gelassene Felder.
 *
 * Der häufigste Fall im Training ist "genau wie letzte Woche". Dafür soll ein
 * Tap auf den großen Knopf genügen, ohne dieselben Zahlen erneut zu tippen -
 * der Platzhalter wird damit zum echten, gespeicherten Wert.
 */
export function adoptPlaceholders(
  draft: SetLogDraft,
  lastValues: SetValues,
  trackingMode: TrackingMode,
  loadKind?: LoadKind,
  tracksHeight?: boolean,
) {
  let next = draft;

  for (const { key, supported } of SET_LOG_FIELDS) {
    if (!supported(trackingMode, loadKind, tracksHeight) || draft[key].trim()) {
      continue;
    }

    const placeholder = toInputValue(lastValues[key]);

    if (!placeholder) {
      continue;
    }

    next = { ...next, [key]: placeholder };
  }

  // Auch das Band der letzten Woche zählt als Vorgabe: sonst wäre es das
  // einzige Feld, das man bei "genau wie letztes Mal" doch antippen müsste.
  if (supportsBand(trackingMode, loadKind) && !draft.bandId.trim() && lastValues.bandId) {
    next = { ...next, bandId: lastValues.bandId };
  }

  return next;
}
