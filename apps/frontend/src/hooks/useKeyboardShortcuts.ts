import { useEffect } from 'react';
import { useUIStore } from '../stores/uiStore';
import { useBoardStore } from '../stores/boardStore';

/**
 * Global keyboard shortcuts:
 *
 *   V - Select tool
 *   S - Sticky note tool
 *   R - Rectangle tool
 *   C - Circle tool
 *   I - Dropper (eyedropper) tool
 *   H - Home (return viewport to center)
 *   Delete / Backspace - Delete selected object
 *   Escape - Deselect all, return to select tool
 *
 * Shortcuts are suppressed when:
 * - User is typing in an <input> or <textarea>
 * - A Fabric.js IText is in editing mode (checked via activeObject.isEditing)
 */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Suppress shortcuts when typing in form elements
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      // Suppress shortcuts when editing text in Fabric.js IText
      const canvas = useBoardStore.getState().canvas;
      if (canvas) {
        const activeObj = canvas.getActiveObject();
        if (activeObj && (activeObj as any).isEditing) return;
      }

      const key = e.key.toLowerCase();

      switch (key) {
        case 'v':
          useUIStore.getState().setActiveTool('select');
          break;

        case 's':
          // Prevent browser "Save" dialog
          if (!e.ctrlKey && !e.metaKey) {
            useUIStore.getState().setActiveTool('sticky');
          }
          break;

        case 'r':
          useUIStore.getState().setActiveTool('rectangle');
          break;

        case 'c':
          // Avoid intercepting Ctrl+C (copy)
          if (!e.ctrlKey && !e.metaKey) {
            useUIStore.getState().setActiveTool('circle');
          }
          break;

        case 'i':
          useUIStore.getState().setActiveTool('dropper');
          break;

        case 'h': {
          // Home: center viewport on board center point (0,0)
          const homeCanvas = useBoardStore.getState().canvas;
          if (homeCanvas) {
            const vpt = homeCanvas.viewportTransform!;
            vpt[4] = homeCanvas.getWidth() / 2;
            vpt[5] = homeCanvas.getHeight() / 2;
            homeCanvas.setViewportTransform(vpt);
          }
          break;
        }

        case 'delete':
        case 'backspace':
          handleDeleteSelected();
          break;

        case 'escape':
          // Deselect and return to select tool
          if (canvas) {
            canvas.discardActiveObject();
            canvas.requestRenderAll();
          }
          useUIStore.getState().setActiveTool('select');
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);
}

/**
 * Delete the currently selected object from both the Fabric.js canvas
 * and the Zustand boardStore.
 *
 * Sticky notes are now self-contained Groups — deleting the group
 * automatically removes all its children (base, fold, text).
 */
function handleDeleteSelected(): void {
  const canvas = useBoardStore.getState().canvas;
  if (!canvas) return;

  const activeObj = canvas.getActiveObject();
  if (!activeObj) return;

  const objectId = activeObj.data?.id;

  // Remove the object from canvas
  canvas.remove(activeObj);
  canvas.requestRenderAll();

  // Remove from Zustand store
  if (objectId) {
    useBoardStore.getState().removeObject(objectId);
  }
}
