import type { BandLevel, WorkoutSessionExercise, WorkoutSetLog } from '@/domain/models';
import { STEP_BY_FIELD } from '@/domain/set-log-draft';
import {
  supportsBand,
  supportsHeight,
  supportsReps,
  supportsSeconds,
  supportsWeight,
} from '@/domain/tracking';
import { formatNumber } from '@/lib/format';

/**
 * Doppelprogression als *Vorschlag*.
 *
 * Die ganze Regel in einem Satz: hat die letzte abgeschlossene Ausführung in
 * jedem Arbeitssatz das obere Ende der geplanten Spanne erreicht - bei einer
 * einseitigen Übung auf beiden Seiten - dann ist ein Schritt auf der
 * Progressions-Dimension fällig. Sonst nichts.
 *
 * Drei Dinge, die dieses Modul bewusst *nicht* tut, weil der v1-Vertrag
 * "complex adaptive progression" ausschließt: es schreibt nichts (der Aufrufer
 * bietet den Wert an, übernommen wird er nur durch einen Tap), es lernt nichts
 * (eine deterministische Regel, in einem Satz erklärbar), und es rät nichts -
 * fehlt die Decke, gibt es keinen Vorschlag statt einer erfundenen.
 */

/** Was steigt, wenn gesteigert wird. */
export type ProgressionDimension = 'weight' | 'band' | 'heightCm' | 'seconds';

/** Woran die Regel festgemacht hat - die Beschriftung des Vorschlags. */
export type ProgressionReason = 'reps_range_topped' | 'seconds_target_met';

export type ProgressionSuggestion =
  | { kind: 'weight' | 'heightCm' | 'seconds'; value: number; reason: ProgressionReason }
  | { kind: 'band'; bandId: string; bandName: string; reason: ProgressionReason };

/**
 * Schrittweite für Sekunden - ausdrücklich *nicht* `STEP_BY_FIELD.seconds`.
 *
 * Dort steht die Schrittweite des Satz-Timers (15 s): mit denselben Knöpfen
 * verschiebt man eine Zielzeit, die man gleich abläuft. Ein Halt steigert
 * nicht in Viertelminuten - die Beispielregeln gehen in 2-Sekunden-Schritten.
 * 5 s ist der spürbare, aber machbare Sprung dazwischen.
 */
export const PROGRESSION_SECONDS_STEP = 5;

type ProgressionExercise = Pick<
  WorkoutSessionExercise,
  | 'trackingMode'
  | 'loadKind'
  | 'tracksHeight'
  | 'unilateral'
  | 'targetReps'
  | 'targetRepsMax'
  | 'targetSeconds'
  | 'targetWeight'
  | 'targetBandId'
  | 'targetHeightCm'
>;

interface SuggestNextProgressionInput {
  exercise: ProgressionExercise;
  /**
   * Die Sätze der letzten abgeschlossenen Ausführung - `LastValues.logs` aus
   * [history-queries.ts], also bereits nur Arbeitssätze und nur abgehakte
   * Zeilen. Kein eigener Query: die Session lädt das ohnehin.
   */
  lastWorkLogs: WorkoutSetLog[];
  /** Der Bandkatalog, sortiert oder nicht - `orderIndex` entscheidet. */
  bandLevels?: BandLevel[];
}

/**
 * Welche Dimension steigt.
 *
 * Die Rangfolge spiegelt bewusst `progressMetricFor`: Höhe schlägt Band
 * schlägt Gewicht. Wer `tracksHeight` einschaltet, tut das, weil dort der
 * Fortschritt stattfindet (20 cm → 25 cm) - dieselbe Begründung, aus der das
 * Diagramm die Höhe zeichnet. Exportiert, weil die Vorrangfolge selbst eine
 * Aussage ist und einzeln geprüft gehört.
 */
export function resolveProgressionDimension(
  exercise: Pick<ProgressionExercise, 'trackingMode' | 'loadKind' | 'tracksHeight'>,
): ProgressionDimension | undefined {
  if (supportsHeight(exercise.tracksHeight)) {
    return 'heightCm';
  }

  if (supportsBand(exercise.trackingMode, exercise.loadKind)) {
    return 'band';
  }

  if (supportsWeight(exercise.trackingMode, exercise.loadKind)) {
    return 'weight';
  }

  if (supportsSeconds(exercise.trackingMode)) {
    return 'seconds';
  }

  // Eine reine Wiederholungsübung ohne Last kann nur in Wiederholungen
  // wachsen - und die sind die Spanne, nicht ihr Schritt.
  return undefined;
}

/**
 * Das nächstschwerere Band nach `orderIndex`.
 *
 * `orderIndex` ist der Inhalt, nicht die Kosmetik: er ist das Einzige, was
 * "gelb" leichter als "rot" macht. Ein Band, das der Katalog nicht kennt, hat
 * keinen Rang - dann gibt es auch kein nächstes.
 */
export function nextBandLevel(
  bandLevels: BandLevel[],
  currentBandId: string,
): BandLevel | undefined {
  const current = bandLevels.find((band) => band.id === currentBandId);

  if (!current) {
    return undefined;
  }

  return [...bandLevels]
    .sort((left, right) => left.orderIndex - right.orderIndex)
    .find((band) => band.orderIndex > current.orderIndex);
}

/** 62,5 + 2,5 ergibt sonst 65.00000000000001 - dieselbe Rundung wie im Editor. */
function roundStep(value: number) {
  return Math.round(value * 100) / 100;
}

interface Ceiling {
  value: number;
  reason: ProgressionReason;
  read: (log: WorkoutSetLog) => number | undefined;
}

