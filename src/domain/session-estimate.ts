import { sortSetLogs } from '@/domain/history';
import type { SetKind, WorkoutSessionExercise, WorkoutSetLog } from '@/domain/models';
import { DEFAULT_REST_SECONDS } from '@/domain/rest-timer';
import type { SetLogsByExercise } from '@/domain/session-summary';
import { resolveSetTimerSeconds } from '@/domain/set-timer';
import type { SupersetBlock } from '@/domain/superset';

/**
 * Wie lange die laufende Einheit noch dauert.
 *
 * Anders als der Rest dieses Ordners beschreibt dieses Modul nicht, was
 * gespeichert ist, sondern sagt etwas voraus - deshalb steht es allein und
 * nicht in [session-summary.ts](./session-summary.ts). Das Vorbild sind
 * `rest-timer.ts` und `set-timer.ts`: ein Begriff, seine Konstanten, die Uhr
 * als Parameter.
 *
 * Das Modell hat zwei Hälften. Die *Planzeit* summiert, was die offenen
 * Satzzeilen nach Vorgabe kosten. Das *gemessene Tempo* vergleicht die
 * Abstände zwischen den bereits abgehakten Zeilen mit genau dieser Planzeit
 * und skaliert den Rest damit um. Historie über frühere Einheiten wird
 * absichtlich nicht gelesen: dieselbe Vorlage wird an einem vollen Samstag
 * anders trainiert als am leeren Dienstagmorgen, und das steht im Tempo
 * dieser Einheit schon drin.
 */

/** Gewicht auflegen, Position finden, Werte eintragen - fällt an jeder Zeile an. */
export const ROW_OVERHEAD_SECONDS = 20;

/** Bewegung plus Atmung. Grob, aber besser als die Wiederholung zu ignorieren. */
export const SECONDS_PER_REP = 3;

const MIN_WORK_SECONDS = 15;
const MAX_WORK_SECONDS = 240;

/** Weder Wiederholungen noch Zeit vorgegeben: ein Satz dauert trotzdem etwas. */
export const FALLBACK_WORK_SECONDS = 30;

/** Links auf rechts ist ein Seitenwechsel, keine Pause. */
export const SIDE_SWITCH_SECONDS = 20;

/** Der Gerätewechsel im Supersatz - kurz, aber nicht null. */
export const SUPERSET_SWITCH_SECONDS = 25;

/** Nach dem Aufwärmsatz wartet niemand die volle Satzpause ab. */
export const WARMUP_REST_FACTOR = 0.5;

/** Längere Lücken sind Unterbrechungen und kein Takt: Anruf, Toilette, Gespräch. */
export const MAX_SAMPLE_SECONDS = 600;

export const MIN_PACE_FACTOR = 0.5;
export const MAX_PACE_FACTOR = 2.5;

/** Ab so vielen Messwerten zählt das gemessene Tempo voll. */
export const FULL_CONFIDENCE_SAMPLES = 6;

export interface SessionEstimateInput {
  /** Die Blöcke in Ausführungsreihenfolge - der Supersatz braucht seine Partner. */
  blocks: SupersetBlock<WorkoutSessionExercise>[];
  logsByExercise: SetLogsByExercise;
  /** Wie in `rest-timer.ts`: die Uhr steht draußen, damit die Regel prüfbar bleibt. */
  now: number;
}

/** Woher die Zahl kommt: reiner Plan, Plan mit Messung, überwiegend gemessen. */
export type SessionEstimateQuality = 'plan' | 'blended' | 'measured';

export interface SessionEstimate {
  /** Restdauer in Sekunden, nie negativ. */
  remainingSeconds: number;
  /** Offene Zeilen ohne ausgelassene Übungen - trennt "0 min" von "fertig". */
  openRowCount: number;
  /** Wie viele gemessene Abstände die Schätzung tragen. */
  sampleCount: number;
  /** Der wirksame Tempofaktor nach Deckelung und Konfidenz. 1 = Planzeit. */
  paceFactor: number;
  quality: SessionEstimateQuality;
}

/** Eine Runde im Plan: eine Satznummer, im Supersatz über beide Mitglieder. */
interface PlannedRound {
  rows: WorkoutSetLog[];
  /** Arbeit, Wechsel und Aufschläge - alles außer der nachlaufenden Pause. */
  workSeconds: number;
  /** Die Pause, die nach dieser Runde übrig bleibt. Nach der letzten: keine. */
  trailingRestSeconds: number;
}

