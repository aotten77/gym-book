import { create } from 'zustand';

interface UiStoreState {
  activeSessionExerciseId: string | null;
  restTimerEndsAt: number | null;
  isOnline: boolean;
  isOfflineReady: boolean;
  isUpdateAvailable: boolean;
  deferredInstallPrompt: BeforeInstallPromptEvent | null;
  setActiveSessionExerciseId: (sessionExerciseId: string | null) => void;
  startRestTimer: (seconds: number) => void;
  clearRestTimer: () => void;
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
  restTimerEndsAt: null,
  isOnline: true,
  isOfflineReady: false,
  isUpdateAvailable: false,
  deferredInstallPrompt: null,
  setActiveSessionExerciseId: (activeSessionExerciseId) => set({ activeSessionExerciseId }),
  startRestTimer: (seconds) =>
    set({
      restTimerEndsAt: Date.now() + seconds * 1000,
    }),
  clearRestTimer: () => set({ restTimerEndsAt: null }),
  setOnlineStatus: (isOnline) => set({ isOnline }),
  setOfflineReady: (isOfflineReady) => set({ isOfflineReady }),
  setUpdateAvailable: (isUpdateAvailable) => set({ isUpdateAvailable }),
  setDeferredInstallPrompt: (deferredInstallPrompt) => set({ deferredInstallPrompt }),
}));
