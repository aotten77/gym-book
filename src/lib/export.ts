import { z } from 'zod';
import { db } from '@/db/appDb';
import { markBackupCreated } from '@/db/settings-actions';
import {
  buildAnalysisExport,
  buildAnalysisPasteText,
  type AnalysisExportFiles,
} from '@/domain/analysis-export';
import { resolveWeekControl, toDateInputValue } from '@/domain/program';
import { blobToDataUrl, dataUrlToBlob, isSupportedMediaType } from '@/lib/media';
import { createZipArchive } from '@/lib/zip';
import type {
  AppSettings,
  BandLevel,
  Exercise,
  ExerciseTest,
  LibraryImportLog,
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
const loadKindSchema = z.enum(['weight', 'band']);
const setKindSchema = z.enum(['warmup', 'work']);
const sideSchema = z.enum(['both', 'left', 'right']);
const sessionStatusSchema = z.enum(['active', 'completed', 'aborted']);

const exerciseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  instructions: z.string().optional(),
  tempo: z.string().optional(),
  trackingMode: trackingModeSchema,
  // Additiv wie includeWarmup: fehlt der Schlüssel, ist es eine Kilo-Übung.
  loadKind: loadKindSchema.optional(),
  /* Additiv wie loadKind: ohne den Schlüssel schreibt die Übung keine Höhe. */
  tracksHeight: z.boolean().optional(),
  /* Additiv wie loadKind: Wiederholungsempfehlung, Vorlage fürs Zuordnen. */
  defaultTargetReps: z.number().nonnegative().optional(),
  /* Additiv wie loadKind: fehlt der Schlüssel, schlägt die Übung Steigerung vor. */
  suggestProgression: z.boolean().optional(),
  unilateral: z.boolean(),
  mediaAssetId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const bandLevelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  orderIndex: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const workoutTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  notes: z.string().optional(),
  /*
   * Additiv wie includeWarmup - siehe workoutTemplateExerciseSchema unten:
   * kein Bump von SNAPSHOT_SCHEMA_VERSION, sonst wiese das z.literal jedes
   * bestehende Nutzer-Backup ab.
   */
  scheduledWeekdays: z.array(z.number().int().min(1).max(7)).optional(),
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
  /* Additiv wie includeWarmup - siehe der Kommentar darüber. */
  supersetGroupId: z.string().optional(),
  targetReps: z.number().nonnegative().optional(),
  /* Additiv wie includeWarmup - obere Wiederholungsspanne, kein Bump. */
  targetRepsMax: z.number().nonnegative().optional(),
  targetSeconds: z.number().nonnegative().optional(),
  targetWeight: z.number().nonnegative().optional(),
  targetBandId: z.string().optional(),
  targetHeightCm: z.number().nonnegative().optional(),
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
  loadKind: loadKindSchema.optional(),
  tracksHeight: z.boolean().optional(),
  /* Snapshot von Exercise.suggestProgression - additiv, kein Bump. */
  suggestProgression: z.boolean().optional(),
  unilateral: z.boolean(),
  sourceTemplateExerciseId: z.string().optional(),
  orderIndex: z.number().int().positive(),
  /* Additiv wie includeWarmup oben - kein Bump der Schemaversion. */
  supersetGroupId: z.string().optional(),
  wasSkipped: z.boolean(),
  addedInSession: z.boolean(),
  workSetCount: z.number().int().positive(),
  targetReps: z.number().nonnegative().optional(),
  /* Additiv wie includeWarmup - obere Wiederholungsspanne, kein Bump. */
  targetRepsMax: z.number().nonnegative().optional(),
  targetSeconds: z.number().nonnegative().optional(),
  targetWeight: z.number().nonnegative().optional(),
  targetBandId: z.string().optional(),
  targetBandNameSnapshot: z.string().optional(),
  targetHeightCm: z.number().nonnegative().optional(),
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
  bandId: z.string().optional(),
  bandNameSnapshot: z.string().optional(),
  heightCm: z.number().nonnegative().optional(),
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
  /* Additiv wie includeWarmup: ohne Startdatum bleibt es bei activeWeek. */
  startedOn: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/*
 * Das Protokoll der Bibliotheks-Importe gehört mit ins Backup: es ist die
 * einzige Auskunft darüber, wann welche Nutzlast hereinkam, und ein Restore
 * ohne diese Zeilen ließe die Bibliothek wie von selbst gewachsen aussehen.
 */
const libraryImportLogSchema = z.object({
  id: z.string().min(1),
  importedAt: z.string(),
  sourceName: z.string().optional(),
  payloadHash: z.string().min(1),
  createdExercises: z.number().int().nonnegative(),
  updatedExercises: z.number().int().nonnegative(),
  createdTemplates: z.number().int().nonnegative(),
  updatedTemplates: z.number().int().nonnegative(),
  createdAssignments: z.number().int().nonnegative(),
  updatedAssignments: z.number().int().nonnegative(),
  createdBandLevels: z.number().int().nonnegative(),
  updatedBandLevels: z.number().int().nonnegative(),
});

const programWeekSchema = z.object({
  id: z.string().min(1),
  programId: z.string().min(1),
  weekNumber: z.number().int().positive(),
  label: z.string().optional(),
  /* Additiv wie includeWarmup - rein beschreibend, kein Bump. */
  kind: z.enum(['deload', 'test']).optional(),
});

const progressionRuleSchema = z.object({
  id: z.string().min(1),
  templateExerciseId: z.string().min(1),
  programWeekId: z.string().min(1),
  /* Additiv - die Satzzahl der Woche, siehe der Kommentar bei includeWarmup. */
  workSetCount: z.number().int().positive().optional(),
  targetReps: z.number().nonnegative().optional(),
  /* Additiv wie includeWarmup - obere Wiederholungsspanne, kein Bump. */
  targetRepsMax: z.number().nonnegative().optional(),
  targetSeconds: z.number().nonnegative().optional(),
  targetWeight: z.number().nonnegative().optional(),
  targetBandId: z.string().optional(),
  targetHeightCm: z.number().nonnegative().optional(),
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
  // Additiv wie includeWarmup: ältere Backups kennen die Schlüssel nicht.
  lastBackupAt: z.string().optional(),
  timerSoundEnabled: z.boolean().optional(),
  keepScreenAwakeEnabled: z.boolean().optional(),
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
  // Ältere Backups kennen die Tabelle nicht - ohne Default käme der Import
  // mit einem Schemafehler zurück statt mit einem leeren Katalog.
  bandLevels: z.array(bandLevelSchema).optional().default([]),
  // Aus demselben Grund optional wie bandLevels, und aus demselben Grund ohne
  // Bump von SNAPSHOT_SCHEMA_VERSION: das z.literal würde sonst jedes
  // bestehende Nutzer-Backup abweisen.
  libraryImports: z.array(libraryImportLogSchema).optional().default([]),
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
  bandLevels: BandLevel[];
  libraryImports: LibraryImportLog[];
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
    bandLevels: await db.bandLevels.toArray(),
    libraryImports: await db.libraryImports.toArray(),
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

  // Bewusst ohne Prüfung auf `bandId`/`targetBandId`: ein aus dem Katalog
  // gelöschtes Band ist ein zulässiger Zustand, und ein Fehler hier würde
  // dem Nutzer den Import seines eigenen Backups verweigern. Dafür trägt
  // jeder Satz mit `bandNameSnapshot` seinen Bandnamen selbst.

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
      db.bandLevels,
      db.libraryImports,
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
      await db.bandLevels.clear();
      await db.libraryImports.clear();

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

      if (snapshot.bandLevels?.length) {
        await db.bandLevels.bulkAdd(snapshot.bandLevels);
      }

      if (snapshot.libraryImports?.length) {
        await db.libraryImports.bulkAdd(snapshot.libraryImports);
      }
    },
  );
}

