import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './index.css';
import { useUiStore } from '@/store/ui-store';

const updateServiceWorker = registerSW({
  immediate: true,
  onOfflineReady() {
    useUiStore.getState().setOfflineReady(true);
  },
  onNeedRefresh() {
    useUiStore.getState().setUpdateAvailable(true);
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

window.addEventListener('gym-book:update-app', () => {
  void updateServiceWorker(true);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
