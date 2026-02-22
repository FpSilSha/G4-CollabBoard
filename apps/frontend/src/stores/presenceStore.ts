import { create } from 'zustand';
import type { BoardUserInfo } from 'shared';

/**
 * Remote cursor position with metadata for rendering and stale detection.
 */
export interface RemoteCursor {
  userId: string;
  name: string;
  color: string;
  x: number;
  y: number;
  lastUpdate: number; // timestamp — cursors with no update >5s are removed
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'displaced';

interface PresenceState {
  // --- Connection ---
  connectionStatus: ConnectionStatus;
  hasEverConnected: boolean; // true after first successful socket connect
  setConnectionStatus: (status: ConnectionStatus) => void;

  // --- Local user (populated after Auth0 + socket auth) ---
  localUserId: string | null;
  localUserName: string | null;
  localUserColor: string | null;
  setLocalUser: (userId: string, name: string, color: string) => void;

  // --- Remote users currently in the board ---
  remoteUsers: Map<string, BoardUserInfo>;
  setRemoteUsers: (users: BoardUserInfo[]) => void;
  addRemoteUser: (user: BoardUserInfo) => void;
  removeRemoteUser: (userId: string) => void;
  clearRemoteUsers: () => void;

  // --- Remote cursors ---
  remoteCursors: Map<string, RemoteCursor>;
  updateRemoteCursor: (userId: string, x: number, y: number, name: string, color: string) => void;
  removeRemoteCursor: (userId: string) => void;
  clearRemoteCursors: () => void;

  // --- Last known cursor positions (persists after cursor de-render) ---
  lastKnownPositions: Map<string, { x: number; y: number }>;
}

export const usePresenceStore = create<PresenceState>((set) => ({
  // Connection
  connectionStatus: 'disconnected',
  hasEverConnected: false,
  setConnectionStatus: (status) =>
    set((state) => ({
      connectionStatus: status,
      // Once connected, remember it — so we can distinguish
      // "never connected yet" from "was connected but lost connection"
      hasEverConnected: state.hasEverConnected || status === 'connected',
    })),

  // Local user
  localUserId: null,
  localUserName: null,
  localUserColor: null,
  setLocalUser: (userId, name, color) =>
    set({ localUserId: userId, localUserName: name, localUserColor: color }),

  // Remote users
  remoteUsers: new Map(),
  setRemoteUsers: (users) => {
    const map = new Map<string, BoardUserInfo>();
    users.forEach((u) => map.set(u.userId, u));
    set({ remoteUsers: map });
  },
  addRemoteUser: (user) =>
    set((state) => {
      const next = new Map(state.remoteUsers);
      next.set(user.userId, user);
      return { remoteUsers: next };
    }),
  removeRemoteUser: (userId) =>
    set((state) => {
      const next = new Map(state.remoteUsers);
      next.delete(userId);
      // Also remove cursor and last known position when user leaves
      const nextCursors = new Map(state.remoteCursors);
      nextCursors.delete(userId);
      const nextPositions = new Map(state.lastKnownPositions);
      nextPositions.delete(userId);
      return { remoteUsers: next, remoteCursors: nextCursors, lastKnownPositions: nextPositions };
    }),
  clearRemoteUsers: () => set({ remoteUsers: new Map() }),

  // Remote cursors
  remoteCursors: new Map(),
  updateRemoteCursor: (userId, x, y, name, color) =>
    set((state) => {
      const next = new Map(state.remoteCursors);
      next.set(userId, { userId, name, color, x, y, lastUpdate: Date.now() });
      // Also persist last known position (survives cursor de-render)
      const nextPositions = new Map(state.lastKnownPositions);
      nextPositions.set(userId, { x, y });
      return { remoteCursors: next, lastKnownPositions: nextPositions };
    }),
  removeRemoteCursor: (userId) =>
    set((state) => {
      const next = new Map(state.remoteCursors);
      next.delete(userId);
      // NOTE: Do NOT clear lastKnownPositions here — that's the whole point.
      // Last known position persists even after cursor goes stale.
      return { remoteCursors: next };
    }),
  clearRemoteCursors: () => set({ remoteCursors: new Map() }),

  // Last known cursor positions (persists after cursor de-render)
  lastKnownPositions: new Map(),
}));
