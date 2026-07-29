import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
  base: '/gym-book/',
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
       * "Update verfuegbar"-Banner war damit unerreichbarer toter Code, und
       * der neue Worker uebernahm still, potenziell mitten in einer Session.
       */
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: '/gym-book/',
        name: 'Gym Book',
        short_name: 'Gym Book',
        description: 'Offline-first Trainingsprotokoll als installierbare PWA.',
        lang: 'de',
        theme_color: '#09090b',
        background_color: '#09090b',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/gym-book/',
        start_url: '/gym-book/#/',
        categories: ['health', 'fitness', 'productivity'],
        icons: [
          {
            src: '/gym-book/pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/gym-book/pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            // Ohne maskable setzt Android das Icon in einen weissen Kreis.
            src: '/gym-book/pwa-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/gym-book/favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
        shortcuts: [
          { name: 'Historie', url: '/gym-book/#/history' },
          { name: 'Vorlagen', url: '/gym-book/#/templates' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
      },
    }),
  ],
});
