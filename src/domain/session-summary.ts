import { sortSetLogs, type SetValues } from '@/domain/history';
import type { SetKind, WorkoutSessionExercise, WorkoutSetLog } from '@/domain/models';
import { calculateAsymmetryPercent } from '@/domain/session';
import type { SetLogFieldKey } from '@/domain/set-log-draft';
import type { SupersetBlock } from '@/domain/superset';
import { formatNumber, formatSideLabel } from '@/lib/format';

/**
 * Der Stand eines Blocks in der laufenden Einheit.
 *
 * `done` heißt: keine offene Zeile mehr, entweder abgehakt oder ausgelassen.
 * `current` ist der Block, in dem der Fokus steht - nicht zwingend der erste
 * offene, denn man darf zurückspringen. Alles andere ist `upcoming`.
 */
export type SessionBlockStatus = 'upcoming' | 'current' | 'done';

export interface SessionExerciseProgress {
  exercise: WorkoutSessionExercise;
  /** Die Sätze dieser Übung, damit die Zusammenfassung sie nicht neu suchen muss. */
  logs: WorkoutSetLog[];
  completedCount: number;
  totalCount: number;
  isDone: boolean;
  /** Die Zeile, auf die als Nächstes getippt wird - Grundlage des Schnellhakens. */
  nextOpenLog?: WorkoutSetLog;
}

export interface SessionBlockProgress {
  /** Gruppenkennung im Supersatz, sonst die Id der einzelnen Übung. */
  key: string;
  status: SessionBlockStatus;
  isSuperset: boolean;
  exercises: SessionExerciseProgress[];
  completedCount: number;
  totalCount: number;
}

export type SetLogsByExercise = Record<string, WorkoutSetLog[]>;

function exerciseProgress(
  exercise: WorkoutSessionExercise,
  logs: WorkoutSetLog[],
): SessionExerciseProgress {
  const completedCount = logs.filter((log) => log.completed).length;
  const nextOpenLog = exercise.wasSkipped
    ? undefined
    : sortSetLogs(logs).find((log) => !log.completed);

  return {
    exercise,
    logs,
    completedCount,
    totalCount: logs.length,
    // Eine ausgelassene Übung gilt als erledigt: sie wartet auf nichts mehr.
    isDone: exercise.wasSkipped || !nextOpenLog,
    nextOpenLog,
  };
}

/**
 * Fasst die Blöcke der Einheit für die Listenansicht zusammen.
 *
 * Bewusst ohne Sortierung oder Auswahl: welcher Block wo steht, entscheidet
 * die Reihenfolge, die hereingereicht wird. Hier wird nur gezählt.
 */
export function buildSessionBlockProgress(
  blocks: SupersetBlock<WorkoutSessionExercise>[],
  logsByExercise: SetLogsByExercise,
  focusedExerciseId?: string,
): SessionBlockProgress[] {
  return blocks.map((block) => {
    const members = block.kind === 'group' ? block.exercises : [block.exercise];
    const exercises = members.map((exercise) =>
      exerciseProgress(exercise, logsByExercise[exercise.id] ?? []),
    );

    const isDone = exercises.every((item) => item.isDone);
    const holdsFocus = members.some((exercise) => exercise.id === focusedExerciseId);

    return {
      key: block.kind === 'group' ? block.groupId : block.exercise.id,
      // Fertig schlägt Fokus: ein abgeschlossener Block soll nicht deshalb
      // aufgeklappt bleiben, weil der Fokus noch nicht weitergewandert ist.
      status: isDone ? 'done' : holdsFocus ? 'current' : 'upcoming',
      isSuperset: block.kind === 'group',
      exercises,
      completedCount: exercises.reduce((sum, item) => sum + item.completedCount, 0),
      totalCount: exercises.reduce((sum, item) => sum + item.totalCount, 0),
    };
  });
}

export interface NextOpenBlock {
  block: SessionBlockProgress;
  /** Das erste Mitglied, an dem noch etwas offen ist - dorthin geht der Fokus. */
  exercise: WorkoutSessionExercise;
}

/**
 * Der Block, den das Sheet nach dem letzten Satz des eigenen von selbst öffnet.
 *
 * Gesucht wird hinter dem eigenen Block und danach von vorn, wie bei
 * `findNextOpenExercise` - eine weiter oben ausgelassene oder nachträglich
 * ergänzte Übung soll nicht liegen bleiben. Der eigene Block kommt nie in
 * Frage, auch wenn er wieder offen ist: "danach" heißt *ein anderer*.
 * Ausgelassene Übungen zählen als fertig (`isDone`) und fallen damit heraus.
 */
