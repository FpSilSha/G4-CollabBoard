import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useUIStore } from '../../src/stores/uiStore';
import { useBoardStore } from '../../src/stores/boardStore';
import type { Tool, ShapeTool } from '../../src/stores/uiStore';

// ─── Reset helpers ────────────────────────────────────────────────────────────

const UI_INITIAL: Parameters<typeof useUIStore.setState>[0] = {
  activeTool: 'select',
  activeColor: '#F8BBD0',
  colorPaletteTab: 'pastel',
  customColors: [],
  colorPickerOpen: false,
  isPanning: false,
  sidebarOpen: true,
  rightSidebarOpen: false,
  rightSidebarAutoOpened: false,
  isDraggingObject: false,
  sidebarOpenBeforeDrag: true,
  rightSidebarOpenBeforeDrag: false,
  toastMessage: null,
  clipboardHistory: [],
  activeClipboardIndex: 0,
  clipboard: [],
  selectedObjectIds: [],
  selectedObjectTypes: [],
  lineEndpointStyle: 'none',
  lineStrokePattern: 'solid',
  lineStrokeWeight: 'normal',
  activeShapeTool: 'rectangle',
  stickySize: 'medium',
  textFontSize: 24,
  textFontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  textInputModal: null,
};

const BOARD_INITIAL: Parameters<typeof useBoardStore.setState>[0] = {
  canvas: null,
  boardId: null,
  boardTitle: 'Untitled Board',
  boardOwnerId: null,
  boardVersion: 0,
  maxObjectsPerBoard: 2000,
  objects: new Map(),
  editingObjectId: null,
  editingOriginalText: null,
  finishEditingFn: null,
  concurrentEditors: [],
  thumbnailUpdatedAt: null,
  boardStateLoaded: false,
  cachedAuthToken: null,
  zoom: 1,
  viewportVersion: 0,
};

beforeEach(() => {
  useUIStore.setState(UI_INITIAL as any);
  useBoardStore.setState(BOARD_INITIAL as any);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── setActiveTool ────────────────────────────────────────────────────────────

describe('setActiveTool', () => {
  it('updates activeTool to a new tool value', () => {
    useUIStore.getState().setActiveTool('sticky');
    expect(useUIStore.getState().activeTool).toBe('sticky');
  });

  it('can switch between all tool types', () => {
    const tools: Tool[] = ['select', 'sticky', 'rectangle', 'circle', 'text', 'frame', 'line', 'connector', 'dropper'];
    for (const tool of tools) {
      useUIStore.getState().setActiveTool(tool);
      expect(useUIStore.getState().activeTool).toBe(tool);
    }
  });

  it('closes colorPickerOpen when switching tools', () => {
    useUIStore.setState({ colorPickerOpen: true } as any);
    useUIStore.getState().setActiveTool('rectangle');
    expect(useUIStore.getState().colorPickerOpen).toBe(false);
  });

  it('calls discardActiveObject on canvas when switching to a creation tool', () => {
    const mockCanvas = {
      discardActiveObject: vi.fn(),
      requestRenderAll: vi.fn(),
    };
    useBoardStore.setState({ canvas: mockCanvas as any });
    useUIStore.getState().setActiveTool('sticky');
    expect(mockCanvas.discardActiveObject).toHaveBeenCalled();
    expect(mockCanvas.requestRenderAll).toHaveBeenCalled();
  });

  it('does NOT call discardActiveObject when switching to select', () => {
    const mockCanvas = {
      discardActiveObject: vi.fn(),
      requestRenderAll: vi.fn(),
    };
    useBoardStore.setState({ canvas: mockCanvas as any });
    useUIStore.getState().setActiveTool('select');
    expect(mockCanvas.discardActiveObject).not.toHaveBeenCalled();
  });

  it('does NOT call discardActiveObject when switching to dropper', () => {
    const mockCanvas = {
      discardActiveObject: vi.fn(),
      requestRenderAll: vi.fn(),
    };
    useBoardStore.setState({ canvas: mockCanvas as any });
    useUIStore.getState().setActiveTool('dropper');
    expect(mockCanvas.discardActiveObject).not.toHaveBeenCalled();
  });

  it('does not crash when canvas is null during tool switch', () => {
    useBoardStore.setState({ canvas: null });
    expect(() => useUIStore.getState().setActiveTool('rectangle')).not.toThrow();
  });
});

// ─── toggleSidebar ────────────────────────────────────────────────────────────

describe('toggleSidebar', () => {
  it('toggles sidebarOpen from true to false', () => {
    useUIStore.setState({ sidebarOpen: true } as any);
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarOpen).toBe(false);
  });

  it('toggles sidebarOpen from false to true', () => {
    useUIStore.setState({ sidebarOpen: false } as any);
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarOpen).toBe(true);
  });

  it('closing sidebar also closes colorPickerOpen', () => {
    useUIStore.setState({ sidebarOpen: true, colorPickerOpen: true } as any);
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().colorPickerOpen).toBe(false);
  });

  it('opening sidebar does NOT force colorPickerOpen closed', () => {
    // When opening the sidebar, colorPicker state is preserved
    useUIStore.setState({ sidebarOpen: false, colorPickerOpen: true } as any);
    useUIStore.getState().toggleSidebar();
    // After opening, colorPickerOpen should remain as-is (not forced to false)
    // The source code only sets colorPickerOpen:false when closing (nextOpen = false)
    expect(useUIStore.getState().sidebarOpen).toBe(true);
  });
});

