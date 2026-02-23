import { create } from 'zustand';
import type { TeleportFlag } from 'shared';
import { createApiClient } from '../services/apiClient';

interface FlagState {
  flags: TeleportFlag[];

  /** Create a flag via API and add to local state */
  createFlag: (
    boardId: string,
    data: { label: string; x: number; y: number; color: string },
    token: string,
  ) => Promise<TeleportFlag>;

  /** Create a flag locally (demo mode — no API) */
  createFlagLocal: (
    boardId: string,
    data: { label: string; x: number; y: number; color: string },
  ) => TeleportFlag;

  /** Update a flag via API and update local state */
  updateFlag: (
    boardId: string,
    flagId: string,
    data: Partial<{ label: string; x: number; y: number; color: string }>,
    token: string,
  ) => Promise<void>;

  /** Delete a flag via API and remove from local state */
  deleteFlag: (boardId: string, flagId: string, token: string) => Promise<void>;

  /** Delete a flag locally (demo mode — no API) */
  deleteFlagLocal: (flagId: string) => void;

  /** Local-only: update flag position (used during canvas drag) */
  updateFlagLocal: (flagId: string, data: Partial<TeleportFlag>) => void;

  /** Clear all flags (on board leave / board:state rebuild) */
  clearFlags: () => void;
}

export const useFlagStore = create<FlagState>((set) => ({
  flags: [],

  createFlag: async (boardId, data, token) => {
    const api = createApiClient(() => Promise.resolve(token));
    const flag = await api.post<TeleportFlag>(`/boards/${boardId}/flags`, data);
    set((s) => ({ flags: [...s.flags, flag] }));
    return flag;
  },

  createFlagLocal: (boardId, data) => {
    const now = new Date();
    const flag: TeleportFlag = {
      id: crypto.randomUUID(),
      boardId,
      createdBy: 'demo-user',
      label: data.label,
      x: data.x,
      y: data.y,
      color: data.color,
      createdAt: now,
      updatedAt: now,
    };
    set((s) => ({ flags: [...s.flags, flag] }));
    return flag;
  },

  updateFlag: async (boardId, flagId, data, token) => {
    const api = createApiClient(() => Promise.resolve(token));
    const updated = await api.patch<TeleportFlag>(`/boards/${boardId}/flags/${flagId}`, data);
    set((s) => ({
      flags: s.flags.map((f) => (f.id === flagId ? updated : f)),
    }));
  },

  deleteFlag: async (boardId, flagId, token) => {
    const api = createApiClient(() => Promise.resolve(token));
    await api.del(`/boards/${boardId}/flags/${flagId}`);
    set((s) => ({ flags: s.flags.filter((f) => f.id !== flagId) }));
  },

  deleteFlagLocal: (flagId) =>
    set((s) => ({ flags: s.flags.filter((f) => f.id !== flagId) })),

  updateFlagLocal: (flagId, data) =>
    set((s) => ({
      flags: s.flags.map((f) => (f.id === flagId ? { ...f, ...data } : f)),
    })),

  clearFlags: () => set({ flags: [] }),
}));
