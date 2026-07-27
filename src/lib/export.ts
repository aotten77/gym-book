import { z } from 'zod';
import { db } from '@/db/appDb';
import type {
  AppSettings,
  Exercise,
  ExerciseTest,
  MediaAsset,
  Program,
  ProgramWeek,
  ProgressionRule,
  WorkoutSession,
  WorkoutSessionExercise,
  WorkoutSetLog,
  WorkoutTemplate,
  WorkoutTemplateExercise,
} from '@/domain/models';

export const SNAPSHOT_SCHEMA_VERSION = 1;

const trackingModeSchema = z.enum(['reps_weight', 'time', 'time_weight']);
const setKindSchema = z.enum(['warmup', 'work']);
const sideSchema = z.enum(['both', 'left', 'right']);
const sessionStatusSchema = z.enum(['active', 'completed', 'aborted']);

const exerciseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  instructions: z.string().optional(),
  tempo: z.string().optional(),
  trackingMode: trackingModeSchema,
  unilateral: z.boolean(),
  mediaAssetId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const workoutTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  notes: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const workoutTemplateExerciseSchema = z.object({
  id: z.string().min(1),
  templateId: z.string().min(1),
  exerciseId: z.string().min(1),
  orderIndex: z.number().int().positive(),
  workSetCount: z.number().int().positive(),
  targetReps: z.number().nonnegative().optional(),
  targetSeconds: z.number().nonnegative().optional(),
  targetWeight: z.number().nonnegative().optional(),
  restSeconds: z.number().nonnegative().optional(),
  progressionRuleId: z.string().optional(),
  notes: z.string().optional(),
});

const workoutSessionSchema = z.object({
  id: z.string().min(1),
  templateId: z.string().min(1),
  templateNameSnapshot: z.string().min(1),
  resolvedProgramWeek: z.number().int().positive(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  status: sessionStatusSchema,
});

const workoutSessionExerciseSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  exerciseId: z.string().min(1),
  exerciseNameSnapshot: z.string().min(1),
  trackingMode: trackingModeSchema,
  unilateral: z.boolean(),
  sourceTemplateExerciseId: z.string().optional(),
  orderIndex: z.number().int().positive(),
  wasSkipped: z.boolean(),
  addedInSession: z.boolean(),
  workSetCount: z.number().int().positive(),
  targetReps: z.number().nonnegative().optional(),
  targetSeconds: z.number().nonnegative().optional(),
  targetWeight: z.number().nonnegative().optional(),
  restSeconds: z.number().nonnegative().optional(),
  notes: z.string().optional(),
});

const workoutSetLogSchema = z.object({
  id: z.string().min(1),
  sessionExerciseId: z.string().min(1),
  setKind: setKindSchema,
  side: sideSchema,
  setNumber: z.number().int().nonnegative(),
  reps: z.number().nonnegative().optional(),
  seconds: z.number().nonnegative().optional(),
  weight: z.number().nonnegative().optional(),
  completed: z.boolean(),
  completedAt: z.string().optional(),
});

const exerciseTestSchema = z.object({
  id: z.string().min(1),
  exerciseId: z.string().min(1),
  exerciseNameSnapshot: z.string().min(1),
  recordedAt: z.string(),
  leftValue: z.number().nonnegative(),
  rightValue: z.number().nonnegative(),
  asymmetryPercent: z.number().nonnegative(),
  notes: z.string().optional(),
});

const programSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  activeWeek: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const programWeekSchema = z.object({
  id: z.string().min(1),
  programId: z.string().min(1),
  weekNumber: z.number().int().positive(),
  label: z.string().optional(),
});

const progressionRuleSchema = z.object({
  id: z.string().min(1),
  templateExerciseId: z.string().min(1),
  programWeekId: z.string().min(1),
  targetReps: z.number().nonnegative().optional(),
  targetSeconds: z.number().nonnegative().optional(),
  targetWeight: z.number().nonnegative().optional(),
  notes: z.string().optional(),
});

const mediaAssetSchema = z
  .object({
    id: z.string().min(1),
    mimeType: z.string().min(1),
    fileName: z.string().min(1),
    byteSize: z.number().int().nonnegative(),
    blob: z.unknown().optional(),
    createdAt: z.string(),
  })
  .transform((asset) => ({
    id: asset.id,
    mimeType: asset.mimeType,
    fileName: asset.fileName,
    byteSize: asset.byteSize,
    createdAt: asset.createdAt,
  }));

const appSettingsSchema = z.object({
  id: z.literal('app-settings'),
  activeProgramId: z.string().optional(),
  weekOverride: z.number().int().positive().optional(),
  exportSchemaVersion: z.number().int().positive(),
  updatedAt: z.string(),
});

const databaseSnapshotSchema = z.object({
  schemaVersion: z.literal(SNAPSHOT_SCHEMA_VERSION),
  exportedAt: z.string(),
  exercises: z.array(exerciseSchema),
  workoutTemplates: z.array(workoutTemplateSchema),
  workoutTemplateExercises: z.array(workoutTemplateExerciseSchema),
  workoutSessions: z.array(workoutSessionSchema),
  workoutSessionExercises: z.array(workoutSessionExerciseSchema),
  workoutSetLogs: z.array(workoutSetLogSchema),
  exerciseTests: z.array(exerciseTestSchema),
  programs: z.array(programSchema),
  programWeeks: z.array(programWeekSchema),
  progressionRules: z.array(progressionRuleSchema),
  mediaAssets: z.array(mediaAssetSchema),
  appSettings: z.array(appSettingsSchema),
});