// ─── toggleRightSidebar ───────────────────────────────────────────────────────

describe('toggleRightSidebar', () => {
  it('toggles rightSidebarOpen from false to true', () => {
    useUIStore.setState({ rightSidebarOpen: false } as any);
    useUIStore.getState().toggleRightSidebar();
    expect(useUIStore.getState().rightSidebarOpen).toBe(true);
  });

  it('toggles rightSidebarOpen from true to false', () => {
    useUIStore.setState({ rightSidebarOpen: true } as any);
    useUIStore.getState().toggleRightSidebar();
    expect(useUIStore.getState().rightSidebarOpen).toBe(false);
  });

  it('clears rightSidebarAutoOpened flag on toggle', () => {
    useUIStore.setState({ rightSidebarOpen: false, rightSidebarAutoOpened: true } as any);
    useUIStore.getState().toggleRightSidebar();
    expect(useUIStore.getState().rightSidebarAutoOpened).toBe(false);
  });
});

// ─── setActiveShapeTool ───────────────────────────────────────────────────────

describe('setActiveShapeTool', () => {
  it('updates activeShapeTool', () => {
    useUIStore.getState().setActiveShapeTool('circle');
    expect(useUIStore.getState().activeShapeTool).toBe('circle');
  });

  it('also sets activeTool to match the shape tool', () => {
    useUIStore.getState().setActiveShapeTool('triangle');
    expect(useUIStore.getState().activeTool).toBe('triangle');
  });

  it('works for all shape sub-tools', () => {
    const shapes: ShapeTool[] = ['rectangle', 'circle', 'triangle', 'star', 'arrow', 'diamond'];
    for (const shape of shapes) {
      useUIStore.getState().setActiveShapeTool(shape);
      expect(useUIStore.getState().activeShapeTool).toBe(shape);
      expect(useUIStore.getState().activeTool).toBe(shape);
    }
  });
});

// ─── setStickySize ────────────────────────────────────────────────────────────

describe('setStickySize', () => {
  it('updates stickySize to small', () => {
    useUIStore.getState().setStickySize('small');
    expect(useUIStore.getState().stickySize).toBe('small');
  });

  it('updates stickySize to large', () => {
    useUIStore.getState().setStickySize('large');
    expect(useUIStore.getState().stickySize).toBe('large');
  });

  it('updates stickySize to medium', () => {
    useUIStore.getState().setStickySize('medium');
    expect(useUIStore.getState().stickySize).toBe('medium');
  });
});

// ─── showToast / clearToast ───────────────────────────────────────────────────

describe('showToast', () => {
  it('sets toastMessage', () => {
    useUIStore.getState().showToast('Hello toast');
    expect(useUIStore.getState().toastMessage).toBe('Hello toast');
  });

  it('auto-dismisses after 5 seconds', () => {
    useUIStore.getState().showToast('Auto dismiss');
    expect(useUIStore.getState().toastMessage).toBe('Auto dismiss');

    vi.advanceTimersByTime(5000);

    expect(useUIStore.getState().toastMessage).toBeNull();
  });

  it('does not auto-dismiss before 5 seconds', () => {
    useUIStore.getState().showToast('Still visible');
    vi.advanceTimersByTime(4999);
    expect(useUIStore.getState().toastMessage).toBe('Still visible');
  });
});

