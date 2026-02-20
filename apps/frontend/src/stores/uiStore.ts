import { create } from 'zustand';
import { STICKY_NOTE_COLORS } from 'shared';
import type { BoardObject } from 'shared';

/**
 * Tool modes available in the toolbar.
 * - 'select': default pointer tool for selecting/moving objects
 * - 'sticky': click canvas to place a sticky note
 * - 'rectangle': click canvas to place a rectangle
 * - 'circle': click canvas to place a circle
 * - 'text': click canvas to place a standalone text element
 * - 'frame': click canvas to place a frame (visual grouping container)
 * - 'connector': click canvas to place a connector line
 * - 'dropper': click an object to sample its fill color
 */
export type Tool = 'select' | 'sticky' | 'rectangle' | 'circle' | 'text' | 'frame' | 'connector' | 'dropper' | 'placeFlag';

/** Maximum number of custom color slots (2 rows of 5) */
const MAX_CUSTOM_COLORS = 10;

interface UIState {
  // Current active tool
  activeTool: Tool;
  setActiveTool: (tool: Tool) => void;

  // Color selected for next object creation
  activeColor: string;
  setActiveColor: (color: string) => void;

  // Custom colors sampled by the dropper tool (max 10, newest first).
  // When a new color is sampled, it pushes to the front. If the array
  // exceeds MAX_CUSTOM_COLORS, the oldest (last) entry is removed.
  customColors: string[];
  addCustomColor: (color: string) => void;

  // Panning state
  isPanning: boolean;
  setIsPanning: (panning: boolean) => void;

  // Sidebar visibility
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;

  // Right sidebar visibility (Teleport Flags + Clipboard Indicator)
  rightSidebarOpen: boolean;
  setRightSidebarOpen: (open: boolean) => void;
  toggleRightSidebar: () => void;

  // Tracks whether the right sidebar was auto-opened (e.g., by a copy action).
  // If true, selecting a different object will auto-close it. Manual toggles
  // always clear this flag so the sidebar stays open.
  rightSidebarAutoOpened: boolean;

  // Whether the user is currently dragging an object on the canvas.
  // When true, sidebars auto-close and edge-glow overlay is shown.
  isDraggingObject: boolean;
  setIsDraggingObject: (dragging: boolean) => void;

  // Remembers the sidebar state before a drag auto-closed it, so we
  // can restore it when the drag ends.
  sidebarOpenBeforeDrag: boolean;
  rightSidebarOpenBeforeDrag: boolean;

  // Toast notification (ephemeral, auto-dismisses)
  toastMessage: string | null;
  showToast: (message: string) => void;
  clearToast: () => void;

  // Copy/paste clipboard (client-side only, never synced to server)
  clipboard: BoardObject[];
  setClipboard: (entries: BoardObject[]) => void;

  // Currently selected object IDs on the canvas (set by canvas selection events).
  // Used by the sidebar to conditionally show z-order controls.
  selectedObjectIds: string[];
  selectedObjectTypes: string[];
  setSelection: (ids: string[], types: string[]) => void;
  clearSelection: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  activeTool: 'select',
  setActiveTool: (tool) => set({ activeTool: tool }),

  activeColor: STICKY_NOTE_COLORS[0], // default yellow
  setActiveColor: (color) => set({ activeColor: color }),

  customColors: [],
  addCustomColor: (color) =>
    set((state) => {
      // Don't add duplicates — if the color already exists, move it to front
      const filtered = state.customColors.filter((c) => c !== color);
      const next = [color, ...filtered];
      // Trim to max 10 slots
      if (next.length > MAX_CUSTOM_COLORS) {
        next.length = MAX_CUSTOM_COLORS;
      }
      return { customColors: next, activeColor: color };
    }),

  isPanning: false,
  setIsPanning: (panning) => set({ isPanning: panning }),

  sidebarOpen: true,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

  rightSidebarOpen: false,
  setRightSidebarOpen: (open) => set({ rightSidebarOpen: open, rightSidebarAutoOpened: false }),
  toggleRightSidebar: () => set((s) => ({ rightSidebarOpen: !s.rightSidebarOpen, rightSidebarAutoOpened: false })),
  rightSidebarAutoOpened: false,

  isDraggingObject: false,
  setIsDraggingObject: (dragging) => set({ isDraggingObject: dragging }),
  sidebarOpenBeforeDrag: true,
  rightSidebarOpenBeforeDrag: false,

  toastMessage: null,
  showToast: (message) => {
    set({ toastMessage: message });
    // Auto-dismiss after 3 seconds
    setTimeout(() => set({ toastMessage: null }), 3000);
  },
  clearToast: () => set({ toastMessage: null }),

  clipboard: [],
  setClipboard: (entries) => set({ clipboard: entries }),

  selectedObjectIds: [],
  selectedObjectTypes: [],
  setSelection: (ids, types) => set({ selectedObjectIds: ids, selectedObjectTypes: types }),
  clearSelection: () => set({ selectedObjectIds: [], selectedObjectTypes: [] }),
}));
