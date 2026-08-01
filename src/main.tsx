import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './index.css';
import { watchScreenOrientation } from '@/lib/orientation';
import { useUiStore } from '@/store/ui-store';

/** Abstand zwischen zwei aktiven Update-Prüfungen. */
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

/*
 * Mit registerType: 'prompt' (siehe vite.config.ts) feuert `onNeedRefresh`
 * tatsächlich, sobald eine neue Version bereitliegt. Der Nutzer entscheidet
 * dann über das Banner, wann aktualisiert wird - nicht der Service Worker
 * mitten im Satz.
 */
const updateServiceWorker = registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) {
      return;
    }

    /*
     * Ohne diese Prüfung erschien das Update-Banner praktisch nie: Ein Service
     * Worker sucht nur beim Laden der Seite nach einer neuen Version, und eine
     * Homescreen-App auf iOS liegt tagelang im App-Switcher, ohne je neu zu
     * laden. Wer aktualisieren wollte, musste die App löschen - und verlor
     * dabei die komplette IndexedDB, weil iOS den Speicher-Container einer
     * Web-App mit dem Icon zusammen entfernt.
     */
    const checkForUpdate = () => {
      if (document.visibilityState !== 'visible') {
        return;
      }

      void registration.update().catch((error) => {
        // Offline ist der Normalfall dieser App, kein Fehler fürs Log.
        if (navigator.onLine) {
          console.error('Update-Prüfung fehlgeschlagen', error);
        }
      });
    };

    checkForUpdate();
    document.addEventListener('visibilitychange', checkForUpdate);
    window.setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
  },
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

/*
 * Muss vor dem ersten Rendern laufen: das CSS liest den Winkel, um die App im
 * Querformat in die richtige Richtung zurückzudrehen.
 */
watchScreenOrientation();

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
