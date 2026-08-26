import type {
  Exercise,
  ProgressionRule,
  WorkoutTemplate,
  WorkoutTemplateExercise,
} from '@/domain/models';
import {
  foldProgressionRule,
  overriddenTargetFields,
  type FoldableTargetField,
  type FoldedTargets,
} from '@/domain/progression-fold';
import { describeRepRange } from '@/domain/session-summary';
import { formatNumber } from '@/lib/format';

/**
 * Was in einer Programmwoche geplant ist - je Workout, je Übung.
 *
 * Die Programmseite beantwortet damit ihre eigentliche Frage ("was steht in
 * Woche 3?"), und zwar mit derselben Faltung, die `materializeSession` beim
 * Start schreibt (`foldProgressionRule`). Nachgebaut würde sie irgendwann
 * etwas anderes zeigen als das, was tatsächlich passiert.
 *
 * **Vertragsunterschied zu `materializeSession`, wichtig:** die wirft bei
 * einer verwaisten `exerciseId` - hier darf nichts werfen. Eine
 * Planungsübersicht, die wegen einer gelöschten Übung abstürzt, ist schlimmer
 * als eine, die "Unbekannte Übung" zeigt.
 *
 * Und: es gibt **keine** Verbindung Woche → Workout im Datenmodell. Alle
 * Workouts laufen in jeder Woche; ein Programm ist ein Progressions-Overlay,
 * keine Reihenfolge (siehe [next-workout.ts]). Diese Funktion erfindet dafür
 * nichts, sie listet jedes Workout.
 */

/** Der Name, unter dem eine gelöschte Übung weiterhin auftaucht. */
export const UNKNOWN_EXERCISE_NAME = 'Unbekannte Übung';

export interface WeekPlanEntry {
  templateExerciseId: string;
  exerciseId: string;
  /** `UNKNOWN_EXERCISE_NAME`, wenn die Übung nicht mehr existiert. */
  exerciseName: string;
  orderIndex: number;
  supersetGroupId?: string;
  workSetCount: number;
  /** Die Zielwerte nach der Faltung von Wochenregel über Workout. */
  effective: FoldedTargets;
  /** Welche davon aus der Woche kommen - für die Markierung je Feld. */
  overriddenFields: FoldableTargetField[];
  /** Erfassung der Übung, für die Feldauswahl beim Bearbeiten. */
  trackingMode?: Exercise['trackingMode'];
  loadKind?: Exercise['loadKind'];
  tracksHeight?: boolean;
  unilateral?: boolean;
}

export interface WeekPlanBlock {
  templateId: string;
  templateName: string;
  entries: WeekPlanEntry[];
}

interface BuildWeekPlanInput {
  templates: WorkoutTemplate[];
  templateExercises: WorkoutTemplateExercise[];
  exercises: Exercise[];
  progressionRules: ProgressionRule[];
  /** Ohne Woche gilt überall der Basiswert - kein Fehler, ein Zustand. */
  programWeekId?: string;
}

export function buildWeekPlan({
  templates,
  templateExercises,
  exercises,
  progressionRules,
  programWeekId,
}: BuildWeekPlanInput): WeekPlanBlock[] {
  const exerciseById = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  const ruleByTemplateExerciseId = new Map(
    progressionRules
      .filter((rule) => programWeekId !== undefined && rule.programWeekId === programWeekId)
      .map((rule) => [rule.templateExerciseId, rule]),
  );

  return [...templates]
    .sort((left, right) => left.name.localeCompare(right.name, 'de'))
    .map((template) => ({
      templateId: template.id,
      templateName: template.name,
      entries: templateExercises
        .filter((item) => item.templateId === template.id)
        // Supersätze bleiben zusammenhängend, weil `orderIndex` sie so hält -
        // die Sortierung ist die einzige Zusage, die es dafür braucht.
        .sort((left, right) => left.orderIndex - right.orderIndex)
        .map((item) => {
          const rule = ruleByTemplateExerciseId.get(item.id);
          const exercise = exerciseById.get(item.exerciseId);

          return {
            templateExerciseId: item.id,
            exerciseId: item.exerciseId,
            exerciseName: exercise?.name ?? UNKNOWN_EXERCISE_NAME,
            orderIndex: item.orderIndex,
            supersetGroupId: item.supersetGroupId,
            workSetCount: item.workSetCount,
            effective: foldProgressionRule(item, rule),
            overriddenFields: overriddenTargetFields(rule),
            trackingMode: exercise?.trackingMode,
            loadKind: exercise?.loadKind,
            tracksHeight: exercise?.tracksHeight,
            unilateral: exercise?.unilateral,
          };
        }),
    }));
}

