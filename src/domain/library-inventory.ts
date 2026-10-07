import type {
  BandLevel,
  Exercise,
  LoadKind,
  Program,
  ProgramWeek,
  ProgressionRule,
  TrackingMode,
  WorkoutTemplate,
  WorkoutTemplateExercise,
} from '@/domain/models';
import { resolveWorkoutCategory, type WorkoutCategory } from '@/domain/workout-category';

/*
 * `bestand.json` im Analyse-Export: der heutige Stand der Bibliothek, in den
 * Feldnamen des Bibliotheks-Imports.
 *
 * Der Analyse-Export beschreibt, was trainiert wurde - nicht, was geplant ist.
 * Wer daraus eine Import-Datei schreibt, braucht aber genau das: die exakten
 * Namen aller Übungen samt `trackingMode` und `unilateral` (Pflicht in jedem
 * Übungseintrag, ein falscher Wert stellt die Übung um), die Zusammensetzung
 * der Workouts mit `orderIndex` und `workSetCount` (Pflicht in jeder
 * Zuordnung) und die Wochenregeln, die einen Zielwert überdecken. Fehlt das,
 * wird geraten, und Raten heißt hier: Übungen still umstellen.
 *
 * Drei Entscheidungen tragen die Datei:
 *
 * - **Dieselben Feldnamen wie der Import**, damit Zeilen ohne Übersetzung in
 *   eine Import-Datei wandern. Der Test liest den Bestand als Import mit
 *   `replaceAssignments` wieder ein und verlangt "unverändert" - das ist der
 *   Beweis, nicht die Behauptung.
 * - **Kein `schemaVersion`**, damit die App die Datei ablehnt, falls sie
 *   jemand unverändert importiert.
 * - **Keine Ids**, wie im ganzen Analyse-Export. Supersätze heißen je Workout
 *   `S1`, `S2` … in der Reihenfolge ihres Auftretens; der Import erwartet
 *   genau so einen frei gewählten Gruppennamen.
 *
 * `targetBand` gibt es im Import nicht - das Ziel-Band setzt man in der App.
 * Es steht hier, weil eine Planung wissen muss, womit die Übung läuft; der
 * Import ignoriert den Schlüssel.
 */

export interface LibraryInventoryInput {
  exercises: Exercise[];
  templates: WorkoutTemplate[];
  templateExercises: WorkoutTemplateExercise[];
  bandLevels: BandLevel[];
  /** Das aktive Programm, oder `undefined`. */
  program?: Program;
  programWeeks: ProgramWeek[];
  progressionRules: ProgressionRule[];
}

export interface InventoryExercise {
  name: string;
  trackingMode: TrackingMode;
  unilateral: boolean;
  loadKind?: LoadKind;
  tracksHeight?: true;
  tempo?: string;
  instructions?: string;
}

export interface InventoryTemplate {
  name: string;
  category: WorkoutCategory;
  notes?: string;
}

interface InventoryTargets {
  targetReps?: number;
  targetRepsMax?: number;
  targetSeconds?: number;
  targetWeight?: number;
  targetHeightCm?: number;
  /** Name des Bands - nur zur Auskunft, siehe oben. */
  targetBand?: string;
}

export interface InventoryAssignment extends InventoryTargets {
  template: string;
  exercise: string;
  orderIndex: number;
  workSetCount: number;
  includeWarmup?: false;
  restSeconds?: number;
  notes?: string;
  superset?: string;
}

export interface InventoryRule extends InventoryTargets {
  template: string;
  exercise: string;
  workSetCount?: number;
  notes?: string;
}

export interface InventoryWeek {
  woche: number;
  label?: string;
  kind?: 'deload' | 'test';
  regeln: InventoryRule[];
}

export interface LibraryInventory {
  hinweis: string;
  exercises: InventoryExercise[];
  templates: InventoryTemplate[];
  templateAssignments: InventoryAssignment[];
  bandLevels: Array<{ name: string; orderIndex: number }>;
  programm: { name: string; startedOn?: string; wochen: InventoryWeek[] } | null;
}

export const LIBRARY_INVENTORY_NOTE =
  'Heutiger Stand der Bibliothek in den Feldnamen des Bibliotheks-Imports – kein Import (schemaVersion fehlt absichtlich). ' +
  'Zeilen lassen sich in eine Import-Datei übernehmen; targetBand und programm sind nur Auskunft, beides setzt man in der App.';

const byName = (left: { name: string }, right: { name: string }) =>
  left.name.localeCompare(right.name, 'de');

