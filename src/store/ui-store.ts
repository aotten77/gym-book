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
  /**
   * Die Pause, deren Ruhemodus zum Reiter zusammengeklappt ist.
   *
   * Der Schlüssel ist der der Spur (Übung und Seite), nicht ihr Ablauf: wer
   * während der Pause auf "+30 s" tippt, will nicht, dass der Ruhemodus
   * deswegen wieder aufspringt. Jede *neue* Pause öffnet ihn dagegen von
   * selbst - das ist der Zustand, in dem man ohnehin wartet.
   *
   * Flüchtig wie [openSessionBlockKey]: ob etwas minimiert war, ist keine
   * Trainingsinformation. Nach einem Neustart läuft die Pause weiter, der
   * Ruhemodus steht wieder offen.
   */
  minimizedRestKey: string | null;
  isOnline: boolean;
  isOfflineReady: boolean;
  isUpdateAvailable: boolean;
  deferredInstallPrompt: BeforeInstallPromptEvent | null;
  setActiveSessionExerciseId: (sessionExerciseId: string | null) => void;
  setOpenSessionBlockKey: (blockKey: string | null) => void;
  setMinimizedRestKey: (restKey: string | null) => void;
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
  minimizedRestKey: null,
  isOnline: true,
  isOfflineReady: false,
  isUpdateAvailable: false,
  deferredInstallPrompt: null,
  setActiveSessionExerciseId: (activeSessionExerciseId) => set({ activeSessionExerciseId }),
  setOpenSessionBlockKey: (openSessionBlockKey) => set({ openSessionBlockKey }),
  setMinimizedRestKey: (minimizedRestKey) => set({ minimizedRestKey }),
  setOnlineStatus: (isOnline) => set({ isOnline }),
  setOfflineReady: (isOfflineReady) => set({ isOfflineReady }),
  setUpdateAvailable: (isUpdateAvailable) => set({ isUpdateAvailable }),
  setDeferredInstallPrompt: (deferredInstallPrompt) => set({ deferredInstallPrompt }),
}));
