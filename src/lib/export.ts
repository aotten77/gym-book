import { z } from 'zod';
import { db } from '@/db/appDb';
import { blobToDataUrl, dataUrlToBlob, isSupportedMediaType } from '@/lib/media';
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
  /*
   * Rein additives Feld: alte Backups ohne den Schlüssel bleiben gültig, und
   * neue Dateien laufen in älteren App-Ständen weiter durch. Deshalb bleibt
   * SNAPSHOT_SCHEMA_VERSION hier bewusst unverändert - ein Bump würde über
   * das z.literal jedes bestehende Nutzer-Backup abweisen.
   */
  includeWarmup: z.boolean().optional(),
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
  programNameSnapshot: z.string().optional(),
  programWeekLabelSnapshot: z.string().optional(),
  usedWeekOverride: z.boolean().optional(),
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
    blobDataUrl: z.string().optional(),
    blob: z.unknown().optional(),
    createdAt: z.string(),
  })
  .transform((asset) => ({
    id: asset.id,
    mimeType: asset.mimeType,
    fileName: asset.fileName,
    byteSize: asset.byteSize,
    blob: asset.blobDataUrl ? dataUrlToBlob(asset.blobDataUrl) : undefined,
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

/**
 * Prüft, ob alle Verweise innerhalb des Snapshots auflösbar sind.
 *
 * Der Vertrag verlangt Validierung auf Schema-Version, referentielle
 * Integrität und unterstützte Medientypen - umgesetzt war nur die Version.
 * Ein Template mit fehlender Übung lässt `materializeSession` werfen: der
 * Nutzer merkt das erst Wochen später im Gym, wenn die Kachel nicht reagiert.
 */
function assertReferentialIntegrity(snapshot: DatabaseSnapshot) {
  const ids = {
    exercises: new Set(snapshot.exercises.map((item) => item.id)),
    templates: new Set(snapshot.workoutTemplates.map((item) => item.id)),
    templateExercises: new Set(snapshot.workoutTemplateExercises.map((item) => item.id)),
    sessions: new Set(snapshot.workoutSessions.map((item) => item.id)),
    sessionExercises: new Set(snapshot.workoutSessionExercises.map((item) => item.id)),
    programs: new Set(snapshot.programs.map((item) => item.id)),
    programWeeks: new Set(snapshot.programWeeks.map((item) => item.id)),
    mediaAssets: new Set(snapshot.mediaAssets.map((item) => item.id)),
  };

  const problems: string[] = [];

  const check = (
    condition: boolean,
    message: string,
  ) => {
    if (!condition && problems.length < 5) {
      problems.push(message);
    }
  };

  for (const item of snapshot.workoutTemplateExercises) {
    check(ids.templates.has(item.templateId), `Vorlagen-Übung ${item.id} verweist auf eine fehlende Vorlage`);
    check(ids.exercises.has(item.exerciseId), `Vorlagen-Übung ${item.id} verweist auf eine fehlende Übung`);
  }

  for (const item of snapshot.workoutSessionExercises) {
    check(ids.sessions.has(item.sessionId), `Session-Übung ${item.id} verweist auf eine fehlende Session`);
  }

  for (const item of snapshot.workoutSetLogs) {
    check(
      ids.sessionExercises.has(item.sessionExerciseId),
      `Satz ${item.id} verweist auf eine fehlende Session-Übung`,
    );
  }

  for (const item of snapshot.progressionRules) {
    check(
      ids.templateExercises.has(item.templateExerciseId),
      `Progressionsregel ${item.id} verweist auf eine fehlende Vorlagen-Übung`,
    );
    check(
      ids.programWeeks.has(item.programWeekId),
      `Progressionsregel ${item.id} verweist auf eine fehlende Programmwoche`,
    );
  }

  for (const item of snapshot.programWeeks) {
    check(ids.programs.has(item.programId), `Programmwoche ${item.id} verweist auf ein fehlendes Programm`);
  }

  for (const item of snapshot.exercises) {
    check(
      !item.mediaAssetId || ids.mediaAssets.has(item.mediaAssetId),
      `Übung ${item.name} verweist auf ein fehlendes Bild`,
    );
  }

  for (const item of snapshot.appSettings) {
    check(
      !item.activeProgramId || ids.programs.has(item.activeProgramId),
      'Die Einstellungen verweisen auf ein fehlendes aktives Programm',
    );
  }

  if (problems.length > 0) {
    throw new Error(`Import-Datei ist in sich nicht schlüssig: ${problems.join('; ')}.`);
  }
}

function assertSupportedMedia(snapshot: DatabaseSnapshot) {
  const unsupported = snapshot.mediaAssets.find((asset) => !isSupportedMediaType(asset.mimeType));

  if (unsupported) {
    throw new Error(
      `Medientyp "${unsupported.mimeType}" wird nicht unterstützt (${unsupported.fileName}). Erlaubt sind JPG, PNG, GIF und WebP.`,
    );
  }
}

export function parseDatabaseSnapshot(json: string): DatabaseSnapshot {
  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Die JSON-Datei konnte nicht gelesen werden.');
  }

  // Version zuerst prüfen, damit die Meldung erklärt, was los ist, statt
  // einen generischen Schemafehler zu zeigen.
  const version = (parsed as { schemaVersion?: unknown } | null)?.schemaVersion;

  if (typeof version === 'number' && version !== SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(
      version > SNAPSHOT_SCHEMA_VERSION
        ? `Diese Datei stammt aus einer neueren App-Version (Format ${version}, unterstützt wird ${SNAPSHOT_SCHEMA_VERSION}).`
        : `Diese Datei nutzt ein älteres Format (${version}) und kann nicht importiert werden.`,
    );
  }

  const result = databaseSnapshotSchema.safeParse(parsed);

  if (!result.success) {
    const issue = result.error.issues[0];
    const location = issue.path.length > 0 ? issue.path.join('.') : 'snapshot';
    throw new Error(`Import-Datei ungültig bei ${location}: ${issue.message}`);
  }

  const snapshot = result.data as DatabaseSnapshot;

  assertSupportedMedia(snapshot);
  assertReferentialIntegrity(snapshot);

  return snapshot;
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
  const serializableSnapshot = {
    ...snapshot,
    mediaAssets: await Promise.all(
      snapshot.mediaAssets.map(async (asset) => ({
        id: asset.id,
        mimeType: asset.mimeType,
        fileName: asset.fileName,
        byteSize: asset.byteSize,
        blobDataUrl: asset.blob ? await blobToDataUrl(asset.blob) : undefined,
        createdAt: asset.createdAt,
      })),
    ),
  };
  const blob = new Blob([JSON.stringify(serializableSnapshot)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `gym-book-export-${snapshot.exportedAt.slice(0, 10)}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Erst im nächsten Tick freigeben - ein synchrones revoke bricht den
  // Download je nach Browser und Dateigröße ab.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