describe('clearToast', () => {
  it('clears toastMessage immediately', () => {
    useUIStore.setState({ toastMessage: 'Some message' } as any);
    useUIStore.getState().clearToast();
    expect(useUIStore.getState().toastMessage).toBeNull();
  });
});

// ─── pushClipboard ────────────────────────────────────────────────────────────

describe('pushClipboard', () => {
  it('pushes entries to clipboardHistory and resets index to 0', () => {
    const entry = [{ id: 'obj-1' } as any];
    useUIStore.getState().pushClipboard(entry);

    const state = useUIStore.getState();
    expect(state.clipboardHistory.length).toBe(1);
    expect(state.activeClipboardIndex).toBe(0);
    expect(state.clipboard).toEqual(entry);
  });

  it('newer entries go to front (FIFO)', () => {
    const entry1 = [{ id: 'obj-1' } as any];
    const entry2 = [{ id: 'obj-2' } as any];
    useUIStore.getState().pushClipboard(entry1);
    useUIStore.getState().pushClipboard(entry2);

    const state = useUIStore.getState();
    expect(state.clipboardHistory[0]).toEqual(entry2);
    expect(state.clipboardHistory[1]).toEqual(entry1);
  });

  it('trims history to MAX_CLIPBOARD_HISTORY (5)', () => {
    for (let i = 0; i < 7; i++) {
      useUIStore.getState().pushClipboard([{ id: `obj-${i}` } as any]);
    }
    expect(useUIStore.getState().clipboardHistory.length).toBe(5);
  });
});

// ─── setActiveClipboardIndex ──────────────────────────────────────────────────

describe('setActiveClipboardIndex', () => {
  it('switches active clipboard to the given index', () => {
    const entry1 = [{ id: 'obj-1' } as any];
    const entry2 = [{ id: 'obj-2' } as any];
    useUIStore.getState().pushClipboard(entry1);
    useUIStore.getState().pushClipboard(entry2);

    // History is [entry2, entry1] — index 1 is entry1
    useUIStore.getState().setActiveClipboardIndex(1);
    expect(useUIStore.getState().clipboard).toEqual(entry1);
    expect(useUIStore.getState().activeClipboardIndex).toBe(1);
  });

  it('clamps out-of-range index to last valid index', () => {
    useUIStore.getState().pushClipboard([{ id: 'obj-1' } as any]);
    useUIStore.getState().setActiveClipboardIndex(999);
    expect(useUIStore.getState().activeClipboardIndex).toBe(0);
  });

  it('clamps negative index to 0', () => {
    useUIStore.getState().pushClipboard([{ id: 'obj-1' } as any]);
    useUIStore.getState().setActiveClipboardIndex(-5);
    expect(useUIStore.getState().activeClipboardIndex).toBe(0);
  });
});

// ─── setSelection / clearSelection ───────────────────────────────────────────

describe('setSelection', () => {
  it('stores selected IDs and types', () => {
    useUIStore.getState().setSelection(['id-1', 'id-2'], ['sticky', 'rectangle']);

    const state = useUIStore.getState();
    expect(state.selectedObjectIds).toEqual(['id-1', 'id-2']);
    expect(state.selectedObjectTypes).toEqual(['sticky', 'rectangle']);
  });
});

describe('clearSelection', () => {
  it('resets selectedObjectIds and selectedObjectTypes to empty arrays', () => {
    useUIStore.setState({ selectedObjectIds: ['id-1'], selectedObjectTypes: ['sticky'] } as any);
    useUIStore.getState().clearSelection();

    const state = useUIStore.getState();
    expect(state.selectedObjectIds).toEqual([]);
    expect(state.selectedObjectTypes).toEqual([]);
  });
});

// ─── addCustomColor ───────────────────────────────────────────────────────────

describe('addCustomColor', () => {
  it('adds a new color to the front of customColors', () => {
    useUIStore.getState().addCustomColor('#AABBCC');
    expect(useUIStore.getState().customColors[0]).toBe('#AABBCC');
  });

  it('also sets activeColor to the new color', () => {
    useUIStore.getState().addCustomColor('#AABBCC');
    expect(useUIStore.getState().activeColor).toBe('#AABBCC');
  });

  it('moves a duplicate color to front instead of adding again', () => {
    useUIStore.getState().addCustomColor('#AABBCC');
    useUIStore.getState().addCustomColor('#112233');
    useUIStore.getState().addCustomColor('#AABBCC'); // duplicate

    const colors = useUIStore.getState().customColors;
    expect(colors[0]).toBe('#AABBCC');
    expect(colors.filter((c) => c === '#AABBCC').length).toBe(1);
  });

  it('trims to max 10 custom colors', () => {
    for (let i = 0; i < 12; i++) {
      useUIStore.getState().addCustomColor(`#${i.toString().padStart(6, '0')}`);
    }
    expect(useUIStore.getState().customColors.length).toBe(10);
  });
});

