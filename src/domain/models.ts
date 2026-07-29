export type TrackingMode = 'reps_weight' | 'time' | 'time_weight';
export type SetKind = 'warmup' | 'work';
export type Side = 'both' | 'left' | 'right';
export type SessionStatus = 'active' | 'completed' | 'aborted';

export interface Exercise {
  id: string;
  name: string;
  instructions?: string;
  tempo?: string;
  trackingMode: TrackingMode;
  unilateral: boolean;
  mediaAssetId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkoutTemplate {
  id: string;
  name: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkoutTemplateExercise {
  id: string;
  templateId: string;
  exerciseId: string;
  orderIndex: number;
  workSetCount: number;
  /**
   * Ob beim Materialisieren ein Warmup-Satz entsteht.
   *
   * `undefined` zählt wie `true`: Datensätze, die vor der Einführung des
   * Schalters angelegt wurden, behalten damit ihr Warmup ohne Migration.
   */
  includeWarmup?: boolean;
  targetReps?: number;
  targetSeconds?: number;
  targetWeight?: number;
  restSeconds?: number;
  progressionRuleId?: string;
  notes?: string;
}

export interface WorkoutSession {
  id: string;
  templateId: string;
  templateNameSnapshot: string;
  programNameSnapshot?: string;
  programWeekLabelSnapshot?: string;
  usedWeekOverride?: boolean;
  resolvedProgramWeek: number;
  startedAt: string;
  completedAt?: string;
  status: SessionStatus;
  /**
   * Ablaufzeitpunkt des Pausentimers als Epoch-Millisekunden.
   *
   * Liegt bewusst in IndexedDB und nicht im UI-Store: der Timer muss einen
   * Reload und ein Service-Worker-Update mitten im Training überleben.
   */
  restTimerEndsAt?: number;
}

export interface WorkoutSessionExercise {
  id: string;
  sessionId: string;
  exerciseId: string;
  exerciseNameSnapshot: string;
  trackingMode: TrackingMode;
  unilateral: boolean;
  sourceTemplateExerciseId?: string;
  orderIndex: number;
  wasSkipped: boolean;
  addedInSession: boolean;
  workSetCount: number;
  targetReps?: number;
  targetSeconds?: number;
  targetWeight?: number;
  restSeconds?: number;
  notes?: string;
}

export interface WorkoutSetLog {
  id: string;
  sessionExerciseId: string;
  setKind: SetKind;
  side: Side;
  setNumber: number;
  reps?: number;
  seconds?: number;
  weight?: number;
  completed: boolean;
  completedAt?: string;
}

export interface ExerciseTest {
  id: string;
  exerciseId: string;
  exerciseNameSnapshot: string;
  recordedAt: string;
  leftValue: number;
  rightValue: number;
  asymmetryPercent: number;
  notes?: string;
}

export interface Program {
  id: string;
  name: string;
  activeWeek: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProgramWeek {
  id: string;
  programId: string;
  weekNumber: number;
  label?: string;
}

export interface ProgressionRule {
  id: string;
  templateExerciseId: string;
  programWeekId: string;
  targetReps?: number;
  targetSeconds?: number;
  targetWeight?: number;
  notes?: string;
}

export interface MediaAsset {
  id: string;
  mimeType: string;
  fileName: string;
  byteSize: number;
  blob?: Blob;
  createdAt: string;
}

export interface AppSettings {
  id: 'app-settings';
  activeProgramId?: string;
  weekOverride?: number;
  /**
   * Zeitpunkt der letzten erfolgreichen Sicherung.
   *
   * Grundlage der Backup-Erinnerung: die gesamte Historie liegt nur lokal, und
   * eine vom Homescreen geloeschte iOS-Web-App nimmt ihren Speicher mit.
   */
  lastBackupAt?: string;
  exportSchemaVersion: number;
  updatedAt: string;
}

export interface SessionBundle {
  session: WorkoutSession;
  sessionExercises: WorkoutSessionExercise[];
  setLogs: WorkoutSetLog[];
}