/** Schreibt nur gesetzte Werte - ein fehlender Schlüssel heißt im Import "unverändert". */
function defined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

export function buildLibraryInventory(input: LibraryInventoryInput): LibraryInventory {
  const exerciseNames = new Map(input.exercises.map((item) => [item.id, item.name]));
  const bandNames = new Map(input.bandLevels.map((item) => [item.id, item.name]));
  const templates = [...input.templates].sort(byName);
  const bandName = (id?: string) => (id ? bandNames.get(id) : undefined);

  const templateAssignments: InventoryAssignment[] = [];
  // Für die Regeln: Zuordnung → Workout, Übung und Rang in der Gesamtreihenfolge.
  const assignmentInfo = new Map<string, { template: string; exercise: string; rank: number }>();

  for (const template of templates) {
    const rows = input.templateExercises
      .filter((item) => item.templateId === template.id && exerciseNames.has(item.exerciseId))
      .sort((left, right) => left.orderIndex - right.orderIndex);
    const groups: string[] = [];

    rows.forEach((row, index) => {
      const exercise = exerciseNames.get(row.exerciseId) ?? '';
      let superset: string | undefined;

      if (row.supersetGroupId) {
        if (!groups.includes(row.supersetGroupId)) {
          groups.push(row.supersetGroupId);
        }

        superset = `S${groups.indexOf(row.supersetGroupId) + 1}`;
      }

      assignmentInfo.set(row.id, { template: template.name, exercise, rank: templateAssignments.length });
      templateAssignments.push(
        defined<InventoryAssignment>({
          template: template.name,
          exercise,
          // Dicht ab 1, so wie die Workout-Ansicht die Reihenfolge zeigt.
          orderIndex: index + 1,
          workSetCount: row.workSetCount,
          includeWarmup: row.includeWarmup === false ? false : undefined,
          targetReps: row.targetReps,
          targetRepsMax: row.targetRepsMax,
          targetSeconds: row.targetSeconds,
          targetWeight: row.targetWeight,
          targetHeightCm: row.targetHeightCm,
          targetBand: bandName(row.targetBandId),
          restSeconds: row.restSeconds,
          notes: row.notes,
          superset,
        }),
      );
    });
  }

  return {
    hinweis: LIBRARY_INVENTORY_NOTE,
    exercises: [...input.exercises].sort(byName).map((item) =>
      defined<InventoryExercise>({
        name: item.name,
        trackingMode: item.trackingMode,
        unilateral: item.unilateral,
        loadKind: item.loadKind === 'band' ? 'band' : undefined,
        tracksHeight: item.tracksHeight ? true : undefined,
        tempo: item.tempo,
        instructions: item.instructions,
      }),
    ),
    templates: templates.map((item) =>
      defined<InventoryTemplate>({
        name: item.name,
        category: resolveWorkoutCategory(item.category),
        notes: item.notes,
      }),
    ),
    templateAssignments,
    bandLevels: [...input.bandLevels]
      .sort((left, right) => left.orderIndex - right.orderIndex)
      .map((item) => ({ name: item.name, orderIndex: item.orderIndex })),
    programm: input.program ? describeProgram(input, input.program, assignmentInfo, bandName) : null,
  };
}

function describeProgram(
  input: LibraryInventoryInput,
  program: Program,
  assignmentInfo: Map<string, { template: string; exercise: string; rank: number }>,
  bandName: (id?: string) => string | undefined,
) {
  const wochen = input.programWeeks
    .filter((week) => week.programId === program.id)
    .sort((left, right) => left.weekNumber - right.weekNumber)
    .map((week) => {
      const regeln = input.progressionRules
        .filter((rule) => rule.programWeekId === week.id && assignmentInfo.has(rule.templateExerciseId))
        .map((rule) => ({ rule, info: assignmentInfo.get(rule.templateExerciseId)! }))
        .sort((left, right) => left.info.rank - right.info.rank)
        .map(({ rule, info }) =>
          defined<InventoryRule>({
            template: info.template,
            exercise: info.exercise,
            workSetCount: rule.workSetCount,
            targetReps: rule.targetReps,
            targetRepsMax: rule.targetRepsMax,
            targetSeconds: rule.targetSeconds,
            targetWeight: rule.targetWeight,
            targetHeightCm: rule.targetHeightCm,
            targetBand: bandName(rule.targetBandId),
            notes: rule.notes,
          }),
        );

      return defined<InventoryWeek>({ woche: week.weekNumber, label: week.label, kind: week.kind, regeln });
    });

  return defined({ name: program.name, startedOn: program.startedOn, wochen });
}