/**
 * Was eine einzelne Zeile an reiner Arbeit kostet.
 *
 * Bei einer Übung auf Zeit gilt dieselbe Rangfolge wie beim Satz-Timer -
 * Eingetragenes schlägt Ziel schlägt Vorgabe -, damit die Schätzung dieselbe
 * Zahl annimmt, die der Timer nachher tatsächlich stellt.
 */
function rowWorkSeconds(exercise: WorkoutSessionExercise, log: WorkoutSetLog) {
  const isTimed =
    exercise.trackingMode === 'time' ||
    exercise.trackingMode === 'time_weight' ||
    typeof exercise.targetSeconds === 'number';

  if (isTimed) {
    return resolveSetTimerSeconds(log.seconds, exercise.targetSeconds);
  }

  const reps = log.reps ?? exercise.targetReps;

  if (typeof reps !== 'number' || !Number.isFinite(reps) || reps <= 0) {
    return FALLBACK_WORK_SECONDS;
  }

  return Math.min(MAX_WORK_SECONDS, Math.max(MIN_WORK_SECONDS, Math.round(reps * SECONDS_PER_REP)));
}

function restSecondsFor(exercise: WorkoutSessionExercise, kind: SetKind) {
  const base = exercise.restSeconds ?? DEFAULT_REST_SECONDS;

  return kind === 'warmup' ? base * WARMUP_REST_FACTOR : base;
}

function roundKey(log: WorkoutSetLog) {
  return `${log.setKind}:${log.setNumber}`;
}

/**
 * Zerlegt die Einheit in Runden - und rechnet die Pause pro Runde, nicht pro Zeile.
 *
 * Das ist die eigentliche Regel dieses Moduls. Im Supersatz läuft die Pause der
 * ersten Übung, während die zweite ausgeführt wird; angerechnet wird deshalb nur
 * die Schuld, die die nachfolgende Arbeit nicht schon abträgt. Bei einer
 * einzelnen Übung ist diese Arbeit null, und der Term entartet exakt zur
 * eingestellten Pause - eine Formel für beide Fälle.
 */