export function findNextOpenBlock(
  blocks: SessionBlockProgress[],
  currentKey: string,
): NextOpenBlock | undefined {
  const currentIndex = blocks.findIndex((block) => block.key === currentKey);
  const ordered = [...blocks.slice(currentIndex + 1), ...blocks.slice(0, Math.max(currentIndex, 0))];

  for (const block of ordered) {
    if (block.status === 'done') {
      continue;
    }

    const open = block.exercises.find((item) => !item.isDone);

    if (open) {
      return { block, exercise: open.exercise };
    }
  }

  return undefined;
}

/**
 * Eine Runde einer Übung: alles, was zu *einer* Satznummer gehört.
 *
 * Bei einer beidseitigen Übung ist das eine Zeile, bei einer einbeinigen sind
 * es zwei - und genau deshalb gibt es den Begriff. Im Supersatz wechselt der
 * Fokus, sobald die Runde komplett ist (siehe `resolveNextFocus`), der
 * Fortschrittsstreifen im Sheet zählt Runden, und die Seitenkarten zeigen die
 * beiden Zeilen der laufenden Runde nebeneinander.
 */
export interface SetRound {
  /** Stabil über Neuberechnungen hinweg - Satzart und -nummer, nicht der Index. */
  key: string;
  setNumber: number;
  kind: SetKind;
  /** "Aufwärmen" statt "Satz 0": die Null ist eine Sortierhilfe, kein Name. */
  label: string;
  /** Die Zeilen der Runde, sortiert - bei zwei Seiten links vor rechts. */
  rows: WorkoutSetLog[];
  isDone: boolean;
}

/**
 * Fasst die Satzzeilen einer Übung zu Runden zusammen.
 *
 * Aufwärm- und Arbeitssätze tragen beide eine Satznummer und dürfen deshalb
 * nicht allein danach gruppiert werden: `setNumber: 0` gehört dem Aufwärmsatz,
 * aber die Satzart entscheidet.
 */
export function buildSetRounds(logs: WorkoutSetLog[]): SetRound[] {
  const rounds: SetRound[] = [];

  for (const log of sortSetLogs(logs)) {
    const key = `${log.setKind}:${log.setNumber}`;
    const existing = rounds.find((round) => round.key === key);

    if (existing) {
      existing.rows.push(log);
      existing.isDone = existing.isDone && log.completed;
      continue;
    }

    rounds.push({
      key,
      setNumber: log.setNumber,
      kind: log.setKind,
      label: log.setKind === 'warmup' ? 'Aufwärmen' : `Satz ${log.setNumber}`,
      rows: [log],
      isDone: log.completed,
    });
  }

  return rounds;
}

/** Was in einer offenen Satzzeile steht, solange nichts eingetragen ist. */
export interface SetRowFallback {
  reps?: number;
  seconds?: number;
  weight?: number;
  heightCm?: number;
  bandNameSnapshot?: string;
}

/**
 * Die Vorgabe für eine noch leere Satzzeile.
 *
 * Die Werte der letzten Ausführung schlagen das Ziel der Übung, weil genau
 * sie beim Abhaken übernommen werden (siehe `adoptPlaceholders`). Der große
 * Knopf verspricht damit das, was er auch schreibt.
 *
 * Mit einer Ausnahme: bei der **Zeit** schlägt das Soll das letzte Mal. Das
 * Sekundenfeld ist dort zugleich die Einstellung der Uhr und das Ergebnis, und
 * seit die Uhr über die Vorgabe hinaus zählt, kann das Ergebnis die Einstellung
 * übersteigen. Würde es zur nächsten Vorgabe, stellte sich die Uhr nach 30 s
 * gehaltener Standwaage bei 20 s Soll beim nächsten Mal auf 30 - eine stille
 * Steigerung, eine Ratsche, und genau die Automatik, die v1 ausschließt. Die
 * Überzeit bleibt Leistung im Verlauf; ob die Zeit wachsen soll, sagt
 * "Steigerung möglich" und entscheidet der Plan. Ohne Zeit-Soll bleibt es beim
 * letzten Mal - es gibt dann keinen Plan, auf den die Uhr fallen könnte. Was
 * im Feld steht, liefert `setRowPlaceholders`, aus derselben Regel.
 *
 * Hier stand einmal die Warnung, ein Steigerungs*vorschlag* dürfe nicht in
 * diesen Fallback geraten, weil er beim Abhaken ungefragt gespeichert würde.
 * Die Frage stellt sich nicht mehr: `hasProgressionHint` liefert keinen Wert,
 * sondern nur die Feststellung "Steigerung möglich". Was hier landet, ist
 * gemessen - und genau deshalb darf es ungefragt gespeichert werden.
 */
