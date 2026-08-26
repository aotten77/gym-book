import Dexie, { type Table } from 'dexie';
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

class GymBookDatabase extends Dexie {
  exercises!: Table<Exercise, string>;
  workoutTemplates!: Table<WorkoutTemplate, string>;
  workoutTemplateExercises!: Table<WorkoutTemplateExercise, string>;
  workoutSessions!: Table<WorkoutSession, string>;
  workoutSessionExercises!: Table<WorkoutSessionExercise, string>;
  workoutSetLogs!: Table<WorkoutSetLog, string>;
  exerciseTests!: Table<ExerciseTest, string>;
  programs!: Table<Program, string>;
  programWeeks!: Table<ProgramWeek, string>;
  progressionRules!: Table<ProgressionRule, string>;
  mediaAssets!: Table<MediaAsset, string>;
  appSettings!: Table<AppSettings, string>;
  bandLevels!: Table<BandLevel, string>;
  libraryImports!: Table<LibraryImportLog, string>;

  constructor() {
    super('gym-book-db');

    this.version(1).stores({
      exercises: 'id, name, updatedAt',
      workoutTemplates: 'id, name, updatedAt',
      workoutTemplateExercises: 'id, templateId, exerciseId, orderIndex',
      workoutSessions: 'id, templateId, status, startedAt, completedAt',
      workoutSessionExercises: 'id, sessionId, exerciseId, orderIndex, wasSkipped',
      workoutSetLogs: 'id, sessionExerciseId, setKind, side, setNumber, completed',
      exerciseTests: 'id, exerciseId, recordedAt',
      programs: 'id, activeWeek, updatedAt',
      programWeeks: 'id, programId, weekNumber',
      progressionRules: 'id, templateExerciseId, programWeekId',
      mediaAssets: 'id, mimeType, createdAt',
      appSettings: 'id, activeProgramId, updatedAt',
    });

    // v2 räumt Indizes auf, die nie greifen konnten, und indiziert die Pfade,
    // auf denen bisher ganze Tabellen gescannt wurden.
    //
    // `wasSkipped` und `completed` waren tot: IndexedDB akzeptiert Booleans
    // nicht als Keys, solche Datensätze landen gar nicht erst im Index -
    // sie kosteten nur Pflegeaufwand bei jedem Write.
    //
    // Neue Felder auf bestehenden Objekten (`restTimers` auf WorkoutSession,
    // `supersetGroupId` auf Template- und Session-Übung) brauchen keine
    // Migration: Dexie speichert das ganze Objekt, unabhängig von den
    // deklarierten Indizes.
    this.version(2).stores({
      exercises: 'id, name, updatedAt, mediaAssetId',
      workoutSessionExercises: 'id, sessionId, exerciseId, orderIndex',
      workoutSetLogs: 'id, sessionExerciseId, setKind, side, setNumber',
      programWeeks: 'id, programId, weekNumber, [programId+weekNumber]',
      progressionRules: 'id, templateExerciseId, programWeekId, [templateExerciseId+programWeekId]',
      programs: 'id, activeWeek, updatedAt, name, createdAt',
    });

    // v3 bringt den Band-Katalog. Eine neue Tabelle muss deklariert werden,
    // die neuen Felder auf Übung, Session-Übung und Satz dagegen nicht - aus
    // demselben Grund wie oben bei `restTimers`. Ein `upgrade()` gibt es
    // deshalb nicht: es ist nichts umzuformen, Bestandsübungen bleiben ohne
    // `loadKind` schlicht Kilo-Übungen.
    this.version(3).stores({
      bandLevels: 'id, orderIndex, name',
    });

    // v4 bringt das Protokoll der Bibliotheks-Importe. Wieder nur eine neue
    // Tabelle und kein `upgrade()`: `Program.startedOn` kommt im selben Zug
    // dazu, braucht aber keinen Index - Dexie speichert das ganze Objekt.
    // Indiziert ist nur `importedAt`, weil die Anzeige nach Zeit sortiert.
    this.version(4).stores({
      libraryImports: 'id, importedAt',
    });
  }
}

export const db = new GymBookDatabase();
