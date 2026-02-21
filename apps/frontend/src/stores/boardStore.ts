import { create } from 'zustand';
import type { fabric } from 'fabric';
import { CANVAS_CONFIG } from 'shared';
import type { BoardObject } from 'shared';

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
  boardOwnerId: string | null;
  boardVersion: number;
  setBoardId: (id: string | null) => void;
  setBoardTitle: (title: string) => void;
  setBoardOwnerId: (ownerId: string | null) => void;
  setBoardVersion: (version: number) => void;

  // Max objects allowed on this board (derived from owner's subscription tier)
  maxObjectsPerBoard: number;
  setMaxObjectsPerBoard: (max: number) => void;

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

  // --- Text Editing ---
  // Tracks which object the local user is currently text-editing (modal open).
  // Used to prevent incoming WS text updates from overwriting the modal textarea.
  editingObjectId: string | null;
  setEditingObjectId: (id: string | null) => void;

  // Snapshot of the text when editing started — used by Cancel to revert.
  editingOriginalText: string | null;
  setEditingOriginalText: (text: string | null) => void;

  // Bridge: the hook's finishEditing function, callable from the modal.
  // Accepts `cancelled: boolean` — true = revert to original text.
  finishEditingFn: ((cancelled: boolean) => void) | null;
  setFinishEditingFn: (fn: ((cancelled: boolean) => void) | null) => void;

  // Other users concurrently editing the same object (advisory warnings).
  concurrentEditors: Array<{ userId: string; userName: string }>;
  setConcurrentEditors: (editors: Array<{ userId: string; userName: string }>) => void;
  addConcurrentEditor: (editor: { userId: string; userName: string }) => void;
  removeConcurrentEditor: (userId: string) => void;

  // --- Thumbnail ---
  // When the thumbnail was last captured (ISO string from server).
  // Used by useThumbnailCapture to enforce 5-minute cooldown.
  thumbnailUpdatedAt: string | null;
  setThumbnailUpdatedAt: (ts: string | null) => void;

  // Flipped to true by useCanvasSync after board:state objects are rendered.
  // useThumbnailCapture watches this to trigger capture on board enter.
  boardStateLoaded: boolean;
  setBoardStateLoaded: (loaded: boolean) => void;

  // --- Auth Token Cache ---
  // Pre-fetched Auth0 token stored here so module-scoped functions
  // (e.g., handleDeleteSelected, drag-to-trash) can access it without
  // needing React hook context. Set by BoardView on mount.
  cachedAuthToken: string | null;
  setCachedAuthToken: (token: string | null) => void;

  // --- Viewport ---
  zoom: number;
  setZoom: (zoom: number) => void;
  // Monotonic counter incremented on any viewport change (pan or zoom).
  // Used by RemoteCursors to trigger re-render when the viewport changes.
  viewportVersion: number;
  bumpViewportVersion: () => void;
}

export const useBoardStore = create<BoardState>((set) => ({
  canvas: null,
  setCanvas: (canvas) => set({ canvas }),

  boardId: null,
  boardTitle: 'Untitled Board',
  boardOwnerId: null,
  boardVersion: 0,
  setBoardId: (id) => set({ boardId: id }),
  setBoardTitle: (title) => set({ boardTitle: title }),
  setBoardOwnerId: (ownerId) => set({ boardOwnerId: ownerId }),
  setBoardVersion: (version) => set({ boardVersion: version }),

  maxObjectsPerBoard: 2000, // hard cap, overwritten on board load from API
  setMaxObjectsPerBoard: (max) => set({ maxObjectsPerBoard: max }),

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

  editingObjectId: null,
  setEditingObjectId: (id) => set({ editingObjectId: id }),

  editingOriginalText: null,
  setEditingOriginalText: (text) => set({ editingOriginalText: text }),

  finishEditingFn: null,
  setFinishEditingFn: (fn) => set({ finishEditingFn: fn }),

  concurrentEditors: [],
  setConcurrentEditors: (editors) => set({ concurrentEditors: editors }),
  addConcurrentEditor: (editor) =>
    set((state) => {
      // Avoid duplicates
      if (state.concurrentEditors.some((e) => e.userId === editor.userId)) {
        return state;
      }
      return { concurrentEditors: [...state.concurrentEditors, editor] };
    }),
  removeConcurrentEditor: (userId) =>
    set((state) => ({
      concurrentEditors: state.concurrentEditors.filter((e) => e.userId !== userId),
    })),

  thumbnailUpdatedAt: null,
  setThumbnailUpdatedAt: (ts) => set({ thumbnailUpdatedAt: ts }),

  boardStateLoaded: false,
  setBoardStateLoaded: (loaded) => set({ boardStateLoaded: loaded }),

  cachedAuthToken: null,
  setCachedAuthToken: (token) => set({ cachedAuthToken: token }),

  zoom: CANVAS_CONFIG.DEFAULT_ZOOM,
  setZoom: (zoom) => set({ zoom }),
  viewportVersion: 0,
  bumpViewportVersion: () => set((s) => ({ viewportVersion: s.viewportVersion + 1 })),
}));