export function setRowFallback(
  exercise: Pick<
    WorkoutSessionExercise,
    | 'targetReps'
    | 'targetSeconds'
    | 'targetWeight'
    | 'targetBandNameSnapshot'
    | 'targetHeightCm'
  >,
  lastValues?: Pick<
    SetRowFallback,
    'reps' | 'seconds' | 'weight' | 'heightCm' | 'bandNameSnapshot'
  >,
): SetRowFallback {
  return {
    reps: lastValues?.reps ?? exercise.targetReps,
    seconds: exercise.targetSeconds ?? lastValues?.seconds,
    weight: lastValues?.weight ?? exercise.targetWeight,
    heightCm: lastValues?.heightCm ?? exercise.targetHeightCm,
    bandNameSnapshot: lastValues?.bandNameSnapshot ?? exercise.targetBandNameSnapshot,
  };
}

/**
 * Was in den leeren Feldern als Platzhalter steht - und beim Abhaken
 * übernommen wird.
 *
 * Die Werte der letzten Ausführung, nur die Sekunden durch das Zeit-Soll
 * ersetzt: dieselbe Ausnahme wie in `setRowFallback`, sonst zeigte das Feld 30,
 * während die Uhr auf 20 läuft, und der Knopf schriebe beim Abhaken ohne Timer
 * wieder die 30, die er gerade nicht versprochen hat. Steht ein Zeit-Soll, gilt
 * es auch ohne letzte Ausführung - der Platzhalter ist dann der Plan, und genau
 * den stellt die Uhr.
 */
export function setRowPlaceholders(
  exercise: Pick<WorkoutSessionExercise, 'targetSeconds'>,
  lastValues?: SetValues,
): SetValues | undefined {
  if (typeof exercise.targetSeconds !== 'number') {
    return lastValues;
  }

  return { ...lastValues, seconds: exercise.targetSeconds };
}

/**
 * Die Zeit der letzten Ausführung, wenn sie vom Zeit-Soll abweicht.
 *
 * Das Gegenstück zur Ausnahme in `setRowFallback`: der Plan ist die Vorgabe,
 * das letzte Mal bleibt einen Tap entfernt ("zuletzt 30 s"). Ohne Soll gibt es
 * nichts anzubieten - dann steht die letzte Zeit ohnehin schon im Feld - und
 * bei Gleichstand auch nicht, weil der Tap nichts ändern würde.
 */
export function lastSecondsOffer(
  exercise: Pick<WorkoutSessionExercise, 'targetSeconds'>,
  lastValues?: Pick<SetValues, 'seconds'>,
): number | undefined {
  const last = lastValues?.seconds;

  if (typeof exercise.targetSeconds !== 'number' || typeof last !== 'number') {
    return undefined;
  }

  return last === exercise.targetSeconds ? undefined : last;
}

/**
 * Die Werte einer Satzzeile als eine kurze Zeile: "62,5 kg × 5", "45 s".
 *
 * Sie steht an zwei Stellen - in der schmalen Satzliste und auf dem großen
 * Knopf, der den Satz abhakt. Deshalb eine Funktion: stünden dort zwei
 * Formatierungen, würde der Knopf etwas anderes versprechen als die Zeile
 * darüber zeigt.
 *
 * Bei einem Satz auf Zeit steht die Zeit vorn - sie ist dort die Leistung,
 * das Gewicht nur ihre Bedingung.
 */
export function describeSetRowValues(log: WorkoutSetLog, fallback: SetRowFallback): string {
  const take = (value: number | undefined, vorgabe: number | undefined) =>
    value ?? (log.completed ? undefined : vorgabe);
  const bandName = log.bandNameSnapshot ?? (log.completed ? undefined : fallback.bandNameSnapshot);
  const weight = take(log.weight, fallback.weight);
  const height = take(log.heightCm, fallback.heightCm);
  const heightLabel = typeof height === 'number' ? `${formatNumber(height)} cm` : undefined;
  const weightLabel = typeof weight === 'number' ? `${formatNumber(weight)} kg` : undefined;
  /*
   * Ohne Kilo und ohne Band tritt die Höhe an die Stelle der Last: bei einem
   * Step-Down ist die Stufe genau das, was die Übung schwer macht, und
   * "25 cm × 8" liest sich wie "62,5 kg × 5". Steht beides, geht die Höhe
   * voran - sie ist die Bedingung, unter der die Last bewegt wird.
   */
  const load = bandName ?? weightLabel ?? heightLabel;
  const prefix = (bandName ?? weightLabel) && heightLabel ? `${heightLabel} · ` : '';
  const reps = take(log.reps, fallback.reps);
  const seconds = take(log.seconds, fallback.seconds);

  if (typeof seconds === 'number') {
    return load ? `${prefix}${seconds} s · ${load}` : `${prefix}${seconds} s`;
  }

  if (load && typeof reps === 'number') {
    return `${prefix}${load} × ${reps}`;
  }

  if (load) {
    return `${prefix}${load}`;
  }

  return typeof reps === 'number' ? `${reps} Wdh` : '';
}

