import { describe, expect, it } from 'vitest';
import { describeSyncStatus } from '@/domain/sync-status';

describe('describeSyncStatus', () => {
  it('zählt nur, was nach dem letzten Senden passiert ist', () => {
    const s = describeSyncStatus({
      lastCopiedAt: '2026-11-12T18:00:00.000Z',
      sessionsCompletedAt: [
        '2026-11-11T10:00:00.000Z',
        '2026-11-13T10:00:00.000Z',
        '2026-11-17T09:00:00.000Z',
      ],
      runDates: ['2026-11-15'],
      testRecordedAt: ['2026-11-15T08:00:00.000Z'],
    });

    expect(s).toMatchObject({ neverSent: false, sessions: 2, runs: 1, tests: 1 });
    expect(s.text).toBe('Seitdem: 2 Einheiten, 1 Lauf, 1 Test.');
  });

  it('sagt „Noch nie gesendet.“ ohne Zeitstempel', () => {
    expect(
      describeSyncStatus({ sessionsCompletedAt: [], runDates: [], testRecordedAt: [] }).text,
    ).toBe('Noch nie gesendet.');
  });

  it('sagt „Seitdem nichts Neues.“ bei null überall', () => {
    const s = describeSyncStatus({
      lastCopiedAt: '2026-11-12T18:00:00.000Z',
      sessionsCompletedAt: ['2026-11-10T10:00:00.000Z'],
      runDates: ['2026-11-11'],
      testRecordedAt: [],
    });

    expect(s).toMatchObject({ neverSent: false, sessions: 0, runs: 0, tests: 0 });
    expect(s.text).toBe('Seitdem nichts Neues.');
  });

  it('lässt Teile mit 0 weg und beugt Singular und Plural', () => {
    const s = describeSyncStatus({
      lastCopiedAt: '2026-11-12T18:00:00.000Z',
      sessionsCompletedAt: ['2026-11-13T10:00:00.000Z'],
      runDates: ['2026-11-13', '2026-11-14'],
      testRecordedAt: [],
    });

    expect(s.text).toBe('Seitdem: 1 Einheit, 2 Läufe.');
  });

  it('zählt einen Lauf am selben lokalen Tag mit, am Vortag nicht', () => {
    const lastCopiedAt = new Date(2026, 10, 12, 18).toISOString();
    const s = describeSyncStatus({
      lastCopiedAt,
      sessionsCompletedAt: [],
      runDates: ['2026-11-11', '2026-11-12'],
      testRecordedAt: [],
    });

    expect(s.runs).toBe(1);
  });
});
