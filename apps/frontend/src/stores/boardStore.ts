import { create } from 'zustand';
import type { fabric } from 'fabric';
import { CANVAS_CONFIG } from 'shared';
import type { BoardObject, ConflictWarningPayload } from 'shared';

interface BoardState {
  // --- Canvas Instance ---
  // Stored here so any component can access the canvas (e.g., header zoom buttons,
  // sidebar object creation) without prop drilling.
  // Set by useCanvas hook on mount, cleared on unmount.
  canvas: fabric.Canvas | null;
  setCanvas: (canvas: fabric.Canvas | null) => void;

  // --- Board Metadata ---
  // In Phase 3 these are placeholder values. Phase 4 populates from server.
  boardId: string | null;
  boardTitle: string;
  setBoardId: (id: string | null) => void;
  setBoardTitle: (title: string) => void;

  // --- Local Object Tracking ---
  // Map of BoardObject.id -> BoardObject
  // In Phase 3: populated locally on creation.
  // In Phase 4: populated from server state, updated on WebSocket events.
  objects: Map<string, BoardObject>;
  addObject: (obj: BoardObject) => void;
  updateObject: (id: string, updates: Partial<BoardObject>) => void;
  removeObject: (id: string) => void;
  clearObjects: () => void;
  setObjects: (objects: BoardObject[]) => void;

  // --- Active Edit Tracking ---
  // Set of object IDs the local user is currently editing (has selected).
  // Used to determine when to emit edit:start/end WS events.
  activeEdits: Set<string>;
  startLocalEdit: (objectId: string) => void;
  endLocalEdit: (objectId: string) => void;
  clearLocalEdits: () => void;

  // --- Conflict Warning ---
  // Set by the WS layer when another user modifies an object we're editing.
  // Consumed by ConflictModal to show the user their options.
  conflictWarning: ConflictWarningPayload | null;
  setConflictWarning: (warning: ConflictWarningPayload | null) => void;

  // --- Zoom ---
  zoom: number;
  setZoom: (zoom: number) => void;
}

export const useBoardStore = create<BoardState>((set) => ({
  canvas: null,
  setCanvas: (canvas) => set({ canvas }),

  boardId: null,
  boardTitle: 'Untitled Board',
  setBoardId: (id) => set({ boardId: id }),
  setBoardTitle: (title) => set({ boardTitle: title }),

  objects: new Map(),
  addObject: (obj) =>
    set((state) => {
      const next = new Map(state.objects);
      next.set(obj.id, obj);
      return { objects: next };
    }),
  updateObject: (id, updates) =>
    set((state) => {
      const existing = state.objects.get(id);
      if (!existing) return state;
      const next = new Map(state.objects);
      next.set(id, { ...existing, ...updates } as BoardObject);
      return { objects: next };
    }),
  removeObject: (id) =>
    set((state) => {
      const next = new Map(state.objects);
      next.delete(id);
      return { objects: next };
    }),
  clearObjects: () => set({ objects: new Map() }),
  setObjects: (objects) =>
    set(() => {
      const map = new Map<string, BoardObject>();
      objects.forEach((obj) => map.set(obj.id, obj));
      return { objects: map };
    }),

  activeEdits: new Set(),
  startLocalEdit: (objectId) =>
    set((state) => {
      const next = new Set(state.activeEdits);
      next.add(objectId);
      return { activeEdits: next };
    }),
  endLocalEdit: (objectId) =>
    set((state) => {
      const next = new Set(state.activeEdits);
      next.delete(objectId);
      return { activeEdits: next };
    }),
  clearLocalEdits: () => set({ activeEdits: new Set() }),

  conflictWarning: null,
  setConflictWarning: (warning) => set({ conflictWarning: warning }),

  zoom: CANVAS_CONFIG.DEFAULT_ZOOM,
  setZoom: (zoom) => set({ zoom }),
}));