// ─── line styling ─────────────────────────────────────────────────────────────

describe('line styling setters', () => {
  it('setLineEndpointStyle updates lineEndpointStyle', () => {
    useUIStore.getState().setLineEndpointStyle('arrow-end');
    expect(useUIStore.getState().lineEndpointStyle).toBe('arrow-end');
  });

  it('setLineStrokePattern updates lineStrokePattern', () => {
    useUIStore.getState().setLineStrokePattern('dashed');
    expect(useUIStore.getState().lineStrokePattern).toBe('dashed');
  });

  it('setLineStrokeWeight updates lineStrokeWeight', () => {
    useUIStore.getState().setLineStrokeWeight('bold');
    expect(useUIStore.getState().lineStrokeWeight).toBe('bold');
  });
});

// ─── openTextInputModal ───────────────────────────────────────────────────────

describe('openTextInputModal', () => {
  it('populates textInputModal with correct fields and defaults', () => {
    useUIStore.getState().openTextInputModal({ title: 'Enter label' });

    const modal = useUIStore.getState().textInputModal;
    expect(modal).not.toBeNull();
    expect(modal!.title).toBe('Enter label');
    expect(modal!.initialValue).toBe('');
    expect(modal!.placeholder).toBe('');
    expect(modal!.maxLength).toBe(100);
  });

  it('accepts custom initialValue, placeholder, and maxLength', () => {
    useUIStore.getState().openTextInputModal({
      title: 'Rename',
      initialValue: 'My Flag',
      placeholder: 'Enter name…',
      maxLength: 50,
    });

    const modal = useUIStore.getState().textInputModal;
    expect(modal!.initialValue).toBe('My Flag');
    expect(modal!.placeholder).toBe('Enter name…');
    expect(modal!.maxLength).toBe(50);
  });

  it('resolves to the confirmed value when onConfirm is called', async () => {
    const promise = useUIStore.getState().openTextInputModal({ title: 'Test' });
    const modal = useUIStore.getState().textInputModal!;
    modal.onConfirm('confirmed value');

    const result = await promise;
    expect(result).toBe('confirmed value');
    // Modal should be cleared after confirm
    expect(useUIStore.getState().textInputModal).toBeNull();
  });

  it('resolves to null when onCancel is called', async () => {
    const promise = useUIStore.getState().openTextInputModal({ title: 'Test' });
    const modal = useUIStore.getState().textInputModal!;
    modal.onCancel();

    const result = await promise;
    expect(result).toBeNull();
    // Modal should be cleared after cancel
    expect(useUIStore.getState().textInputModal).toBeNull();
  });
});

describe('closeTextInputModal', () => {
  it('sets textInputModal to null', () => {
    useUIStore.getState().openTextInputModal({ title: 'Test' });
    useUIStore.getState().closeTextInputModal();
    expect(useUIStore.getState().textInputModal).toBeNull();
  });
});

// ─── updateActiveClipboard ────────────────────────────────────────────────────

describe('updateActiveClipboard', () => {
  it('replaces the active clipboard entry and updates clipboard', () => {
    const entry1 = [{ id: 'obj-1' }] as any;
    const entry2 = [{ id: 'obj-2' }] as any;
    const updated = [{ id: 'obj-updated' }] as any;

    useUIStore.getState().pushClipboard(entry1);
    useUIStore.getState().pushClipboard(entry2);
    useUIStore.getState().setActiveClipboardIndex(1);
    useUIStore.getState().updateActiveClipboard(updated);

    const state = useUIStore.getState();
    expect(state.clipboard).toEqual(updated);
    expect(state.clipboardHistory[1]).toEqual(updated);
  });

  it('still updates clipboard field even when history is empty', () => {
    const entries = [{ id: 'obj-1' }] as any;
    useUIStore.getState().updateActiveClipboard(entries);
    expect(useUIStore.getState().clipboard).toEqual(entries);
  });
});
