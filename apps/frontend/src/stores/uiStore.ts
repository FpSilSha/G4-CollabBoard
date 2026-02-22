import { create } from 'zustand';
import { PASTEL_COLORS } from 'shared';
import type { BoardObject, ColorPaletteKey, LineEndpointStyle, LineStrokePattern, LineStrokeWeight, StickySizeKey } from 'shared';
import { useBoardStore } from './boardStore';

/**
 * Tool modes available in the toolbar.
 * - 'select': default pointer tool for selecting/moving objects
 * - 'sticky': click canvas to place a sticky note
 * - 'rectangle': click canvas to place a rectangle
 * - 'circle': click canvas to place a circle
 * - 'text': click canvas to place a standalone text element
 * - 'frame': click canvas to place a frame (visual grouping container)
 * - 'line': click-and-drag to draw an arrow line (shape)
 * - 'connector': click-and-drag to create a connector (snaps to objects)
 * - 'dropper': click an object to sample its fill color
 */
export type Tool = 'select' | 'sticky' | 'rectangle' | 'circle' | 'text' | 'frame' | 'line' | 'connector' | 'dropper' | 'placeFlag' | 'arrow' | 'star' | 'triangle' | 'diamond';

/** Shape sub-tools available in the shape options panel. */
export type ShapeTool = 'rectangle' | 'circle' | 'triangle' | 'star' | 'arrow' | 'diamond';

/** Maximum number of custom color slots (2 rows of 5) */
const MAX_CUSTOM_COLORS = 10;

/** Maximum number of clipboard history entries (FIFO). */
const MAX_CLIPBOARD_HISTORY = 5;

interface UIState {
  // Current active tool
  activeTool: Tool;
  setActiveTool: (tool: Tool) => void;

  // Color selected for next object creation
  activeColor: string;
  setActiveColor: (color: string) => void;

  // Active color palette tab (persists across sidebar open/close)
  colorPaletteTab: ColorPaletteKey;
  setColorPaletteTab: (tab: ColorPaletteKey) => void;

  // Custom colors sampled by the dropper tool (max 10, newest first).
  // When a new color is sampled, it pushes to the front. If the array
  // exceeds MAX_CUSTOM_COLORS, the oldest (last) entry is removed.
  customColors: string[];
  addCustomColor: (color: string) => void;

  // Floating custom color picker panel (rendered as fixed overlay next to sidebar)
  colorPickerOpen: boolean;
  setColorPickerOpen: (open: boolean) => void;

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

  // Copy/paste clipboard history (client-side only, never synced to server).
  // Stores up to MAX_CLIPBOARD_HISTORY (5) past copy operations, newest first.
  // `clipboard` is derived from `clipboardHistory[activeClipboardIndex]`.
  clipboardHistory: BoardObject[][];
  activeClipboardIndex: number;
  clipboard: BoardObject[];   // derived shortcut for the active entry

  /** Push a new clipboard entry (FIFO). Resets active index to 0 (newest). */
  pushClipboard: (entries: BoardObject[]) => void;

  /** Switch which history entry is active for the next paste. */
  setActiveClipboardIndex: (index: number) => void;

  /** Update the active clipboard entry in-place (for cascading paste offsets). */
  updateActiveClipboard: (entries: BoardObject[]) => void;

  // Currently selected object IDs on the canvas (set by canvas selection events).
  // Used by the sidebar to conditionally show z-order controls.
  selectedObjectIds: string[];
  selectedObjectTypes: string[];
  setSelection: (ids: string[], types: string[]) => void;
  clearSelection: () => void;

  // Line tool styling defaults (persist between draws)
  lineEndpointStyle: LineEndpointStyle;
  setLineEndpointStyle: (style: LineEndpointStyle) => void;
  lineStrokePattern: LineStrokePattern;
  setLineStrokePattern: (pattern: LineStrokePattern) => void;
  lineStrokeWeight: LineStrokeWeight;
  setLineStrokeWeight: (weight: LineStrokeWeight) => void;

  // Shape sub-tool (which shape is selected in the shape options panel)
  activeShapeTool: ShapeTool;
  setActiveShapeTool: (shape: ShapeTool) => void;

  // Sticky note size preset (S/M/L — persists between creates)
  stickySize: StickySizeKey;
  setStickySize: (size: StickySizeKey) => void;

  // Text tool styling defaults (persist between creates)
  textFontSize: number;
  setTextFontSize: (size: number) => void;
  textFontFamily: string;
  setTextFontFamily: (family: string) => void;