export interface DatabaseSnapshot {
  schemaVersion: number;
  exportedAt: string;
  exercises: Exercise[];
  workoutTemplates: WorkoutTemplate[];
  workoutTemplateExercises: WorkoutTemplateExercise[];
  workoutSessions: WorkoutSession[];
  workoutSessionExercises: WorkoutSessionExercise[];
  workoutSetLogs: WorkoutSetLog[];
  exerciseTests: ExerciseTest[];
  programs: Program[];
  programWeeks: ProgramWeek[];
  progressionRules: ProgressionRule[];
  mediaAssets: MediaAsset[];
  appSettings: AppSettings[];
}

export interface DatabaseSnapshotSummary {
  exercises: number;
  templates: number;
  sessions: number;
  setLogs: number;
  tests: number;
  mediaAssets: number;
}

async function createDatabaseSnapshot(): Promise<DatabaseSnapshot> {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    exercises: await db.exercises.toArray(),
    workoutTemplates: await db.workoutTemplates.toArray(),
    workoutTemplateExercises: await db.workoutTemplateExercises.toArray(),
    workoutSessions: await db.workoutSessions.toArray(),
    workoutSessionExercises: await db.workoutSessionExercises.toArray(),
    workoutSetLogs: await db.workoutSetLogs.toArray(),
    exerciseTests: await db.exerciseTests.toArray(),
    programs: await db.programs.toArray(),
    programWeeks: await db.programWeeks.toArray(),
    progressionRules: await db.progressionRules.toArray(),
    mediaAssets: await db.mediaAssets.toArray(),
    appSettings: await db.appSettings.toArray(),
  };
}

export function parseDatabaseSnapshot(json: string): DatabaseSnapshot {
  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Die JSON-Datei konnte nicht gelesen werden.');
  }

  const result = databaseSnapshotSchema.safeParse(parsed);

  if (!result.success) {
    const issue = result.error.issues[0];
    const location = issue.path.length > 0 ? issue.path.join('.') : 'snapshot';
    throw new Error(`Import-Datei ungueltig bei ${location}: ${issue.message}`);
  }

  return result.data as DatabaseSnapshot;
}

export function summarizeDatabaseSnapshot(snapshot: DatabaseSnapshot): DatabaseSnapshotSummary {
  return {
    exercises: snapshot.exercises.length,
    templates: snapshot.workoutTemplates.length,
    sessions: snapshot.workoutSessions.length,
    setLogs: snapshot.workoutSetLogs.length,
    tests: snapshot.exerciseTests.length,
    mediaAssets: snapshot.mediaAssets.length,
  };
}

export async function restoreDatabaseSnapshot(snapshot: DatabaseSnapshot) {
  await db.transaction(
    'rw',
    [
      db.exercises,
      db.workoutTemplates,
      db.workoutTemplateExercises,
      db.workoutSessions,
      db.workoutSessionExercises,
      db.workoutSetLogs,
      db.exerciseTests,
      db.programs,
      db.programWeeks,
      db.progressionRules,
      db.mediaAssets,
      db.appSettings,
    ],
    async () => {
      await db.workoutSetLogs.clear();
      await db.workoutSessionExercises.clear();
      await db.workoutSessions.clear();
      await db.progressionRules.clear();
      await db.programWeeks.clear();
      await db.exerciseTests.clear();
      await db.workoutTemplateExercises.clear();
      await db.workoutTemplates.clear();
      await db.exercises.clear();
      await db.programs.clear();
      await db.mediaAssets.clear();
      await db.appSettings.clear();

      if (snapshot.exercises.length) {
        await db.exercises.bulkAdd(snapshot.exercises);
      }

      if (snapshot.workoutTemplates.length) {
        await db.workoutTemplates.bulkAdd(snapshot.workoutTemplates);
      }

      if (snapshot.workoutTemplateExercises.length) {
        await db.workoutTemplateExercises.bulkAdd(snapshot.workoutTemplateExercises);
      }

      if (snapshot.workoutSessions.length) {
        await db.workoutSessions.bulkAdd(snapshot.workoutSessions);
      }

      if (snapshot.workoutSessionExercises.length) {
        await db.workoutSessionExercises.bulkAdd(snapshot.workoutSessionExercises);
      }

      if (snapshot.workoutSetLogs.length) {
        await db.workoutSetLogs.bulkAdd(snapshot.workoutSetLogs);
      }

      if (snapshot.exerciseTests.length) {
        await db.exerciseTests.bulkAdd(snapshot.exerciseTests);
      }

      if (snapshot.programs.length) {
        await db.programs.bulkAdd(snapshot.programs);
      }

      if (snapshot.programWeeks.length) {
        await db.programWeeks.bulkAdd(snapshot.programWeeks);
      }

      if (snapshot.progressionRules.length) {
        await db.progressionRules.bulkAdd(snapshot.progressionRules);
      }

      if (snapshot.mediaAssets.length) {
        await db.mediaAssets.bulkAdd(snapshot.mediaAssets);
      }

      if (snapshot.appSettings.length) {
        await db.appSettings.bulkAdd(snapshot.appSettings);
      }
    },
  );
}

export async function exportDatabaseSnapshot() {
  const snapshot = await createDatabaseSnapshot();
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `gym-book-export-${snapshot.exportedAt.slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