/** Die Satzzeile mit Seite, wo eine Seite existiert: "Satz 1 · links". */
export function describeSetRow(log: WorkoutSetLog): string {
  const label = log.setKind === 'warmup' ? 'Aufwärmen' : `Satz ${log.setNumber}`;
  const sideLabel = formatSideLabel(log.side);

  return sideLabel ? `${label} · ${sideLabel}` : label;
}

export interface SessionProgress {
  completedCount: number;
  totalCount: number;
  percent: number;
}

/**
 * Der Stand der gesamten Einheit.
 *
 * Gezählt werden Satz*zeilen*, nicht Sätze: eine einbeinige Übung erzeugt pro
 * Satznummer zwei Zeilen, und wer beide ausführt, hat auch zweimal etwas
 * getan. Als "Satz 5 von 14" gelesen ist das die Zahl, die zur Liste passt.
 */
export function summarizeSessionProgress(logs: WorkoutSetLog[]): SessionProgress {
  const totalCount = logs.length;
  const completedCount = logs.filter((log) => log.completed).length;

  return {
    completedCount,
    totalCount,
    percent: totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100),
  };
}

/**
 * Die Kurzfassung einer abgeschlossenen Übung für die eingeklappte Karte.
 *
 * Wiederholungen und Gewichte werden summiert bzw. gezählt, Zeiten dagegen
 * aufgezählt: "45 · 45 · 42 s" sagt etwas über das Durchhalten, was eine
 * Summe von 132 Sekunden verschweigt.
 */
export function summarizeCompletedExercise(logs: WorkoutSetLog[]): string | undefined {
  const completed = sortSetLogs(logs).filter((log) => log.completed);

  if (completed.length === 0) {
    return undefined;
  }

  const seconds = completed.map((log) => log.seconds).filter((value): value is number => typeof value === 'number');

  if (seconds.length === completed.length) {
    return `${seconds.join(' · ')} s`;
  }

  const reps = completed.map((log) => log.reps).filter((value): value is number => typeof value === 'number');

  if (reps.length > 0) {
    const total = reps.reduce((sum, value) => sum + value, 0);
    return `${total} Wdh`;
  }

  return `${completed.length} Sätze`;
}

/**
 * Die Seitendifferenz einer unilateralen Übung über alle erledigten Sätze.
 *
 * `undefined`, wenn eine Seite nichts beigetragen hat: eine Asymmetrie von
 * 100 Prozent, weil rechts noch offen ist, wäre keine Erkenntnis, sondern ein
 * Messfehler.
 */
export function summarizeExerciseAsymmetry(logs: WorkoutSetLog[]): number | undefined {
  const sumFor = (side: 'left' | 'right') =>
    logs
      .filter((log) => log.completed && log.side === side)
      .reduce((sum, log) => sum + (log.reps ?? log.seconds ?? 0), 0);

  const left = sumFor('left');
  const right = sumFor('right');

  if (left === 0 || right === 0) {
    return undefined;
  }

  return calculateAsymmetryPercent(left, right);
}

/**
 * Die geplante Wiederholungsspanne als eine Angabe: `8` oder `8–10`.
 *
 * Eine Decke, die nicht über dem unteren Rand liegt, ist keine Spanne - "8–8"
 * wäre Lärm, und ein kleineres Maximum eine Fehleingabe, die als Bereich
 * gelesen unsinnig ist. In beiden Fällen bleibt die eine Zahl stehen.
 *
 * Eine Funktion, weil dieselbe Angabe im Workout, in der Blockkarte und in der
 * Wochenansicht steht: zwei Formatierer sind der Weg, auf dem "3 × 8–10" und
 * "3 x 8 Wdh" auf zwei Bildschirmen landen.
 */
