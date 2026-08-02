import { create } from 'zustand';

// Nur flüchtiger UI-Zustand. Alles, was einen Reload überleben muss -
// insbesondere der Pausentimer - liegt in IndexedDB, siehe session-actions.
interface UiStoreState {
  activeSessionExerciseId: string | null;
  /**
   * Der Block, dessen Fokus-Sheet gerade offen ist - `null` heißt Liste.
   *
   * Bewusst flüchtig und nicht in IndexedDB: ob ein Sheet offen war, ist keine
   * Trainingsinformation. Nach einem Neustart landet man in der Liste, während
   * die Timer weiterlaufen - die hängen an der Session.
   */
  openSessionBlockKey: string | null;
  isOnline: boolean;
  isOfflineReady: boolean;
  isUpdateAvailable: boolean;
  deferredInstallPrompt: BeforeInstallPromptEvent | null;
  setActiveSessionExerciseId: (sessionExerciseId: string | null) => void;
  setOpenSessionBlockKey: (blockKey: string | null) => void;
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
  openSessionBlockKey: null,
  isOnline: true,
  isOfflineReady: false,
  isUpdateAvailable: false,
  deferredInstallPrompt: null,
  setActiveSessionExerciseId: (activeSessionExerciseId) => set({ activeSessionExerciseId }),
  setOpenSessionBlockKey: (openSessionBlockKey) => set({ openSessionBlockKey }),
  setOnlineStatus: (isOnline) => set({ isOnline }),
  setOfflineReady: (isOfflineReady) => set({ isOfflineReady }),
  setUpdateAvailable: (isUpdateAvailable) => set({ isUpdateAvailable }),
  setDeferredInstallPrompt: (deferredInstallPrompt) => set({ deferredInstallPrompt }),
}));