function buildPlannedRounds(
  blocks: SupersetBlock<WorkoutSessionExercise>[],
  logsByExercise: SetLogsByExercise,
): PlannedRound[] {
  const rounds: PlannedRound[] = [];

  for (const block of blocks) {
    const members = (block.kind === 'group' ? block.exercises : [block.exercise])
      // Eine ausgelassene Übung wartet auf nichts mehr und kostet auch nichts.
      .filter((exercise) => !exercise.wasSkipped)
      .map((exercise) => ({ exercise, logs: sortSetLogs(logsByExercise[exercise.id] ?? []) }));

    // Die Runden des Blocks in Ausführungsreihenfolge: Aufwärmen vor Satz 1.
    const keys: string[] = [];

    for (const member of members) {
      for (const log of member.logs) {
        if (!keys.includes(roundKey(log))) {
          keys.push(roundKey(log));
        }
      }
    }

    keys.sort((left, right) => {
      const [leftKind, leftNumber] = left.split(':');
      const [rightKind, rightNumber] = right.split(':');

      if (leftKind !== rightKind) {
        return leftKind === 'warmup' ? -1 : 1;
      }

      return Number(leftNumber) - Number(rightNumber);
    });

    for (const key of keys) {
      const entries = members
        .map((member) => ({
          exercise: member.exercise,
          rows: member.logs.filter((log) => roundKey(log) === key),
        }))
        .filter((entry) => entry.rows.length > 0);

      if (entries.length === 0) {
        continue;
      }

      const work = entries.map(
        (entry) =>
          entry.rows.reduce((sum, row) => sum + rowWorkSeconds(entry.exercise, row), 0) +
          entry.rows.length * ROW_OVERHEAD_SECONDS +
          (entry.rows.length - 1) * SIDE_SWITCH_SECONDS,
      );
      const switches = entries.length - 1;
      const workSeconds = work.reduce((sum, value) => sum + value, 0) + switches * SUPERSET_SWITCH_SECONDS;

      const trailingRestSeconds = entries.reduce((longest, entry, index) => {
        const workAfter =
          work.slice(index + 1).reduce((sum, value) => sum + value, 0) +
          (entries.length - 1 - index) * SUPERSET_SWITCH_SECONDS;
        const debt = restSecondsFor(entry.exercise, entry.rows[0].setKind) - workAfter;

        return Math.max(longest, debt);
      }, 0);

      rounds.push({
        rows: entries.flatMap((entry) => entry.rows),
        workSeconds,
        trailingRestSeconds,
      });
    }
  }

  // Nach dem letzten Satz der Einheit wartet man nicht - man geht nach Hause.
  const last = rounds[rounds.length - 1];

  if (last) {
    last.trailingRestSeconds = 0;
  }

  return rounds;
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Die geschätzte Restdauer der Einheit.
 *
 * Reine Planzeit, solange nichts gemessen ist; mit jeder abgehakten Zeile
 * rückt die Zahl näher an das Tempo, das gerade tatsächlich gegangen wird.
 */
export function estimateRemainingSessionSeconds(input: SessionEstimateInput): SessionEstimate {
  const { blocks, logsByExercise, now } = input;
  const rounds = buildPlannedRounds(blocks, logsByExercise);

  const perRowSeconds: Record<string, number> = {};
  const plannedRows: WorkoutSetLog[] = [];

  for (const round of rounds) {
    const seconds = (round.workSeconds + round.trailingRestSeconds) / round.rows.length;

    for (const row of round.rows) {
      perRowSeconds[row.id] = seconds;
      plannedRows.push(row);
    }
  }

  const openRows = plannedRows.filter((row) => !row.completed);
  const planRemaining = openRows.reduce((sum, row) => sum + perRowSeconds[row.id], 0);

  /*
   * Gemessen wird über alle Übungen hinweg entlang der Uhr: nur die Wanduhr
   * sagt, wie lange etwas gedauert hat. Eine Spanne gehört der *späteren*
   * Zeile - sie enthält die Pause davor und deren eigene Arbeit -, und
   * verglichen wird sie mit genau deren Planzeit. Dieses Verhältnis macht
   * einen Plank, eine Kniebeuge und eine Supersatzzeile vergleichbar: der
   * Restplan wird umskaliert, nicht ersetzt.
   */
  const completions = Object.values(logsByExercise)
    .flat()
    .filter((log) => log.completed && log.completedAt)
    .map((log) => ({ log, at: Date.parse(log.completedAt as string) }))
    .filter((entry) => Number.isFinite(entry.at))
    .sort((left, right) => left.at - right.at);

  const ratios: number[] = [];

  for (let index = 1; index < completions.length; index += 1) {
    /*
     * Die Spanne vom Start der Einheit bis zur ersten Zeile ist bewusst kein
     * Messwert: darin stecken der Weg zum Rack, das Umziehen und der Blick in
     * den Plan. `n` erledigte Zeilen ergeben deshalb `n - 1` Messwerte.
     */
    const seconds = (completions[index].at - completions[index - 1].at) / 1000;
    const planned = perRowSeconds[completions[index].log.id];

    if (!planned || seconds <= 0 || seconds > MAX_SAMPLE_SECONDS) {
      continue;
    }

    ratios.push(seconds / planned);
  }

  /*
   * Der Median, nicht der Mittelwert: eine einzige lange Lücke unterhalb der
   * Verwurfsgrenze würde ein Mittel spürbar verziehen, den Median nicht.
   * Die Konfidenzrampe hält eine einzelne Messung zusätzlich klein - nach
   * zwei Zeilen weiß man noch nicht, wie der Tag läuft.
   */
  const factor =
    ratios.length === 0
      ? 1
      : Math.min(MAX_PACE_FACTOR, Math.max(MIN_PACE_FACTOR, median(ratios)));
  const confidence = Math.min(1, ratios.length / FULL_CONFIDENCE_SAMPLES);
  const paceFactor = 1 + (factor - 1) * confidence;

  let remaining = planRemaining * paceFactor;

  /*
   * Zwischen zwei Sätzen soll die Zahl sinken, statt drei Minuten stillzustehen.
   * Abgezogen wird höchstens das Budget der *einen* nächsten Zeile: eine lange
   * Unterbrechung darf die Schätzung nicht auf null treiben, und ohne
   * abgehakte Zeile gibt es keinen Anker (der Sessionstart wäre wieder der Weg
   * zum Rack).
   */
  const lastCompletion = completions[completions.length - 1];
  const nextOpenRow = openRows[0];

  if (lastCompletion && nextOpenRow) {
    const sinceLast = Math.max(0, (now - lastCompletion.at) / 1000);

    remaining -= Math.min(sinceLast, perRowSeconds[nextOpenRow.id] * paceFactor);
  }

  return {
    remainingSeconds: openRows.length === 0 ? 0 : Math.max(0, Math.round(remaining)),
    openRowCount: openRows.length,
    sampleCount: ratios.length,
    paceFactor,
    quality:
      ratios.length === 0
        ? 'plan'
        : ratios.length < FULL_CONFIDENCE_SAMPLES
          ? 'blended'
          : 'measured',
  };
}
