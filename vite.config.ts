import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
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
        theme_color: '#09090b',
        background_color: '#09090b',
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
