import { execSync } from 'node:child_process';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import { VitePWA } from 'vite-plugin-pwa';
import type { BuildInfo } from './src/lib/build-info';

function git(args: string): string | null {
  try {
    return execSync(`git ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/*
 * Der Stand, der ins Bundle geschrieben und in den Einstellungen angezeigt wird
 * - siehe src/lib/build-info.ts. Scheitert Git (kein Repo, kein Binary), baut
 * der Build trotzdem: eine fehlende Versionsanzeige ist kein Grund, nicht zu
 * deployen. Der Checkout in der Pages-Action ist flach, aber `-1` braucht auch
 * nur den einen Commit.
 */
const buildInfo: BuildInfo = {
  commit: git('rev-parse HEAD') ?? process.env.GITHUB_SHA ?? null,
  subject: git('log -1 --format=%s'),
  committedAt: git('log -1 --format=%cI'),
  builtAt: new Date().toISOString(),
  dirty: Boolean(git('status --porcelain')),
};

// https://vite.dev/config/
export default defineConfig({
  define: {
    __BUILD_INFO__: JSON.stringify(buildInfo),
  },
  // Die App liegt auf einer eigenen Subdomain (gym.andreasotten.de, siehe
  // public/CNAME), also im Wurzelverzeichnis - nicht mehr unter dem
  // GitHub-Pages-Projektpfad /gym-book/.
  base: '/',
  build: {
    sourcemap: 'hidden',
  },
  plugins: [
    react({
      babel: {
        plugins: ['react-dev-locator'],
      },
    }),
    tsconfigPaths(),
    VitePWA({
      /*
       * 'prompt' statt 'autoUpdate': autoUpdate erzeugt einen Service Worker
       * mit skipWaiting, wodurch `onNeedRefresh` nie feuert - das vorhandene
       * "Update verfügbar"-Banner war damit unerreichbarer toter Code, und
       * der neue Worker übernahm still, potenziell mitten in einer Session.
       */
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'Gym Book',
        short_name: 'Gym Book',
        description: 'Offline-first Trainingsprotokoll als installierbare PWA.',
        lang: 'de',
        theme_color: '#f2f2ef',
        background_color: '#f2f2ef',
        display: 'standalone',
        // 'portrait' erlaubt beide Hochformat-Lagen; 'portrait-primary' legt
        // sich auf eine fest - dort, wo der Browser die Sperre umsetzt.
        orientation: 'portrait-primary',
        scope: '/',
        start_url: '/#/',
        categories: ['health', 'fitness', 'productivity'],
        icons: [
          {
            src: '/pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            // Ohne maskable setzt Android das Icon in einen weißen Kreis.
            src: '/pwa-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
        shortcuts: [
          { name: 'Historie', url: '/#/history' },
          { name: 'Vorlagen', url: '/#/templates' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
      },
    }),
  ],
});
