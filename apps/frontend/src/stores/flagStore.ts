import { create } from 'zustand';
import type { TeleportFlag } from 'shared';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface FlagState {
  flags: TeleportFlag[];

  /** Create a flag via API and add to local state */
  createFlag: (
    boardId: string,
    data: { label: string; x: number; y: number; color: string },
    token: string,
  ) => Promise<TeleportFlag>;

  /** Update a flag via API and update local state */
  updateFlag: (
    boardId: string,
    flagId: string,
    data: Partial<{ label: string; x: number; y: number; color: string }>,
    token: string,
  ) => Promise<void>;

  /** Delete a flag via API and remove from local state */
  deleteFlag: (boardId: string, flagId: string, token: string) => Promise<void>;

  /** Local-only: update flag position (used during canvas drag) */
  updateFlagLocal: (flagId: string, data: Partial<TeleportFlag>) => void;

  /** Clear all flags (on board leave / board:state rebuild) */
  clearFlags: () => void;
}

export const useFlagStore = create<FlagState>((set) => ({
  flags: [],

  createFlag: async (boardId, data, token) => {
    const res = await fetch(`${API_URL}/boards/${boardId}/flags`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to create flag: ${res.status}`);
    const flag: TeleportFlag = await res.json();
    set((s) => ({ flags: [...s.flags, flag] }));
    return flag;
  },

  updateFlag: async (boardId, flagId, data, token) => {
    const res = await fetch(`${API_URL}/boards/${boardId}/flags/${flagId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to update flag: ${res.status}`);
    const updated: TeleportFlag = await res.json();
    set((s) => ({
      flags: s.flags.map((f) => (f.id === flagId ? updated : f)),
    }));
  },

  deleteFlag: async (boardId, flagId, token) => {
    const res = await fetch(`${API_URL}/boards/${boardId}/flags/${flagId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Failed to delete flag: ${res.status}`);
    set((s) => ({ flags: s.flags.filter((f) => f.id !== flagId) }));
  },

  updateFlagLocal: (flagId, data) =>
    set((s) => ({
      flags: s.flags.map((f) => (f.id === flagId ? { ...f, ...data } : f)),
    })),

  clearFlags: () => set({ flags: [] }),
}));
