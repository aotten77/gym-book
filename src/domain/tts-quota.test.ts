import { describe, expect, it } from 'vitest';
import {
  announcementKey,
  countChars,
  createQuota,
  maskApiKey,
  quotaCostUsd,
  quotaFits,
  quotaOver,
  utcMonthKey,
} from '@/domain/tts-quota';

describe('utcMonthKey', () => {
  it('liest den Monat in UTC, nicht in Ortszeit', () => {
    expect(utcMonthKey(new Date('2026-11-30T23:59:59.000Z'))).toBe('2026-11');
    expect(utcMonthKey(new Date('2026-12-01T00:00:00.000Z'))).toBe('2026-12');
    expect(utcMonthKey(new Date('2027-01-01T00:00:00.000Z'))).toBe('2027-01');
  });
});

describe('Quota', () => {
  const chars = { '2026-11': 400_000, '2026-10': 999_999 };

  it('zieht den Verbrauch des Monats vom Freikontingent ab', () => {
    const quota = createQuota(chars, new Date('2026-11-15T10:00:00.000Z'), 1_000_000, 30);
    expect(quota.freeLeft).toBe(600_000);
    expect(quotaFits(quota, 600_000)).toBe(true);
    expect(quotaFits(quota, 600_001)).toBe(false);
  });

  it('beginnt mit dem Monatswechsel bei null', () => {
    const quota = createQuota(chars, new Date('2026-12-01T00:00:00.000Z'), 1_000_000, 30);
    expect(quota.freeLeft).toBe(1_000_000);
  });

  it('wird nie negativ, wenn schon mehr verbraucht wurde', () => {
    const quota = createQuota({ '2026-11': 2_000_000 }, new Date('2026-11-02T00:00:00.000Z'), 1_000_000, 30);
    expect(quota.freeLeft).toBe(0);
    expect(quotaOver(quota, 10)).toBe(10);
  });

  it('rechnet Überschuss und Kosten', () => {
    const quota = createQuota(chars, new Date('2026-11-15T10:00:00.000Z'), 1_000_000, 30);
    expect(quotaOver(quota, 500_000)).toBe(0);
    expect(quotaOver(quota, 700_000)).toBe(100_000);
    expect(quotaCostUsd(quota, 700_000)).toBe(3);
    expect(quotaCostUsd(quota, 600_000)).toBe(0);
  });
});

describe('countChars', () => {
  it('zählt Zeichen, nicht UTF-16-Einheiten', () => {
    expect(countChars('Taube, links')).toBe(12);
    expect(countChars('😀a')).toBe(2);
  });
});

describe('maskApiKey', () => {
  it('zeigt nur die letzten vier Zeichen', () => {
    expect(maskApiKey('PLATZHALTER-1234')).toBe('••••1234');
  });

  it('verrät bei sehr kurzen Schlüsseln nichts', () => {
    expect(maskApiKey('abc')).toBe('••••');
  });
});

describe('announcementKey', () => {
  it('trennt Stimme und Satz', () => {
    expect(announcementKey('Hallo', 'v1')).not.toBe(announcementKey('Hallo', 'v2'));
    expect(announcementKey('Hallo', 'v1')).toBe(announcementKey('Hallo', 'v1'));
  });
});
