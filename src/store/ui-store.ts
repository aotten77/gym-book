import { create } from 'zustand';

interface UiStoreState {
  activeSessionExerciseId: string | null;
  restTimerEndsAt: number | null;
  setActiveSessionExerciseId: (sessionExerciseId: string | null) => void;
  startRestTimer: (seconds: number) => void;
  clearRestTimer: () => void;
}

export const useUiStore = create<UiStoreState>((set) => ({
  activeSessionExerciseId: null,
  restTimerEndsAt: null,
  setActiveSessionExerciseId: (activeSessionExerciseId) => set({ activeSessionExerciseId }),
  startRestTimer: (seconds) =>
    set({
      restTimerEndsAt: Date.now() + seconds * 1000,
    }),
  clearRestTimer: () => set({ restTimerEndsAt: null }),
}));