export type ExportResult = 'shared' | 'downloaded' | 'cancelled';

interface ExportOptions {
  /**
   * Auf iOS ist der Download-Ordner einer Homescreen-App schwer auffindbar.
   * Über das Teilen-Menü landet die Datei stattdessen dort, wo sie hingehört:
   * in Dateien, iCloud Drive oder einem Chat.
   */
  preferShare?: boolean;
}

/**
 * Ob das Teilen-Menü der richtige Weg ist.
 *
 * Nur in der installierten App: dort ist der Download-Ordner auf iOS praktisch
 * unauffindbar. In einem normalen Tab ist der Download der erwartete Weg - und
 * `navigator.share` bliebe dort ohne Share-Sheet einfach hängen.
 */
function canShareSnapshot(file: File) {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true &&
    navigator.canShare?.({ files: [file] }) === true
  );
}

function downloadSnapshotFile(file: File) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Erst im nächsten Tick freigeben - ein synchrones revoke bricht den
  // Download je nach Browser und Dateigröße ab.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Bringt die Datei nach draußen - Teilen-Menü, sonst Download.
 *
 * Steht als eigener Schritt da, weil inzwischen zwei Exporte denselben Weg
 * gehen: die Sicherung und der Analyse-Export. Was sich unterscheidet, ist
 * ausschließlich, was danach passiert - nur die Sicherung ist eine Sicherung.
 */
async function deliverExportFile(
  file: File,
  title: string,
  options: ExportOptions,
): Promise<ExportResult> {
  if (options.preferShare && canShareSnapshot(file)) {
    try {
      await navigator.share({ files: [file], title });

      return 'shared';
    } catch (error) {
      // Abbruch im Teilen-Menü ist kein Fehler - aber auch keine Sicherung.
      if (error instanceof DOMException && error.name === 'AbortError') {
        return 'cancelled';
      }

      // Teilen kann auch scheitern (kein Ziel, Berechtigung); dann bleibt der
      // Download der verlässliche Weg.
      downloadSnapshotFile(file);
    }
  } else {
    downloadSnapshotFile(file);
  }

  return 'downloaded';
}

