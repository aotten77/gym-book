import { describe, expect, it } from 'vitest';
import { activeNavTab } from './navigation';

describe('activeNavTab', () => {
  it.each([
    ['/', 'plan'],
    ['/history', 'progress'],
    ['/history/session/abc', 'progress'],
    ['/runs/x', 'progress'],
    ['/sync', 'sync'],
    ['/library', 'library'],
    ['/templates', 'library'],
    ['/templates/abc', 'library'],
    ['/exercises', 'library'],
    ['/programs/manage', 'library'],
    ['/bands', 'library'],
    ['/tests', 'library'],
    ['/settings', null],
  ])('%s gehört zu %s', (pathname, expected) => {
    expect(activeNavTab(pathname)).toBe(expected);
  });
});