export function describeRepRange(targetReps: number, targetRepsMax?: number): string {
  return typeof targetRepsMax === 'number' && targetRepsMax > targetReps
    ? `${formatNumber(targetReps)}–${formatNumber(targetRepsMax)}`
    : formatNumber(targetReps);
}

/**
 * Das Soll eines einzelnen Feldes, wie es in der Wertebox neben dem Wert
 * steht: `8–10`, `62,5`, `45`. Ohne Einheit - die trägt das `<label>` der Box.
 *
 * Bewusst *nicht* `setRowFallback`: der ist die Vorgabe (die letzte Ausführung
 * schlägt das Ziel) und damit genau die Zahl, die als Platzhalter im Feld
 * steht. Genau daneben soll das Geplante stehen, sonst zeigten beide dasselbe
 * und der Vergleich, um den es geht, wäre unmöglich.
 *
 * Bei der Zeit zeigen sie es doch: dort schlägt das Soll das letzte Mal, der
 * Platzhalter *ist* also das Geplante. Die Wertebox lässt die Klammer deshalb
 * weg, solange das Sekundenfeld leer ist.
 */
export function describeSetTarget(
  exercise: Pick<
    WorkoutSessionExercise,
    'targetReps' | 'targetRepsMax' | 'targetSeconds' | 'targetWeight' | 'targetHeightCm'
  >,
  field: SetLogFieldKey,
): string | undefined {
  if (field === 'reps') {
    return typeof exercise.targetReps === 'number'
      ? describeRepRange(exercise.targetReps, exercise.targetRepsMax)
      : undefined;
  }

  const value =
    field === 'seconds'
      ? exercise.targetSeconds
      : field === 'weight'
        ? exercise.targetWeight
        : exercise.targetHeightCm;

  return typeof value === 'number' ? formatNumber(value) : undefined;
}

/**
 * Die Soll-Wiederholungen - aber nur, wenn die Vorgabe daneben liegt.
 *
 * Im Ruhemodus steht die Vorgabe der kommenden Zeile groß auf dem Schirm, und
 * meistens *ist* sie das Geplante. Sie dann noch einmal darunter zu wiederholen
 * wäre Lärm; die Auskunft entsteht erst in dem Fall, in dem beide Zahlen
 * auseinandergehen. Anders als die Klammer in der Wertebox, die immer steht:
 * dort vergleicht man ein Feld, hier wartet man.
 *
 * Eine Spanne gilt als getroffen, solange die Vorgabe darin liegt - bei 8–10
 * sind 9 Wiederholungen keine Abweichung, sondern der Plan.
 */
export function describeRepTargetDeviation(
  exercise: Pick<WorkoutSessionExercise, 'targetReps' | 'targetRepsMax'>,
  plannedReps: number | undefined,
): string | undefined {
  const { targetReps, targetRepsMax } = exercise;

  if (typeof targetReps !== 'number' || typeof plannedReps !== 'number') {
    return undefined;
  }

  const ceiling = targetRepsMax ?? targetReps;

  if (plannedReps >= targetReps && plannedReps <= ceiling) {
    return undefined;
  }

  return describeRepRange(targetReps, targetRepsMax);
}

/**
 * Das Ziel einer Übung als eine Zeile.
 *
 * Kilo und Band schließen sich aus - welches von beiden gilt, steht schon im
 * Datensatz, hier wird nur genommen, was gefüllt ist. Die Höhe steht daneben
 * statt an deren Stelle und geht voran, weil sie beschreibt, worauf die Last
 * überhaupt bewegt wird.
 */
export function describeExerciseTarget(exercise: WorkoutSessionExercise): string {
  const parts: string[] = [];

  if (exercise.workSetCount > 0) {
    const perSet: string[] = [];

    if (typeof exercise.targetReps === 'number') {
      perSet.push(`${describeRepRange(exercise.targetReps, exercise.targetRepsMax)} Wdh`);
    }

    if (typeof exercise.targetSeconds === 'number') {
      perSet.push(`${exercise.targetSeconds}s`);
    }

    parts.push(perSet.length > 0 ? `${exercise.workSetCount} × ${perSet.join(' ')}` : `${exercise.workSetCount} Sätze`);
  }

  if (typeof exercise.targetHeightCm === 'number') {
    parts.push(`${formatNumber(exercise.targetHeightCm)} cm`);
  }

  if (typeof exercise.targetWeight === 'number') {
    parts.push(`${formatNumber(exercise.targetWeight)} kg`);
  }

  if (exercise.targetBandNameSnapshot) {
    parts.push(`Band ${exercise.targetBandNameSnapshot}`);
  }

  return parts.join(' · ');
}
