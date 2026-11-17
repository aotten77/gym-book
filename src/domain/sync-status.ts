import { parseLocalDate } from '@/domain/calendar-week';

export interface SyncStatusInput {
  /** Zeitpunkt des letzten Kopierens für Claude (ISO). */
  lastCopiedAt?: string;
  /** `completedAt` der abgeschlossenen Einheiten. */
  sessionsCompletedAt: string[];
  /** Lokale Tage (`YYYY-MM-DD`) der Läufe. */
  runDates: string[];
  /** Zeitpunkte, an denen Tests erfasst wurden (ISO). */
  testRecordedAt: string[];
}

export interface SyncStatus {
  neverSent: boolean;
  sessions: number;
  runs: number;
  tests: number;
  text: string;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Was seit dem letzten Senden an Claude dazugekommen ist.
 *
 * Rein und ohne Uhr: der Zeitpunkt kommt als Parameter. Einheiten und Tests
 * tragen einen Zeitstempel und zählen, wenn er nach dem Senden liegt. Ein Lauf
 * kennt nur den lokalen Tag, deshalb zählt er schon am selben Tag mit - am
 * Senden-Tag selbst lässt sich nicht sagen, ob er davor oder danach war, und
 * ein zu viel gezählter Lauf kostet weniger als ein verschwiegener.
 * `parseLocalDate` statt `new Date('YYYY-MM-DD')`: Letzteres ist UTC-Mitternacht
 * und landet westlich von Greenwich einen Tag zu früh.
 */
export function describeSyncStatus(input: SyncStatusInput): SyncStatus {
  const lastCopied = input.lastCopiedAt ? parseLocalDate(input.lastCopiedAt) : undefined;

  if (!lastCopied) {
    return { neverSent: true, sessions: 0, runs: 0, tests: 0, text: 'Noch nie gesendet.' };
  }

  const sentAt = lastCopied.getTime();
  const sentDay = new Date(
    lastCopied.getFullYear(),
    lastCopied.getMonth(),
    lastCopied.getDate(),
  ).getTime();

  const isAfter = (iso: string) => {
    const date = parseLocalDate(iso);
    return date !== undefined && date.getTime() > sentAt;
  };

  const sessions = input.sessionsCompletedAt.filter(isAfter).length;
  const tests = input.testRecordedAt.filter(isAfter).length;
  const runs = input.runDates.filter((value) => {
    const day = parseLocalDate(value);
    return day !== undefined && day.getTime() >= sentDay;
  }).length;

  const parts = [
    sessions > 0 ? plural(sessions, 'Einheit', 'Einheiten') : '',
    runs > 0 ? plural(runs, 'Lauf', 'Läufe') : '',
    tests > 0 ? plural(tests, 'Test', 'Tests') : '',
  ].filter(Boolean);

  return {
    neverSent: false,
    sessions,
    runs,
    tests,
    text: parts.length > 0 ? `Seitdem: ${parts.join(', ')}.` : 'Seitdem nichts Neues.',
  };
}
