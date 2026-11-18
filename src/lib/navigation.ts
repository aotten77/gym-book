export type NavTab = 'plan' | 'progress' | 'sync' | 'library';

/** Pfad ist genau `base` oder liegt darunter (`base/...`). */
function isUnder(pathname: string, base: string) {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * Welcher Tab der Leiste zu einer Route gehört.
 *
 * `/programs/manage` ist Bestand, `/programs` dagegen Plan - deshalb wird der
 * Bestand zuerst geprüft. Einstellungen sitzen im Kopf, nicht in der Leiste,
 * und markieren darum keinen Tab.
 */
export function activeNavTab(pathname: string): NavTab | null {
  if (
    pathname === '/library' ||
    isUnder(pathname, '/templates') ||
    pathname === '/exercises' ||
    isUnder(pathname, '/programs/manage') ||
    pathname === '/bands' ||
    pathname === '/tests'
  ) {
    return 'library';
  }

  if (pathname === '/' || pathname === '/programs') return 'plan';
  if (isUnder(pathname, '/history') || isUnder(pathname, '/runs')) return 'progress';
  if (pathname === '/sync') return 'sync';

  return null;
}
