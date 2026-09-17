import { describe, expect, it } from 'vitest';
import { formatBuildVersion, readBuildInfo, type BuildInfo } from '@/lib/build-info';

const BASE: BuildInfo = {
  commit: '95d2ccf16e9cd419c5c1bb227129fd4db52066ce',
  subject: 'Was im Training gebraucht wird, steht da, wo man hinsieht',
  committedAt: '2026-09-03T10:00:00+02:00',
  builtAt: '2026-09-03T10:05:00.000Z',
  dirty: false,
};

describe('formatBuildVersion', () => {
  it('kürzt auf den Hash, den git log --oneline zeigt', () => {
    expect(formatBuildVersion(BASE)).toBe('95d2ccf');
  });

  it('markiert einen lokalen Build mit offenen Änderungen', () => {
    expect(formatBuildVersion({ ...BASE, dirty: true })).toBe('95d2ccf+');
  });

  it('sagt ehrlich, wenn beim Build kein Git da war', () => {
    expect(formatBuildVersion({ ...BASE, commit: null })).toBe('unbekannt');
    expect(formatBuildVersion(null)).toBe('unbekannt');
  });
});

describe('readBuildInfo', () => {
  it('liefert ohne Vite-define null statt eines ReferenceError', () => {
    expect(readBuildInfo()).toBeNull();
  });
});
