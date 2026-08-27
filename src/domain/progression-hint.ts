import type { SetValues } from '@/domain/history';
import type { BandLevel, WorkoutSessionExercise, WorkoutSetLog } from '@/domain/models';
import {
  supportsBand,
  supportsHeight,
  supportsReps,
  supportsSeconds,
  supportsWeight,
} from '@/domain/tracking';

/**
 * Doppelprogression als *Beobachtung* - eine Marke, keine Zahl.
 *
 * Die ganze Regel in einem Satz: hat in der letzten abgeschlossenen Ausführung
 * **genau dieser Satz auf genau dieser Seite** das Wiederholungsziel erreicht,
 * dann ist an dieser Zeile eine Steigerung möglich. Sonst nichts.
 *
 * Zwei Dinge sind daran neu, und beide sind derselbe Gedanke:
 *
 * - **Pro Satz statt pro Übung.** Der Vorgänger setzte voraus, dass alle
 *   Arbeitssätze gleich sind. Das stimmt für 3×8 @ 60 kg und für sonst kein
 *   Satzschema: bei einer Rampe (Satz 1: 10×30, Satz 2: 10×35, Satz 3: 10×40)
 *   nahm er das Minimum über alle Sätze und schlug am ersten Satz 32,5 kg vor -
 *   unterhalb der tatsächlichen Arbeitslast. Das Minimum ist die richtige
 *   Antwort auf *Seiten*-Unterschiede und die falsche auf *Satz*-Unterschiede.
 *   Möglich wird der Schnitt, weil die Historie schon satzgenau ist:
 *   `byKey[setLogKey(log)]` in [history.ts] hält Satznummer und Seite.
 * - **Ohne Zahl und ohne Tippen.** Welcher Sprung an der Stange, an der
 *   Kurzhantel oder am Stack möglich ist, weiß der Nutzer besser als die App -
 *   und damit entfällt die gesamte Arithmetik: Schrittweiten, Rundung, die
 *   Basis über mehrere Sätze. Es entfällt auch die Brandmauer gegen
 *   `setRowFallback` und `adoptPlaceholders`: ohne Wert kann nichts still
 *   überschrieben werden.
 *
 * Bleibt, was auch vorher galt: die Regel rät nicht. Fehlt die Decke, gibt es
 * keine Marke statt einer erfundenen.
 */

type HintExercise = Pick<
  WorkoutSessionExercise,
  | 'trackingMode'
  | 'loadKind'
  | 'tracksHeight'
  | 'unilateral'
  | 'targetReps'
  | 'targetRepsMax'
  | 'targetSeconds'
  | 'suggestProgression'
>;

export interface ProgressionHintInput {
  exercise: HintExercise;
  /** Die Satzzeile, an der die Marke stehen würde. */
  log: Pick<WorkoutSetLog, 'setKind' | 'completed'>;
  /**
   * Werte **derselben Satznummer und Seite** aus der letzten abgeschlossenen
   * Ausführung - `byKey[setLogKey(row)]`, ausdrücklich nicht `resolve(row)`.
   *
   * Kein Rückfall auf den höchsten Satz: hatte die letzte Einheit drei Sätze
   * und diese hat vier, bekommt Satz 4 keine Marke. Eine Marke auf geratener
   * Zuordnung ist keine Auskunft.
   */
  lastExact?: SetValues;
  /** Der Bandkatalog, sortiert oder nicht - `orderIndex` entscheidet. */
  bandLevels?: BandLevel[];
}

/**
 * Ob die Übung überhaupt eine Dimension hat, in der sie wachsen kann.
 *
 * Die Rangfolge spielt hier keine Rolle mehr - es wird ja kein Wert gebildet -,
 * wohl aber die Frage selbst: eine reine Wiederholungsübung ohne Last kann nur
 * in Wiederholungen wachsen, und die *sind* die Spanne, nicht ihr Schritt.
 */
