import { describe, expect, it, vi } from 'vitest';
import { ACCESS_LOGIN_PATH, checkAccessSession } from '@/lib/access-session';

function respond(init: { type?: ResponseType; ok?: boolean; redirected?: boolean }) {
  return vi.fn(async () => ({
    type: init.type ?? 'basic',
    ok: init.ok ?? true,
    redirected: init.redirected ?? false,
  })) as unknown as typeof fetch;
}

describe('checkAccessSession', () => {
  it('erkennt die Umleitung zur Anmeldung', async () => {
    await expect(checkAccessSession(respond({ type: 'opaqueredirect', ok: false }))).resolves.toBe(
      'expired',
    );
    await expect(checkAccessSession(respond({ redirected: true }))).resolves.toBe('expired');
  });

  it('meldet eine gültige Sitzung', async () => {
    await expect(checkAccessSession(respond({}))).resolves.toBe('ok');
  });

  it('wertet einen Netzwerkfehler nicht als abgemeldet - offline ist der Normalfall', async () => {
    const offline = vi.fn(async () => {
      throw new TypeError('Load failed');
    }) as unknown as typeof fetch;

    await expect(checkAccessSession(offline)).resolves.toBe('unknown');
  });

  it('hält einen Serverfehler ebenfalls offen', async () => {
    await expect(checkAccessSession(respond({ ok: false }))).resolves.toBe('unknown');
  });

  it('fragt sw.js ohne Zwischenspeicher und ohne der Umleitung zu folgen', async () => {
    const fetchImpl = respond({});
    await checkAccessSession(fetchImpl);

    const [url, init] = vi.mocked(fetchImpl).mock.calls[0];
    expect(String(url)).toMatch(/^\/sw\.js\?access-check=\d+$/);
    expect(init).toMatchObject({ redirect: 'manual', cache: 'no-store' });
  });

  it('meldet den Anmeldeweg, den der Service Worker durchlassen muss', () => {
    // Muss zur navigateFallbackDenylist in vite.config.ts passen.
    expect(ACCESS_LOGIN_PATH).toBe('/?reauth=1');
  });
});
