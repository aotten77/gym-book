import { describe, expect, it } from 'vitest';
import { evaluateBackupStatus } from '@/domain/backup';

describe('evaluateBackupStatus', () => {
  it('zählt nur Trainings, die nach der letzten Sicherung abgeschlossen wurden', () => {
    const status = evaluateBackupStatus({
      lastBackupAt: '2026-07-10T10:00:00.000Z',
      completedSessionDates: [
        '2026-07-08T18:00:00.000Z',
        '2026-07-12T18:00:00.000Z',
        '2026-07-14T18:00:00.000Z',
      ],
      now: '2026-07-15T08:00:00.000Z',
    });

    expect(status.unsavedSessionCount).toBe(2);
    expect(status.daysSinceBackup).toBe(4);
    expect(status.needsReminder).toBe(true);
  });

  it('erinnert nicht, wenn seit der Sicherung nichts trainiert wurde', () => {
    const status = evaluateBackupStatus({
      lastBackupAt: '2026-07-14T10:00:00.000Z',
      completedSessionDates: ['2026-07-08T18:00:00.000Z'],
      now: '2026-07-29T08:00:00.000Z',
    });

    // Auch nach zwei Wochen ohne Sicherung: es gibt schlicht nichts zu
    // verlieren, was nicht schon gesichert wäre.
    expect(status.needsReminder).toBe(false);
    // 14 Tage und 22 Stunden - angebrochene Tage zählen nicht mit.
    expect(status.daysSinceBackup).toBe(14);
  });

  it('behandelt eine fehlende Sicherung als ungesichert', () => {
    const status = evaluateBackupStatus({
      completedSessionDates: ['2026-07-08T18:00:00.000Z'],
      now: '2026-07-09T08:00:00.000Z',
    });

    expect(status.unsavedSessionCount).toBe(1);
    expect(status.daysSinceBackup).toBeUndefined();
    expect(status.needsReminder).toBe(true);
  });

  it('erinnert ohne abgeschlossene Trainings nicht', () => {
    const status = evaluateBackupStatus({
      completedSessionDates: [],
      now: '2026-07-09T08:00:00.000Z',
    });

    expect(status.needsReminder).toBe(false);
  });
});
