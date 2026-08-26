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
import { foldProgressionRule } from '@/domain/progression-fold';
import { createId } from '@/lib/id';

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
    // Die eine Stelle, an der Wochenvorgabe und Workout zusammenfallen - die
    // Programm-Seite zeigt dieselbe Funktion an, statt sie nachzubauen.
    const targets = foldProgressionRule(templateExercise, progressionRule);
    const targetBandId = targets.targetBandId;

    sessionExercises.push({
      id: sessionExerciseId,
      sessionId,
      exerciseId: exercise.id,
      exerciseNameSnapshot: exercise.name,
      trackingMode: exercise.trackingMode,
      loadKind: exercise.loadKind,
      tracksHeight: exercise.tracksHeight,
      unilateral: exercise.unilateral,
      sourceTemplateExerciseId: templateExercise.id,
      orderIndex: templateExercise.orderIndex,
      // Der Supersatz wird mitgenommen, aber ab hier unabhängig gepflegt:
      // ihn in der Session zu lösen, darf das Template nicht anfassen.
      supersetGroupId: templateExercise.supersetGroupId,
      wasSkipped: false,
      addedInSession: false,
      workSetCount: templateExercise.workSetCount,
      targetReps: targets.targetReps,
      targetRepsMax: targets.targetRepsMax,
      targetSeconds: targets.targetSeconds,
      targetWeight: targets.targetWeight,
      targetBandId,
      targetBandNameSnapshot: targetBandId ? bandLevelsById?.[targetBandId]?.name : undefined,
      targetHeightCm: targets.targetHeightCm,
      // Die Pause kennt keine Wochenvorgabe - sie steht nicht in der Regel.
      restSeconds: templateExercise.restSeconds,
      notes: targets.notes,
    });

    const sides = exercise.unilateral ? (['left', 'right'] as const) : (['both'] as const);

    // Der Schalter ist optional: alles außer einem ausdrücklichen `false`
    // bekommt weiterhin genau eine Aufwärmrunde - bei einer einbeinigen Übung
    // sind das wie beim Arbeitssatz zwei Zeilen, weil auch aufgewärmt wird,
    // was danach einzeln belastet wird.
    if (templateExercise.includeWarmup !== false) {
      for (const side of sides) {
        setLogs.push({
          id: createId(),
          sessionExerciseId,
          setKind: 'warmup',
          side,
          setNumber: 0,
          completed: false,
        });
      }
    }

    for (let setNumber = 1; setNumber <= templateExercise.workSetCount; setNumber += 1) {
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

interface ResolveNextFocusInput {
  exercises: WorkoutSessionExercise[];
  setLogs: WorkoutSetLog[];
  currentSessionExerciseId: string;
  /** Satznummer der eben abgehakten Zeile - 0 ist der Warmup-Satz. */
  completedSetNumber: number;
}

/**
 * Wohin der Fokus nach einem abgehakten Satz wandert.
 *
 * Im Supersatz wird nach *jedem* vollständigen Satz gewechselt, nicht erst nach
 * der ganzen Übung: genau dieses Hin und Her ist ein Supersatz. "Vollständig"
 * heißt bei einer einseitigen Übung links *und* rechts - sonst spränge der
 * Fokus zwischen den Seiten weg und man müsste ihn von Hand zurückholen.
 *
 * Ohne Supersatz bleibt es beim alten Verhalten: erst wenn die Übung fertig
 * ist, geht es weiter. `undefined` heißt "Fokus bleibt stehen".
 */
export function resolveNextFocus({
  exercises,
  setLogs,
  currentSessionExerciseId,
  completedSetNumber,
}: ResolveNextFocusInput): WorkoutSessionExercise | undefined {
  const current = exercises.find((item) => item.id === currentSessionExerciseId);

  if (!current) {
    return undefined;
  }

  if (current.supersetGroupId) {
    const roundLogs = setLogs.filter(
      (log) =>
        log.sessionExerciseId === current.id && log.setNumber === completedSetNumber,
    );

    if (roundLogs.length > 0 && roundLogs.every((log) => log.completed)) {
      const members = exercises.filter(
        (item) => item.supersetGroupId === current.supersetGroupId,
      );
      const currentIndex = members.findIndex((item) => item.id === current.id);
      // Zyklisch, damit nach dem letzten Mitglied wieder das erste drankommt.
      const searchOrder = [
        ...members.slice(currentIndex + 1),
        ...members.slice(0, currentIndex),
      ];
      const partner = searchOrder.find(
        (item) => !item.wasSkipped && hasOpenSets(item.id, setLogs),
      );

      if (partner) {
        return partner;
      }
    }
  }

  if (!hasOpenSets(current.id, setLogs)) {
    return findNextOpenExercise(exercises, setLogs, current.id);
  }

  return undefined;
}

export function calculateAsymmetryPercent(leftValue: number, rightValue: number) {
  const largest = Math.max(leftValue, rightValue);

  if (largest === 0) {
    return 0;
  }

  return Number((((largest - Math.min(leftValue, rightValue)) / largest) * 100).toFixed(1));
}