/**
 * Ein Stück der Vorgabe-Zeile - Text plus die Auskunft, woher er kommt.
 *
 * Segmente statt eines Strings, damit ein Override **pro Feld** markiert
 * werden kann: `3 × 8–10` aus dem Workout, daneben `85 kg` aus der Woche. Ein
 * Badge über die ganze Zeile würde überzeichnen, wenn nur das Gewicht
 * wochenspezifisch ist.
 */
export interface PrescriptionSegment {
  text: string;
  /** Kommt dieser Wert aus der Wochenregel statt aus dem Workout? */
  overridden: boolean;
}

/**
 * Die Vorgabe einer Übung als Segmente.
 *
 * Die Formatregeln spiegeln `describeSetRowValues`: der Bandname schlägt die
 * Kilos, und die Höhe tritt an die Stelle der Last, wenn es sonst keine gibt -
 * sonst geht sie voran, weil sie die Bedingung ist, unter der die Last bewegt
 * wird. Jede Zahl läuft über `formatNumber`.
 */
export function describeWeekPrescription(
  entry: Pick<WeekPlanEntry, 'workSetCount' | 'effective' | 'overriddenFields'>,
  bandNameById?: Record<string, string | undefined>,
): PrescriptionSegment[] {
  const { effective, overriddenFields } = entry;
  const isOverridden = (...fields: FoldableTargetField[]) =>
    fields.some((field) => overriddenFields.includes(field));

  const segments: PrescriptionSegment[] = [];
  const perSet: string[] = [];

  if (typeof effective.targetReps === 'number') {
    perSet.push(`${describeRepRange(effective.targetReps, effective.targetRepsMax)} Wdh`);
  }

  if (typeof effective.targetSeconds === 'number') {
    perSet.push(`${formatNumber(effective.targetSeconds)} s`);
  }

  if (entry.workSetCount > 0) {
    segments.push({
      text: perSet.length > 0 ? `${entry.workSetCount} × ${perSet.join(' ')}` : `${entry.workSetCount} Sätze`,
      overridden: isOverridden('targetReps', 'targetRepsMax', 'targetSeconds'),
    });
  }

  const bandName = effective.targetBandId
    ? // Ein Band, das der Katalog nicht kennt, kostet den Namen, nicht die
      // Zeile - dasselbe Zugeständnis wie beim `bandNameSnapshot` im Satz.
      (bandNameById?.[effective.targetBandId] ?? 'Band')
    : undefined;
  const weightLabel =
    typeof effective.targetWeight === 'number' ? `${formatNumber(effective.targetWeight)} kg` : undefined;
  const heightLabel =
    typeof effective.targetHeightCm === 'number' ? `${formatNumber(effective.targetHeightCm)} cm` : undefined;

  if (heightLabel && (bandName || weightLabel)) {
    segments.push({ text: heightLabel, overridden: isOverridden('targetHeightCm') });
  }

  if (bandName) {
    segments.push({ text: bandName, overridden: isOverridden('targetBandId') });
  } else if (weightLabel) {
    segments.push({ text: weightLabel, overridden: isOverridden('targetWeight') });
  } else if (heightLabel) {
    segments.push({ text: heightLabel, overridden: isOverridden('targetHeightCm') });
  }

  return segments;
}
