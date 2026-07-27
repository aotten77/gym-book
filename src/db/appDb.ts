import Dexie, { type Table } from 'dexie';
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
  }
}

export const db = new GymBookDatabase();
