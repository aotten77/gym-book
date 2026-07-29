export interface BackupStatusInput {
  /** Zeitpunkt der letzten erfolgreichen Sicherung, ISO-String. */
  lastBackupAt?: string;
  /** `completedAt` aller abgeschlossenen Sessions. */
  completedSessionDates: string[];
  now: string;
}

export interface BackupStatus {
  /** Abgeschlossene Trainings, die in keiner Sicherung stecken. */
  unsavedSessionCount: number;
  /** Tage seit der letzten Sicherung, `undefined` wenn es keine gibt. */
  daysSinceBackup?: number;
  needsReminder: boolean;
}

const DAY_IN_MS = 86_400_000;

/**
 * Beurteilt, ob eine Sicherung fällig ist.
 *
 * Maßstab sind nicht verstrichene Tage, sondern ungesicherte Trainings: nur
 * die können verloren gehen. Wer zwei Wochen nicht trainiert hat, braucht
 * keine Erinnerung; wer gestern trainiert und nie exportiert hat, sehr wohl.
 *
 * Der Anlass ist real: eine vom Homescreen gelöschte iOS-Web-App nimmt ihren
 * gesamten Speicher-Container mit, und die Trainingshistorie liegt
 * ausschließlich dort.
 */
export function evaluateBackupStatus({
  lastBackupAt,
  completedSessionDates,
  now,
}: BackupStatusInput): BackupStatus {
  const unsavedSessionCount = completedSessionDates.filter(
    (completedAt) => !lastBackupAt || completedAt > lastBackupAt,
  ).length;

  const daysSinceBackup = lastBackupAt
    ? Math.max(0, Math.floor((Date.parse(now) - Date.parse(lastBackupAt)) / DAY_IN_MS))
    : undefined;

  return {
    unsavedSessionCount,
    daysSinceBackup,
    needsReminder: unsavedSessionCount > 0,
  };
}