/**
 * Was "oberes Ende" bei dieser Übung heißt.
 *
 * Bei Wiederholungen ist es `targetRepsMax` - **fehlt sie, gibt es keinen
 * Vorschlag**, denn eine Wiederholungsvorgabe allein ist praktisch ein Boden,
 * kein Deckel. Bei Zeit ist es `targetSeconds`: eine Zeitvorgabe *ist* schon
 * eine Decke, wer 45 s halten soll, hält nicht 60.
 */
function resolveCeiling(exercise: ProgressionExercise): Ceiling | undefined {
  if (supportsReps(exercise.trackingMode)) {
    return typeof exercise.targetRepsMax === 'number'
      ? {
          value: exercise.targetRepsMax,
          reason: 'reps_range_topped',
          read: (log) => log.reps,
        }
      : undefined;
  }

  if (supportsSeconds(exercise.trackingMode)) {
    return typeof exercise.targetSeconds === 'number'
      ? {
          value: exercise.targetSeconds,
          reason: 'seconds_target_met',
          read: (log) => log.seconds,
        }
      : undefined;
  }

  return undefined;
}

/**
 * Die Basis, von der aus gestiegen wird: das **Minimum** der geloggten Werte.
 *
 * Nicht das Maximum und nicht der letzte Satz: hat die rechte Seite
 * versehentlich 22,5 kg gesehen und die linke 20, dann ist 20 der Stand, den
 * beide Seiten tragen. Ohne einen einzigen geloggten Wert gibt es keinen
 * Vorschlag - von einer unbekannten Basis aus lässt sich nicht steigern.
 */
function stepFromLogs(values: (number | undefined)[], step: number): number | undefined {
  const known = values.filter((value): value is number => typeof value === 'number');

  return known.length === 0 ? undefined : roundStep(Math.min(...known) + step);
}

export function suggestNextProgression({
  exercise,
  lastWorkLogs,
  bandLevels,
}: SuggestNextProgressionInput): ProgressionSuggestion | undefined {
  if (lastWorkLogs.length === 0) {
    return undefined;
  }

  const dimension = resolveProgressionDimension(exercise);

  if (!dimension) {
    return undefined;
  }

  /*
   * Eine einseitige Übung, von der nur eine Seite vorliegt, ist eine
   * Messlücke - dieselbe Vorsicht wie in `summarizeExerciseAsymmetry`. Eine
   * Steigerung für beide Seiten aus der Leistung einer einzigen abzuleiten
   * wäre geraten.
   */
  if (exercise.unilateral) {
    const sides = new Set(lastWorkLogs.map((log) => log.side));

    if (!sides.has('left') || !sides.has('right')) {
      return undefined;
    }
  }

  const ceiling = resolveCeiling(exercise);

  if (!ceiling) {
    return undefined;
  }

  /*
   * **Jeder** Satz muss die Decke erreicht haben, und ein fehlender Wert
   * besteht die Prüfung nicht - was nicht gemessen wurde, gilt nicht als
   * geschafft. `>=` statt `===`: wer 11 von 8-10 geschafft hat, hat den
   * Schritt erst recht verdient.
   */
  const topped = lastWorkLogs.every((log) => {
    const value = ceiling.read(log);

    return typeof value === 'number' && value >= ceiling.value;
  });

  if (!topped) {
    return undefined;
  }

  const reason = ceiling.reason;

  if (dimension === 'band') {
    const bandIds = new Set(lastWorkLogs.map((log) => log.bandId));
    const [bandId] = [...bandIds];

    // Gemischte Bänder haben keinen gemeinsamen Stand, von dem aus das
    // nächste eine Steigerung wäre.
    if (bandIds.size !== 1 || !bandId) {
      return undefined;
    }

    const next = nextBandLevel(bandLevels ?? [], bandId);

    return next
      ? { kind: 'band', bandId: next.id, bandName: next.name, reason }
      : undefined;
  }

  if (dimension === 'seconds') {
    /*
     * Bei reiner Zeit ist die Basis die Vorgabe selbst, nicht der gemessene
     * Wert: "45 gehalten, jetzt 50" erklärt sich, "von 47 auf 52" nicht.
     */
    return typeof exercise.targetSeconds === 'number'
      ? {
          kind: 'seconds',
          value: roundStep(exercise.targetSeconds + PROGRESSION_SECONDS_STEP),
          reason,
        }
      : undefined;
  }

  const value =
    dimension === 'heightCm'
      ? stepFromLogs(
          lastWorkLogs.map((log) => log.heightCm),
          STEP_BY_FIELD.heightCm,
        )
      : stepFromLogs(
          lastWorkLogs.map((log) => log.weight),
          STEP_BY_FIELD.weight,
        );

  return typeof value === 'number' ? { kind: dimension, value, reason } : undefined;
}

/** Die Handlung, die der Vorschlag anbietet: "Auf 65 kg". */
export function describeProgressionSuggestion(suggestion: ProgressionSuggestion): string {
  switch (suggestion.kind) {
    case 'band':
      return `Auf Band ${suggestion.bandName}`;
    case 'heightCm':
      return `Auf ${formatNumber(suggestion.value)} cm`;
    case 'seconds':
      return `Auf ${formatNumber(suggestion.value)} s`;
    default:
      return `Auf ${formatNumber(suggestion.value)} kg`;
  }
}

/** Die Begründung in drei Wörtern - der Vorschlag nennt sein Kriterium. */
export function describeProgressionReason(reason: ProgressionReason): string {
  return reason === 'reps_range_topped' ? 'Spanne oben ausgereizt' : 'Zeitvorgabe erreicht';
}