export function hasProgressionDimension(
  exercise: Pick<HintExercise, 'trackingMode' | 'loadKind' | 'tracksHeight'>,
) {
  return (
    supportsHeight(exercise.tracksHeight) ||
    supportsBand(exercise.trackingMode, exercise.loadKind) ||
    supportsWeight(exercise.trackingMode, exercise.loadKind) ||
    supportsSeconds(exercise.trackingMode)
  );
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

interface Ceiling {
  value: number;
  read: (values: SetValues) => number | undefined;
}

/**
 * Was "erreicht" bei dieser Übung heißt.
 *
 * Bei Wiederholungen ist es `targetRepsMax ?? targetReps`: eine eingetragene
 * Spanne 8-12 wird bei 12 ausgereizt, eine einzelne Zielzahl 10 bei 10. Vorher
 * verlangte die Regel ein Maximum und schwieg ohne es - was dazu führte, dass
 * "nie steigern" nur über ein leer gelassenes Feld auszudrücken war. Bei Zeit
 * ist es `targetSeconds`: eine Zeitvorgabe *ist* schon eine Decke, wer 45 s
 * halten soll, hält nicht 60.
 */
function resolveCeiling(exercise: HintExercise): Ceiling | undefined {
  if (supportsReps(exercise.trackingMode)) {
    const value = exercise.targetRepsMax ?? exercise.targetReps;

    return typeof value === 'number' ? { value, read: (values) => values.reps } : undefined;
  }

  if (supportsSeconds(exercise.trackingMode)) {
    return typeof exercise.targetSeconds === 'number'
      ? { value: exercise.targetSeconds, read: (values) => values.seconds }
      : undefined;
  }

  return undefined;
}

/**
 * Ob an dieser Satzzeile eine Steigerung möglich ist.
 *
 * Die Reihenfolge der Prüfungen ist die Reihenfolge, in der man sie im Kopf
 * durchgeht: Darf die Übung überhaupt? Ist die Zeile ein offener Arbeitssatz?
 * Gibt es einen Vorgänger? Und hat der die Decke erreicht?
 */
export function hasProgressionHint({
  exercise,
  log,
  lastExact,
  bandLevels,
}: ProgressionHintInput): boolean {
  // Der Schalter der Übung sticht alles: Rotatorenmanschette wird nicht
  // gesteigert, egal wie gut die letzte Woche lief.
  if (exercise.suggestProgression === false) {
    return false;
  }

  /*
   * Nur auf offenen Arbeitssätzen. Abgehakt ist erledigt - die Marke ist eine
   * Beobachtung über die letzte Einheit, kein Nachtrag zu dieser. Und der
   * Aufwärmsatz trägt eine andere Last, für ihn gibt es nichts auszureizen.
   */
  if (log.setKind !== 'work' || log.completed) {
    return false;
  }

  if (!lastExact) {
    return false;
  }

  if (!hasProgressionDimension(exercise)) {
    return false;
  }

  const ceiling = resolveCeiling(exercise);

  if (!ceiling) {
    return false;
  }

  const achieved = ceiling.read(lastExact);

  /*
   * Was nicht gemessen wurde, gilt nicht als geschafft. `>=` statt `===`: wer
   * 11 von 8-10 geschafft hat, hat den Schritt erst recht verdient.
   */
  if (typeof achieved !== 'number' || achieved < ceiling.value) {
    return false;
  }

  /*
   * Beim Band ist "möglich" wörtlich zu nehmen: gibt der Katalog nichts
   * Schwereres her, wäre die Marke eine Lüge. Ein Satz ohne Band hat keinen
   * Stand, von dem aus das nächste eine Steigerung wäre.
   */
  if (supportsBand(exercise.trackingMode, exercise.loadKind)) {
    return lastExact.bandId
      ? Boolean(nextBandLevel(bandLevels ?? [], lastExact.bandId))
      : false;
  }

  return true;
}

/** Die Marke im Klartext - Kurzform für schmale Zeilen, Langform für den Rest. */
export const PROGRESSION_HINT_LABEL = 'Steigerung möglich';
export const PROGRESSION_HINT_SHORT_LABEL = 'steigern';
