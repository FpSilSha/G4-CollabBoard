import { create } from 'zustand';

interface DemoState {
  isDemoMode: boolean;
  demoBoardId: string | null;
  enterDemoMode: () => void;
  exitDemoMode: () => void;
}

/**
 * Demo mode state — allows unauthenticated users to explore
 * a single ephemeral board with no backend dependencies.
 *
 * State lives in memory only. Browser refresh loses demo state
 * and returns the user to the login screen (correct behavior).
 */
export const useDemoStore = create<DemoState>((set) => ({
  isDemoMode: false,
  demoBoardId: null,

  enterDemoMode: () =>
    set({
      isDemoMode: true,
      demoBoardId: crypto.randomUUID(),
    }),

  exitDemoMode: () =>
    set({
      isDemoMode: false,
      demoBoardId: null,
    }),
}));
