export type TrackingMode = 'reps_weight' | 'time' | 'time_weight';
export type SetKind = 'warmup' | 'work';
export type Side = 'both' | 'left' | 'right';
export type SessionStatus = 'active' | 'completed' | 'aborted';

/**
 * Womit eine Übung belastet wird.
 *
 * `undefined` zählt wie `'weight'`: alles, was vor der Einführung der Bänder
 * angelegt wurde, bleibt eine Kilo-Übung, ohne dass ein Datensatz angefasst
 * werden muss.
 */
export type LoadKind = 'weight' | 'band';

/**
 * Eine Stufe des Band-Katalogs.
 *
 * `orderIndex` ist die Reihenfolge von leicht nach schwer und damit die
 * einzige Quelle für "stärker als" - ein Band hat keine Zahl, an der sich
 * Fortschritt sonst ablesen ließe.
 */
export interface BandLevel {
  id: string;
  name: string;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
}

export interface Exercise {
  id: string;
  name: string;
  instructions?: string;
  tempo?: string;
  trackingMode: TrackingMode;
  /** Siehe [LoadKind]: `undefined` bedeutet Gewicht in Kilo. */
  loadKind?: LoadKind;
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
  /**
   * Gemeinsame Kennung aller Übungen eines Supersatzes.
   *
   * Mitglieder einer Gruppe liegen immer zusammenhängend im `orderIndex` -
   * geprüft von `areGroupsContiguous` in [superset.ts]. Ohne diese Zusage
   * ließe sich eine Gruppe weder als Block darstellen noch am Stück bewegen.
   */
  supersetGroupId?: string;
  targetReps?: number;
  targetSeconds?: number;
  targetWeight?: number;
  /** Ziel-Band bei Band-Übungen - die Entsprechung zu `targetWeight`. */
  targetBandId?: string;
  restSeconds?: number;
  progressionRuleId?: string;
  notes?: string;
}

/**
 * Laufender Satz-Timer, z. B. für einen Plank über zwei Minuten.
 *
 * Genau einer pro Session: mehr als eine Zeitübung gleichzeitig gibt es nicht,
 * und ein einzelner Datensatz macht das Beenden eindeutig.
 */
export interface SetTimerState {
  /** Satzzeile, deren Zeit gemessen wird - dorthin fließt das Ergebnis. */
  setLogId: string;
  /** Ablaufzeitpunkt als Epoch-Millisekunden. */
  endsAt: number;
  /** Gestartete Dauer in Sekunden, Grundlage der abgelaufenen Zeit. */
  durationSeconds: number;
}

/**
 * Eine laufende Pause - für genau eine Übung und eine Seite.
 *
 * Mehrere davon laufen gleichzeitig, und das ist der ganze Zweck: im Supersatz
 * läuft die Pause der ersten Übung weiter, während die zweite ausgeführt wird,
 * und bei einer einseitigen Übung pausiert rechts, während links trainiert.
 * Der frühere `restTimerEndsAt` konnte beides nicht, weil ein einzelner
 * Zeitstempel pro Session keinen Besitzer hatte und jeder abgehakte Satz ihn
 * überschrieb.
 */
export interface RestTimerTrack {
  sessionExerciseId: string;
  side: Side;
  /** Ablaufzeitpunkt als Epoch-Millisekunden. */
  endsAt: number;
  /** Gestartete Dauer in Sekunden - Grundlage der Fortschrittsanzeige. */
  durationSeconds: number;
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
   * Alle laufenden Pausen.
   *
   * Liegt bewusst in IndexedDB und nicht im UI-Store: die Timer müssen einen
   * Reload und ein Service-Worker-Update mitten im Training überleben.
   */
  restTimers?: RestTimerTrack[];
  /**
   * Timer für einen Satz auf Zeit.
   *
   * Liegt aus demselben Grund wie [restTimers] in IndexedDB: ein Plank über
   * zwei Minuten überdauert Bildschirmsperre, Reload und
   * Service-Worker-Update.
   */
  setTimer?: SetTimerState;
}

export interface WorkoutSessionExercise {
  id: string;
  sessionId: string;
  exerciseId: string;
  exerciseNameSnapshot: string;
  trackingMode: TrackingMode;
  loadKind?: LoadKind;
  unilateral: boolean;
  sourceTemplateExerciseId?: string;
  orderIndex: number;
  /**
   * Supersatz-Kennung als Snapshot - siehe [WorkoutTemplateExercise].
   *
   * Wird beim Start aus dem Template kopiert und danach unabhängig gepflegt:
   * eine Verbindung in der laufenden Session zu lösen, darf den Plan nicht
   * anfassen.
   */
  supersetGroupId?: string;
  wasSkipped: boolean;
  addedInSession: boolean;
  workSetCount: number;
  targetReps?: number;
  targetSeconds?: number;
  targetWeight?: number;
  targetBandId?: string;
  /** Name des Ziel-Bands zum Zeitpunkt des Starts - siehe [WorkoutSetLog]. */
  targetBandNameSnapshot?: string;
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
  /** Gewähltes Band aus dem Katalog - trägt die Reihenfolge fürs Diagramm. */
  bandId?: string;
  /**
   * Name des Bands zum Zeitpunkt der Ausführung.
   *
   * Steht neben der Id, damit die Historie lesbar bleibt, wenn das Band später
   * umbenannt oder aus dem Katalog gelöscht wird: eine verwaiste Id kostet dann
   * nur den Punkt im Diagramm, nicht den Eintrag.
   */
  bandNameSnapshot?: string;
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
  targetBandId?: string;
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
