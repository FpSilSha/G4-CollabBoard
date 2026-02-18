import { create } from 'zustand';
import { STICKY_NOTE_COLORS } from 'shared';

/**
 * Tool modes available in the toolbar.
 * - 'select': default pointer tool for selecting/moving objects
 * - 'sticky': click canvas to place a sticky note
 * - 'rectangle': click canvas to place a rectangle
 * - 'circle': click canvas to place a circle
 * - 'dropper': click an object to sample its fill color
 */
export type Tool = 'select' | 'sticky' | 'rectangle' | 'circle' | 'dropper';

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
  toggleSidebar: () => void;
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
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));
