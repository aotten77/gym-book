/**
 * Ob die Cloudflare-Access-Sitzung noch gilt.
 *
 * Die App liegt hinter Access (siehe CLAUDE.md). Läuft die Sitzung ab,
 * antwortet Access auf jede Anfrage mit einer Umleitung zur Anmeldeseite -
 * auch auf die, mit der `registration.update()` nach einer neuen Version
 * sucht. Ein Service-Worker-Skript darf aber nicht umgeleitet werden, also
 * bricht die Prüfung mit einem `SecurityError` ab, und das Update-Banner
 * erscheint nie. Bemerkt wird davon nichts: der Worker bedient jede Navigation
 * aus dem Precache, die App erreicht Access deshalb gar nicht mehr und
 * erneuert das Cookie auch nie. Ohne Hilfe von außen kommt sie da nicht raus.
 *
 * Dieses Modul stellt genau das fest und macht es sichtbar.
 */

/**
 * Die Adresse, über die sich die App neu anmeldet.
 *
 * Der Parameter ist kein Schmuck: `navigateFallbackDenylist` in
 * [vite.config.ts] nimmt genau ihn aus der Navigations-Route des Service
 * Workers heraus. Sonst beantwortete der Worker auch diesen Aufruf aus dem
 * Precache, die Anfrage erreichte Cloudflare nie, und die Anmeldung könnte gar
 * nicht stattfinden. Nach dem Login führt Access auf dieselbe Adresse zurück,
 * die dann - ebenfalls am Worker vorbei - frisch aus dem Netz kommt.
 */
export const ACCESS_LOGIN_PATH = '/?reauth=1';

/**
 * Die Sonde.
 *
 * `sw.js` ist bewusst das Ziel: genau diese Datei holt `registration.update()`,
 * also scheitert die Sonde an demselben Hindernis wie das Update - und an
 * keinem anderen. Sie ist weder im Precache noch eine Navigation, der Service
 * Worker fasst sie deshalb nicht an. Der Parameter hängt nur dran, damit kein
 * Zwischenspeicher antwortet.
 */
const PROBE_PATH = '/sw.js';

export type AccessSessionState = 'ok' | 'expired' | 'unknown';

/**
 * `unknown` ist der ehrliche dritte Fall.
 *
 * Offline zu sein ist der Normalzustand dieser App und kein abgelaufener
 * Login. Eine fehlgeschlagene Anfrage darf deshalb nie als "abgemeldet"
 * gelten - sonst stünde das Banner im Studio ohne Empfang.
 */
export async function checkAccessSession(
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<AccessSessionState> {
  try {
    const response = await fetchImpl(`${PROBE_PATH}?access-check=${Date.now()}`, {
      /*
       * `manual` macht die Umleitung überhaupt erst sichtbar: mit dem
       * Standardwert `follow` liefe die Anfrage der Anmeldeseite hinterher und
       * käme mit einem freundlichen 200 zurück, das nichts über die Sitzung
       * sagt. So bleibt sie als `opaqueredirect` stehen - dieselbe Umleitung,
       * an der die Update-Prüfung scheitert.
       */
      redirect: 'manual',
      cache: 'no-store',
      credentials: 'same-origin',
    });

    if (response.type === 'opaqueredirect' || response.redirected) {
      return 'expired';
    }

    return response.ok ? 'ok' : 'unknown';
  } catch {
    return 'unknown';
  }
}
