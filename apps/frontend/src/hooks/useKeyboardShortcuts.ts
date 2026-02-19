import { useEffect } from 'react';
import type { Socket } from 'socket.io-client';
import { useUIStore } from '../stores/uiStore';
import { useBoardStore } from '../stores/boardStore';
import { WebSocketEvent } from 'shared';

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
 *
 * In Phase 4, the optional socketRef parameter enables emitting
 * `object:delete` to the server when objects are deleted via keyboard.
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
          handleDeleteSelected(socketRef?.current ?? null);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * Delete the currently selected object(s) from both the Fabric.js canvas
 * and the Zustand boardStore. Also emits object:delete to the server.
 *
 * Exported so that other features (e.g. drag-to-trash) can reuse the
 * same deletion logic.
 *
 * Supports:
 * - Single object deletion
 * - Multi-select (ActiveSelection) — iterates all grouped objects
 * - Pinned object guard — objects with data.pinned === true are skipped
 *
 * Sticky notes are self-contained Groups — deleting the group
 * automatically removes all its children (base, fold, text).
 */
export function handleDeleteSelected(socket: Socket | null): void {
  const canvas = useBoardStore.getState().canvas;
  if (!canvas) return;

  const activeObj = canvas.getActiveObject();
  if (!activeObj) return;

  const boardId = useBoardStore.getState().boardId;

  if (activeObj.type === 'activeSelection') {
    // Multi-select: collect objects first, then discard the selection group
    const objects = (activeObj as fabric.ActiveSelection).getObjects().slice();
    canvas.discardActiveObject();

    for (const obj of objects) {
      // Skip pinned objects (forward-looking for pin feature)
      if (obj.data?.pinned) continue;

      const objectId = obj.data?.id;
      canvas.remove(obj);

      if (objectId) {
        useBoardStore.getState().removeObject(objectId);

        if (boardId && socket?.connected) {
          socket.emit(WebSocketEvent.OBJECT_DELETE, {
            boardId,
            objectId,
            timestamp: Date.now(),
          });
        }
      }
    }
  } else {
    // Single object deletion
    if (activeObj.data?.pinned) return; // Skip pinned objects

    const objectId = activeObj.data?.id;
    canvas.remove(activeObj);

    if (objectId) {
      useBoardStore.getState().removeObject(objectId);

      if (boardId && socket?.connected) {
        socket.emit(WebSocketEvent.OBJECT_DELETE, {
          boardId,
          objectId,
          timestamp: Date.now(),
        });
      }
    }
  }

  canvas.requestRenderAll();
}
