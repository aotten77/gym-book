import { describe, expect, it } from 'vitest';
import { isInCalendarWeek, startOfCalendarWeek } from '@/domain/calendar-week';

/*
 * Alle Daten werden lokal konstruiert (`new Date(jahr, monat, tag, ...)`) und
 * nicht als UTC-Zeichenkette: die Kalenderwoche ist die des Geräts, und ein
 * Test, der über UTC läuft, prüft in Berlin etwas anderes als in London.
 */

describe('startOfCalendarWeek', () => {
  it('returns the monday of the same week at midnight', () => {
    // Mittwoch, 5. August 2026.
    const start = startOfCalendarWeek(new Date(2026, 7, 5, 14, 30));

    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(7);
    expect(start.getDate()).toBe(3);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);
    expect(start.getMilliseconds()).toBe(0);
  });

  it('keeps a monday where it is', () => {
    const start = startOfCalendarWeek(new Date(2026, 7, 3, 8, 0));
    expect(start.getDate()).toBe(3);
  });

  it('counts sunday to the week that ended, not the one starting', () => {
    // Sonntag, 9. August 2026 - der Wochenanfang ist der 3., nicht der 10.
    const start = startOfCalendarWeek(new Date(2026, 7, 9, 23, 59));
    expect(start.getDate()).toBe(3);
  });

  it('crosses month and year boundaries', () => {
    // Freitag, 1. Januar 2027 - die Woche begann am Montag, 28. Dezember 2026.
    const start = startOfCalendarWeek(new Date(2027, 0, 1, 12, 0));

    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(11);
    expect(start.getDate()).toBe(28);
  });

  it('does not modify the date it was given', () => {
    const now = new Date(2026, 7, 5, 14, 30);
    startOfCalendarWeek(now);
    expect(now.getDate()).toBe(5);
    expect(now.getHours()).toBe(14);
  });
});

describe('isInCalendarWeek', () => {
  const now = new Date(2026, 7, 5, 14, 30);

  it('accepts a timestamp from the same week', () => {
    expect(isInCalendarWeek(new Date(2026, 7, 3, 6, 0).toISOString(), now)).toBe(true);
    expect(isInCalendarWeek(new Date(2026, 7, 9, 23, 59, 59).toISOString(), now)).toBe(true);
  });

  it('rejects the sunday before and the monday after', () => {
    expect(isInCalendarWeek(new Date(2026, 7, 2, 23, 59, 59).toISOString(), now)).toBe(false);
    expect(isInCalendarWeek(new Date(2026, 7, 10, 0, 0, 0).toISOString(), now)).toBe(false);
  });

  it('treats an unparsable timestamp as outside instead of throwing', () => {
    expect(isInCalendarWeek('irgendwann', now)).toBe(false);
    expect(isInCalendarWeek('', now)).toBe(false);
  });
});
