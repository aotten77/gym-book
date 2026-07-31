import type {
  BandLevel,
  Exercise,
  ProgressionRule,
  SessionBundle,
  WorkoutSession,
  WorkoutSessionExercise,
  WorkoutSetLog,
  WorkoutTemplate,
  WorkoutTemplateExercise,
} from '@/domain/models';

interface MaterializeSessionInput {
  template: WorkoutTemplate;
  templateExercises: WorkoutTemplateExercise[];
  exercisesById: Record<string, Exercise>;
  progressionRulesByTemplateExerciseId?: Record<string, ProgressionRule | undefined>;
  /** Band-Katalog, um das Ziel-Band mit seinem Namen einzufrieren. */
  bandLevelsById?: Record<string, BandLevel | undefined>;
  programNameSnapshot?: string;
  programWeekLabelSnapshot?: string;
  usedWeekOverride?: boolean;
  resolvedProgramWeek: number;
  startedAt: string;
}

function createId() {
  return crypto.randomUUID();
}

export function materializeSession({
  template,
  templateExercises,
  exercisesById,
  progressionRulesByTemplateExerciseId,
  bandLevelsById,
  programNameSnapshot,
  programWeekLabelSnapshot,
  usedWeekOverride,
  resolvedProgramWeek,
  startedAt,
}: MaterializeSessionInput): SessionBundle {
  const sessionId = createId();

  const session: WorkoutSession = {
    id: sessionId,
    templateId: template.id,
    templateNameSnapshot: template.name,
    programNameSnapshot,
    programWeekLabelSnapshot,
    usedWeekOverride,
    resolvedProgramWeek,
    startedAt,
    status: 'active',
  };

  const sessionExercises: WorkoutSessionExercise[] = [];
  const setLogs: WorkoutSetLog[] = [];

  for (const templateExercise of [...templateExercises].sort(
    (left, right) => left.orderIndex - right.orderIndex,
  )) {
    const exercise = exercisesById[templateExercise.exerciseId];
    const progressionRule = progressionRulesByTemplateExerciseId?.[templateExercise.id];

    if (!exercise) {
      throw new Error(`Exercise ${templateExercise.exerciseId} not found`);
    }

    const sessionExerciseId = createId();
    const targetBandId = progressionRule?.targetBandId ?? templateExercise.targetBandId;

    sessionExercises.push({
      id: sessionExerciseId,
      sessionId,
      exerciseId: exercise.id,
      exerciseNameSnapshot: exercise.name,
      trackingMode: exercise.trackingMode,
      loadKind: exercise.loadKind,
      unilateral: exercise.unilateral,
      sourceTemplateExerciseId: templateExercise.id,
      orderIndex: templateExercise.orderIndex,
      wasSkipped: false,
      addedInSession: false,
      workSetCount: templateExercise.workSetCount,
      targetReps: progressionRule?.targetReps ?? templateExercise.targetReps,
      targetSeconds: progressionRule?.targetSeconds ?? templateExercise.targetSeconds,
      targetWeight: progressionRule?.targetWeight ?? templateExercise.targetWeight,
      targetBandId,
      targetBandNameSnapshot: targetBandId ? bandLevelsById?.[targetBandId]?.name : undefined,
      restSeconds: templateExercise.restSeconds,
      notes: progressionRule?.notes ?? templateExercise.notes,
    });

    // Der Schalter ist optional: alles außer einem ausdrücklichen `false`
    // bekommt weiterhin genau einen Warmup-Satz.
    if (templateExercise.includeWarmup !== false) {
      setLogs.push({
        id: createId(),
        sessionExerciseId,
        setKind: 'warmup',
        side: 'both',
        setNumber: 0,
        completed: false,
      });
    }

    for (let setNumber = 1; setNumber <= templateExercise.workSetCount; setNumber += 1) {
      const sides = exercise.unilateral ? (['left', 'right'] as const) : (['both'] as const);

      for (const side of sides) {
        setLogs.push({
          id: createId(),
          sessionExerciseId,
          setKind: 'work',
          side,
          setNumber,
          completed: false,
        });
      }
    }
  }

  return {
    session,
    sessionExercises,
    setLogs,
  };
}

/**
 * Sagt, ob an einer Übung noch ein Satz offen ist.
 *
 * Gegenstück zu [findNextOpenExercise]: die sucht bewusst immer eine *andere*
 * Übung, auch wenn die aktuelle noch offen ist. Ohne diese Prüfung davor würde
 * der Fokus schon nach dem ersten Satz weiterspringen statt nach dem letzten.
 *
 * Eine Übung ohne Satzzeilen gilt als offen - sie wartet auf Eingabe.
 */
export function hasOpenSets(sessionExerciseId: string, setLogs: WorkoutSetLog[]) {
  const ownLogs = setLogs.filter((log) => log.sessionExerciseId === sessionExerciseId);

  return ownLogs.length === 0 || ownLogs.some((log) => !log.completed);
}

/**
 * Sucht die nächste Übung, an der noch etwas offen ist.
 *
 * Gedacht für den Moment, in dem der letzte Satz einer Übung abgehakt wird:
 * der Fokus soll dann weiterwandern, statt einen Tap auf "Fokus" zu verlangen -
 * im Training zählt jeder Handgriff, den man mit verschwitzten Händen nicht
 * machen muss.
 *
 * Gesucht wird ab der aktuellen Position vorwärts und danach vom Anfang, damit
 * eine übersprungene oder nachträglich ergänzte Übung weiter oben nicht
 * liegenbleibt. Übersprungene Übungen kommen nie in Frage, und eine Übung ohne
 * Sätze gilt als offen - sie wartet auf Eingabe, sonst hätte sie keine Zeilen.
 *
 * Gibt `undefined` zurück, wenn nichts mehr offen ist; der Aufrufer lässt den
 * Fokus dann stehen, statt ins Leere zu springen.
 */
export function findNextOpenExercise(
  exercises: WorkoutSessionExercise[],
  setLogs: WorkoutSetLog[],
  currentSessionExerciseId?: string,
): WorkoutSessionExercise | undefined {
  const openBySessionExerciseId = new Set<string>();

  for (const log of setLogs) {
    if (!log.completed) {
      openBySessionExerciseId.add(log.sessionExerciseId);
    }
  }

  const hasLogs = new Set(setLogs.map((log) => log.sessionExerciseId));
  const isOpen = (exercise: WorkoutSessionExercise) =>
    !exercise.wasSkipped &&
    (openBySessionExerciseId.has(exercise.id) || !hasLogs.has(exercise.id));

  const currentIndex = exercises.findIndex((item) => item.id === currentSessionExerciseId);
  // Bei unbekannter aktueller Übung startet die Suche schlicht vorn.
  const startIndex = currentIndex === -1 ? 0 : currentIndex + 1;
  const searchOrder = [...exercises.slice(startIndex), ...exercises.slice(0, startIndex)];

  return searchOrder.find((exercise) => exercise.id !== currentSessionExerciseId && isOpen(exercise));
}

export function calculateAsymmetryPercent(leftValue: number, rightValue: number) {
  const largest = Math.max(leftValue, rightValue);

  if (largest === 0) {
    return 0;
  }

  return Number((((largest - Math.min(leftValue, rightValue)) / largest) * 100).toFixed(1));
}