export async function exportDatabaseSnapshot(options: ExportOptions = {}): Promise<ExportResult> {
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
  const file = new File(
    [JSON.stringify(serializableSnapshot)],
    `gym-book-export-${snapshot.exportedAt.slice(0, 10)}.json`,
    { type: 'application/json' },
  );

  const result = await deliverExportFile(file, 'Gym Book Sicherung', options);

  if (result === 'cancelled') {
    return 'cancelled';
  }

  await markBackupCreated(snapshot.exportedAt);

  return result;
}

/**
 * Die vier Dateien und ihr Zeitstempel - gemeinsame Grundlage beider Wege
 * nach draußen (Archiv und Zwischenablage).
 *
 * Ausdrücklich **keine Sicherung**, und das gilt für beide: hier fehlt
 * `markBackupCreated`, das die Sicherung setzt. Das Datum der letzten
 * Sicherung treibt die Erinnerung auf der Startseite, und ein Export ohne
 * Bilder, ohne Ids und ohne die verworfenen Sessions könnte einen Verlust
 * nicht rückgängig machen. Wer ihn als Backup zählte, hätte eine Erinnerung
 * abgeschaltet, die vor genau diesem Datenverlust warnt.
 */
async function loadAnalysisFiles(): Promise<{ files: AnalysisExportFiles; exportedAt: Date }> {
  const exportedAt = new Date();
  const [
    exercises,
    sessions,
    sessionExercises,
    setLogs,
    bandLevels,
    tests,
    programs,
    programWeeks,
    settings,
  ] =
    await Promise.all([
      db.exercises.toArray(),
      db.workoutSessions.toArray(),
      db.workoutSessionExercises.toArray(),
      db.workoutSetLogs.toArray(),
      db.bandLevels.toArray(),
      db.exerciseTests.toArray(),
      db.programs.toArray(),
      db.programWeeks.toArray(),
      db.appSettings.get('app-settings'),
    ]);

  const program = settings?.activeProgramId
    ? programs.find((item) => item.id === settings.activeProgramId)
    : undefined;
  const files = buildAnalysisExport({
    exportedAt,
    exercises,
    sessions,
    sessionExercises,
    setLogs,
    bandLevels,
    tests,
    program,
    // Dieselbe Auflösung wie Start, Home und Einstellungen - die Rangfolge der
    // Woche hat genau eine Stelle, und der Export darf keine zweite werden.
    weekControl: resolveWeekControl(
      settings?.weekOverride,
      program,
      programWeeks.filter((week) => week.programId === program?.id),
      exportedAt,
    ),
  });

  return { files, exportedAt };
}

/** Der Analyse-Export als Archiv - vier Dateien, ein Teilen-Vorgang. */
export async function exportAnalysisSnapshot(options: ExportOptions = {}): Promise<ExportResult> {
  const { files, exportedAt } = await loadAnalysisFiles();

  const archive = createZipArchive(
    [
      { name: 'sessions.csv', content: files.sessionsCsv },
      { name: 'progression.csv', content: files.progressionCsv },
      { name: 'tests.csv', content: files.testsCsv },
      { name: 'meta.json', content: files.metaJson },
    ],
    exportedAt,
  );
  const file = new File(
    [archive],
    `gym-book-analyse-${toDateInputValue(exportedAt)}.zip`,
    { type: 'application/zip' },
  );

  return deliverExportFile(file, 'Gym Book Analyse', options);
}

/**
 * Derselbe Inhalt als Text in der Zwischenablage.
 *
 * Diese Funktion ist bewusst **nicht `async`**, und das ist die ganze Pointe:
 * WebKit gibt den Schreibzugriff auf die Zwischenablage nur innerhalb der
 * Nutzergeste frei, und ein `await` davor beendet die Geste.
 * `navigator.clipboard.writeText(await ...)` scheitert auf dem iPhone still,
 * während es im Desktop-Chrome funktioniert - dieselbe Klasse Fehler wie bei
 * `prepareMediaAsset`, wo der File vor der Dexie-Transaktion gelesen werden
 * muss, weil ein `await` sie schließt.
 *
 * Der Ausweg ist `ClipboardItem` mit einem **Promise** als Wert: der Aufruf
 * passiert synchron in der Geste, die Daten dürfen nachkommen - Safari
 * unterstützt Promises genau an dieser Stelle. Wer das hier zu einer
 * `async`-Funktion mit `await` davor "vereinfacht", nimmt dem iPhone die
 * Funktion, ohne dass ein Test es merkt.
 */
export function copyAnalysisSnapshot(): Promise<void> {
  const text = loadAnalysisFiles().then(({ files, exportedAt }) =>
    buildAnalysisPasteText(files, exportedAt),
  );

  if (typeof ClipboardItem === 'function') {
    return navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': text.then((value) => new Blob([value], { type: 'text/plain' })),
      }),
    ]);
  }

  // Ohne `ClipboardItem` gibt es die Geste-Einschränkung auch nicht.
  return text.then((value) => navigator.clipboard.writeText(value));
}
