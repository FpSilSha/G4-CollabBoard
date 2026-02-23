import { useEffect } from 'react';
import { fabric } from 'fabric';
import type { Socket } from 'socket.io-client';
import { useUIStore } from '../stores/uiStore';
import { useBoardStore } from '../stores/boardStore';
import { handleCopy, handlePaste, isMarchingAntsActive, dismissMarchingAnts } from './clipboardOperations';
import { handleDeleteSelected } from './deleteOperations';
import { toggleRotationMode, isRotationModeActive, exitRotationMode } from './rotationMode';

// Re-export for external consumers
export { handleDeleteSelected } from './deleteOperations';
export { setupRotationModeListeners } from './rotationMode';

/**
 * Global keyboard shortcuts:
 *
 *   V - Select tool
 *   S - Sticky note tool
 *   R - Rectangle tool / Rotation mode toggle (when object selected)
 *   C - Copy (Ctrl+C)
 *   I - Dropper (eyedropper) tool
 *   T - Text tool
 *   F - Frame tool
 *   N - Line tool
 *   L - Connector tool
 *   H - Home (return viewport to center)
 *   Delete / Backspace - Delete selected object
 *   Escape - Deselect all, return to select tool, cancel marching ants
 *   Ctrl+A / Cmd+A - Select all objects on canvas
 *   Ctrl+C / Cmd+C - Copy selected objects (deselects, shows marching ants)
 *   Ctrl+V / Cmd+V - Paste clipboard at offset
 *
 * Shortcuts are suppressed when:
 * - User is typing in an <input> or <textarea>
 * - A Fabric.js IText is in editing mode (checked via activeObject.isEditing)
 */
export function useKeyboardShortcuts(
  socketRef?: React.MutableRefObject<Socket | null>
): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Suppress shortcuts when typing in form elements
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      // Suppress shortcuts when editing text in Fabric.js IText
      const canvas = useBoardStore.getState().canvas;
      if (canvas) {
        const activeObj = canvas.getActiveObject();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (activeObj && (activeObj as any).isEditing) return;
      }

      const key = e.key.toLowerCase();

      switch (key) {
        case 'v':
          // Ctrl+V = paste, plain V = select tool
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            handlePaste(socketRef?.current ?? null);
          } else {
            useUIStore.getState().setActiveTool('select');
          }
          break;

        case 's':
          // Prevent browser "Save" dialog
          if (!e.ctrlKey && !e.metaKey) {
            useUIStore.getState().setActiveTool('sticky');
          }
          break;

        case 'r':
          // If an object is selected, toggle rotation mode; otherwise shape tool
          if (canvas) {
            const activeForRotation = canvas.getActiveObject();
            if (activeForRotation && activeForRotation.type !== 'activeSelection') {
              e.preventDefault();
              toggleRotationMode(canvas, activeForRotation);
            } else {
              // Activate whichever shape sub-tool is currently selected
              useUIStore.getState().setActiveTool(useUIStore.getState().activeShapeTool);
            }
          } else {
            useUIStore.getState().setActiveTool(useUIStore.getState().activeShapeTool);
          }
          break;

        case 'a':
          // Ctrl+A = select all objects visible in the current viewport
          if ((e.ctrlKey || e.metaKey) && canvas) {
            e.preventDefault();
            // Calculate viewport bounds in board coordinates
            const vpt = canvas.viewportTransform;
            if (vpt) {
              const zoom = vpt[0];
              const vpLeft = -vpt[4] / zoom;
              const vpTop = -vpt[5] / zoom;
              const vpRight = vpLeft + canvas.getWidth() / zoom;
              const vpBottom = vpTop + canvas.getHeight() / zoom;

              const visibleObjects = canvas.getObjects().filter((obj) => {
                if (!obj.selectable || !obj.evented || obj.data?.isGrid) return false;
                // Check if object overlaps with viewport
                const objLeft = obj.left ?? 0;
                const objTop = obj.top ?? 0;
                const objWidth = (obj.width ?? 0) * (obj.scaleX ?? 1);
                const objHeight = (obj.height ?? 0) * (obj.scaleY ?? 1);
                return (
                  objLeft + objWidth > vpLeft &&
                  objLeft < vpRight &&
                  objTop + objHeight > vpTop &&
                  objTop < vpBottom
                );
              });

              if (visibleObjects.length > 0) {
                canvas.discardActiveObject();
                const selection = new fabric.ActiveSelection(visibleObjects, { canvas });
                canvas.setActiveObject(selection);
                canvas.requestRenderAll();
              }
            }
          }
          break;

        case 'c':
          // Ctrl+C = copy, plain C = no longer a tool shortcut (circle is in shape panel)
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            handleCopy();
          }
          break;

        case 'i':
          useUIStore.getState().setActiveTool('dropper');
          break;

        case 't':
          useUIStore.getState().setActiveTool('text');
          break;

        case 'f':
          useUIStore.getState().setActiveTool('frame');
          break;

        case 'n':
          useUIStore.getState().setActiveTool('line');
          break;

        case 'l':
          useUIStore.getState().setActiveTool('connector');
          break;

        case 'h': {
          // Home: center viewport on board center point (0,0)
          const homeCanvas = useBoardStore.getState().canvas;
          if (homeCanvas) {
            const vpt = homeCanvas.viewportTransform!;
            vpt[4] = homeCanvas.getWidth() / 2;
            vpt[5] = homeCanvas.getHeight() / 2;
            homeCanvas.setViewportTransform(vpt);
            homeCanvas.requestRenderAll();
          }
          break;
        }

        case 'delete':
        case 'backspace':
          handleDeleteSelected(socketRef?.current ?? null);
          break;

        case 'escape':
          // Cancel marching ants if active
          if (canvas && isMarchingAntsActive()) {
            dismissMarchingAnts(canvas);
          }
          // Exit rotation mode if active
          if (canvas && isRotationModeActive()) {
            exitRotationMode(canvas);
          }
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
