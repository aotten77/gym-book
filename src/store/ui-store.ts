import { create } from 'zustand';

// Nur flüchtiger UI-Zustand. Alles, was einen Reload überleben muss -
// insbesondere der Pausentimer - liegt in IndexedDB, siehe session-actions.
/**
 * Wo der Plan-Zeitstrahl beim letzten Scrollen stand: die oberste sichtbare
 * Woche und ihre Lage im sichtbaren Ausschnitt, dazu der Anfang des geladenen
 * Bereichs und der Tag, für den das galt.
 */
export interface PlanPosition {
  todayKey: string;
  firstMondayKey: string;
  anchorKey: string;
  anchorTop: number;
}

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
  /**
   * Ob das Jetzt-Sheet („Jetzt trainieren") offen ist. Flüchtig wie
   * [openSessionBlockKey]: nach einem Neustart steht man in der Übersicht.
   */
  isNowSheetOpen: boolean;
  /**
   * Die Lage des Plan-Zeitstrahls, damit ein Zurück aus einer Detailseite ihn
   * an derselben Stelle wieder aufbaut. Flüchtig: nach einem Neustart und bei
   * jedem Einstieg über den Plan-Tab öffnet der Plan auf heute.
   */
  planPosition: PlanPosition | null;
  isOnline: boolean;
  isOfflineReady: boolean;
  isUpdateAvailable: boolean;
  /** Cloudflare Access hat die Sitzung beendet - siehe [access-session.ts]. */
  isAccessExpired: boolean;
  deferredInstallPrompt: BeforeInstallPromptEvent | null;
  setActiveSessionExerciseId: (sessionExerciseId: string | null) => void;
  setOpenSessionBlockKey: (blockKey: string | null) => void;
  setMinimizedRestKey: (restKey: string | null) => void;
  setNowSheetOpen: (open: boolean) => void;
  setPlanPosition: (position: PlanPosition | null) => void;
  setOnlineStatus: (isOnline: boolean) => void;
  setOfflineReady: (isOfflineReady: boolean) => void;
  setUpdateAvailable: (isUpdateAvailable: boolean) => void;
  setAccessExpired: (isAccessExpired: boolean) => void;
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
  isNowSheetOpen: false,
  planPosition: null,
  isOnline: true,
  isOfflineReady: false,
  isUpdateAvailable: false,
  isAccessExpired: false,
  deferredInstallPrompt: null,
  setActiveSessionExerciseId: (activeSessionExerciseId) => set({ activeSessionExerciseId }),
  setOpenSessionBlockKey: (openSessionBlockKey) => set({ openSessionBlockKey }),
  setMinimizedRestKey: (minimizedRestKey) => set({ minimizedRestKey }),
  setNowSheetOpen: (isNowSheetOpen) => set({ isNowSheetOpen }),
  setPlanPosition: (planPosition) => set({ planPosition }),
  setOnlineStatus: (isOnline) => set({ isOnline }),
  setOfflineReady: (isOfflineReady) => set({ isOfflineReady }),
  setUpdateAvailable: (isUpdateAvailable) => set({ isUpdateAvailable }),
  setAccessExpired: (isAccessExpired) => set({ isAccessExpired }),
  setDeferredInstallPrompt: (deferredInstallPrompt) => set({ deferredInstallPrompt }),
}));
