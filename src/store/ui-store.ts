import { create } from 'zustand';

// Nur flüchtiger UI-Zustand. Alles, was einen Reload überleben muss -
// insbesondere der Pausentimer - liegt in IndexedDB, siehe session-actions.
interface UiStoreState {
  activeSessionExerciseId: string | null;
  isOnline: boolean;
  isOfflineReady: boolean;
  isUpdateAvailable: boolean;
  deferredInstallPrompt: BeforeInstallPromptEvent | null;
  setActiveSessionExerciseId: (sessionExerciseId: string | null) => void;
  setOnlineStatus: (isOnline: boolean) => void;
  setOfflineReady: (isOfflineReady: boolean) => void;
  setUpdateAvailable: (isUpdateAvailable: boolean) => void;
  setDeferredInstallPrompt: (event: BeforeInstallPromptEvent | null) => void;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
}

export const useUiStore = create<UiStoreState>((set) => ({
  activeSessionExerciseId: null,
  isOnline: true,
  isOfflineReady: false,
  isUpdateAvailable: false,
  deferredInstallPrompt: null,
  setActiveSessionExerciseId: (activeSessionExerciseId) => set({ activeSessionExerciseId }),
  setOnlineStatus: (isOnline) => set({ isOnline }),
  setOfflineReady: (isOfflineReady) => set({ isOfflineReady }),
  setUpdateAvailable: (isUpdateAvailable) => set({ isUpdateAvailable }),
  setDeferredInstallPrompt: (deferredInstallPrompt) => set({ deferredInstallPrompt }),
}));
