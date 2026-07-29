import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './index.css';
import { useUiStore } from '@/store/ui-store';

/*
 * Mit registerType: 'prompt' (siehe vite.config.ts) feuert `onNeedRefresh`
 * tatsächlich, sobald eine neue Version bereitliegt. Der Nutzer entscheidet
 * dann über das Banner, wann aktualisiert wird - nicht der Service Worker
 * mitten im Satz.
 */
const updateServiceWorker = registerSW({
  immediate: true,
  onOfflineReady() {
    useUiStore.getState().setOfflineReady(true);
  },
  onNeedRefresh() {
    useUiStore.getState().setUpdateAvailable(true);
  },
  onRegisterError(error) {
    console.error('Service Worker konnte nicht registriert werden', error);
  },
});

useUiStore.getState().setOnlineStatus(window.navigator.onLine);

window.addEventListener('online', () => {
  useUiStore.getState().setOnlineStatus(true);
});

window.addEventListener('offline', () => {
  useUiStore.getState().setOnlineStatus(false);
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  useUiStore.getState().setDeferredInstallPrompt(
    event as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{
        outcome: 'accepted' | 'dismissed';
        platform: string;
      }>;
    },
  );
});

window.addEventListener('appinstalled', () => {
  useUiStore.getState().setDeferredInstallPrompt(null);
});

/*
 * Pinch-Zoom unterbinden.
 *
 * Safari im Tab ignoriert `user-scalable=no` seit iOS 10; nur diese drei
 * Gesture-Events stoppen den Zoom dort. In der installierten PWA greift
 * umgekehrt das Meta-Tag. `passive: false` ist Pflicht, sonst läuft
 * preventDefault ins Leere.
 */
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(
    type,
    (event) => {
      event.preventDefault();
    },
    { passive: false },
  );
}

window.addEventListener('gym-book:update-app', () => {
  void updateServiceWorker(true).catch((error) => {
    console.error('Update fehlgeschlagen', error);
    // Banner zurücksetzen, damit der Nutzer es erneut versuchen kann.
    useUiStore.getState().setUpdateAvailable(true);
  });
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