  // Generic text-input modal (replaces window.prompt for flag labels, etc.)
  textInputModal: {
    title: string;
    initialValue: string;
    placeholder: string;
    maxLength: number;
    onConfirm: (value: string) => void;
    onCancel: () => void;
  } | null;
  openTextInputModal: (opts: {
    title: string;
    initialValue?: string;
    placeholder?: string;
    maxLength?: number;
  }) => Promise<string | null>;
  closeTextInputModal: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  activeTool: 'select',
  setActiveTool: (tool) => {
    set({ activeTool: tool, colorPickerOpen: false });
    // When switching to any creation tool, deselect the canvas so the user
    // starts fresh. 'select' and 'dropper' keep the current selection.
    if (tool !== 'select' && tool !== 'dropper') {
      const canvas = useBoardStore.getState().canvas;
      if (canvas) {
        canvas.discardActiveObject();
        canvas.requestRenderAll();
      }
    }
  },

  activeColor: PASTEL_COLORS[3], // default blush (#F8BBD0)
  setActiveColor: (color) => set({ activeColor: color }),

  colorPaletteTab: 'pastel' as ColorPaletteKey,
  setColorPaletteTab: (tab) => set({ colorPaletteTab: tab }),

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

  colorPickerOpen: false,
  setColorPickerOpen: (open) => set({ colorPickerOpen: open }),

  isPanning: false,
  setIsPanning: (panning) => set({ isPanning: panning }),

  sidebarOpen: true,
  setSidebarOpen: (open) => set((s) => ({ sidebarOpen: open, ...(open ? {} : { colorPickerOpen: false }) })),
  toggleSidebar: () => set((s) => {
    const nextOpen = !s.sidebarOpen;
    return { sidebarOpen: nextOpen, ...(nextOpen ? {} : { colorPickerOpen: false }) };
  }),

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
    // Auto-dismiss after 5 seconds
    setTimeout(() => set({ toastMessage: null }), 5000);
  },
  clearToast: () => set({ toastMessage: null }),

  clipboardHistory: [],
  activeClipboardIndex: 0,
  clipboard: [],

  pushClipboard: (entries) =>
    set((state) => {
      const next = [entries, ...state.clipboardHistory].slice(0, MAX_CLIPBOARD_HISTORY);
      return {
        clipboardHistory: next,
        activeClipboardIndex: 0,
        clipboard: next[0] ?? [],
      };
    }),

  setActiveClipboardIndex: (index) =>
    set((state) => {
      const clamped = Math.max(0, Math.min(index, state.clipboardHistory.length - 1));
      return {
        activeClipboardIndex: clamped,
        clipboard: state.clipboardHistory[clamped] ?? [],
      };
    }),

  updateActiveClipboard: (entries) =>
    set((state) => {
      const history = [...state.clipboardHistory];
      const idx = state.activeClipboardIndex;
      if (idx >= 0 && idx < history.length) {
        history[idx] = entries;
      }
      return {
        clipboardHistory: history,
        clipboard: entries,
      };
    }),

  selectedObjectIds: [],
  selectedObjectTypes: [],
  setSelection: (ids, types) => set({ selectedObjectIds: ids, selectedObjectTypes: types }),
  clearSelection: () => set({ selectedObjectIds: [], selectedObjectTypes: [] }),

  lineEndpointStyle: 'none' as LineEndpointStyle,
  setLineEndpointStyle: (style) => set({ lineEndpointStyle: style }),
  lineStrokePattern: 'solid' as LineStrokePattern,
  setLineStrokePattern: (pattern) => set({ lineStrokePattern: pattern }),
  lineStrokeWeight: 'normal' as LineStrokeWeight,
  setLineStrokeWeight: (weight) => set({ lineStrokeWeight: weight }),

  activeShapeTool: 'rectangle' as ShapeTool,
  setActiveShapeTool: (shape) => set({ activeShapeTool: shape, activeTool: shape }),

  stickySize: 'medium' as StickySizeKey,
  setStickySize: (size) => set({ stickySize: size }),

  textFontSize: 24,
  setTextFontSize: (size) => set({ textFontSize: size }),
  textFontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  setTextFontFamily: (family) => set({ textFontFamily: family }),

  textInputModal: null,
  openTextInputModal: (opts) =>
    new Promise<string | null>((resolve) => {
      set({
        textInputModal: {
          title: opts.title,
          initialValue: opts.initialValue ?? '',
          placeholder: opts.placeholder ?? '',
          maxLength: opts.maxLength ?? 100,
          onConfirm: (value: string) => {
            set({ textInputModal: null });
            resolve(value);
          },
          onCancel: () => {
            set({ textInputModal: null });
            resolve(null);
          },
        },
      });
    }),
  closeTextInputModal: () => set({ textInputModal: null }),
}));
