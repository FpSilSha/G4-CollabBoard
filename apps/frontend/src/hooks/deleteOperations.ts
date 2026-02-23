import { fabric } from 'fabric';
import type { Socket } from 'socket.io-client';
import { useUIStore } from '../stores/uiStore';
import { useBoardStore } from '../stores/boardStore';
import { useFlagStore } from '../stores/flagStore';
import { WebSocketEvent } from 'shared';
import { detachConnectorsFromObject } from '../utils/connectorAttachment';
import { isMarchingAntsActive, dismissMarchingAnts } from './clipboardOperations';

// ============================================================
// Delete Handler
// ============================================================

/**
 * Delete the currently selected object(s) from both the Fabric.js canvas
 * and the Zustand boardStore. Also emits object:delete to the server.
 *
 * Exported so that other features can reuse the same deletion logic.
 *
 * Supports:
 * - Single object deletion
 * - Multi-select (ActiveSelection) — iterates all grouped objects
 * - Pinned object guard — objects with data.pinned === true are skipped
 */
export function handleDeleteSelected(socket: Socket | null): void {
  const canvas = useBoardStore.getState().canvas;
  if (!canvas) return;

  const activeObj = canvas.getActiveObject();
  if (!activeObj) return;

  // Dismiss marching ants if active — prevents stale mouse:down handler from
  // stealing the next click and locking the user out of selection.
  if (isMarchingAntsActive()) {
    dismissMarchingAnts(canvas);
  }

  const boardId = useBoardStore.getState().boardId;
  const cachedToken = useBoardStore.getState().cachedAuthToken;

  // Helper: delete a teleport flag via REST API + remove from flag store.
  // Only removes from canvas AFTER server confirms (prevents ghost deletes on 403).
  const deleteFlagObject = async (obj: fabric.Object) => {
    const flagId = obj.data?.flagId as string | undefined;
    if (!flagId || !boardId || !cachedToken) return;
    try {
      await useFlagStore.getState().deleteFlag(boardId, flagId, cachedToken);
      canvas.remove(obj);
      canvas.requestRenderAll();
    } catch (err) {
      console.error('[handleDeleteSelected] Flag delete failed:', err);
      useUIStore.getState().showToast('Cannot delete this flag — you are not the creator or board owner');
    }
  };

  // Helper: orphan children when a frame is deleted — restore selectability
  const orphanFrameChildren = (frameId: string) => {
    for (const obj of canvas.getObjects()) {
      if (obj.data?.frameId === frameId) {
        obj.data = { ...obj.data, frameId: null };
        obj.set({ selectable: true, evented: true });
        useBoardStore.getState().updateObject(obj.data.id, { frameId: null });
        if (boardId && socket?.connected) {
          socket.emit(WebSocketEvent.OBJECT_UPDATE, {
            boardId,
            objectId: obj.data.id,
            updates: { frameId: null },
            timestamp: Date.now(),
          });
        }
      }
    }
  };

  if (activeObj.type === 'activeSelection') {
    const objects = (activeObj as fabric.ActiveSelection).getObjects().slice();
    canvas.discardActiveObject();

    // Collect all object IDs for a single batch delete message
    const deletedIds: string[] = [];

    // Collect objects to remove, then batch-process
    const objectsToRemove: fabric.Object[] = [];

    for (const obj of objects) {
      if (obj.data?.pinned) continue;

      // Teleport flags use flagId, not id — handle separately
      if (obj.data?.type === 'teleportFlag') {
        deleteFlagObject(obj);
        continue;
      }

      const objectId = obj.data?.id;

      // Orphan children before removing frame
      if (obj.data?.type === 'frame' && objectId) {
        orphanFrameChildren(objectId);
      }

      // Detach connectors that reference this object
      if (objectId) {
        detachConnectorsFromObject(canvas, objectId);
      }

      objectsToRemove.push(obj);
      if (objectId) {
        deletedIds.push(objectId);
      }
    }

    // Batch remove from canvas
    for (const obj of objectsToRemove) {
      canvas.remove(obj);
    }

    // Single Zustand state update for all removals (avoids 300+ re-renders)
    useBoardStore.getState().removeObjects(deletedIds);

    // Send ALL deletes in a single batch WS message
    if (deletedIds.length > 0 && boardId && socket?.connected) {
      socket.emit(WebSocketEvent.OBJECTS_BATCH_DELETE, {
        boardId,
        objectIds: deletedIds,
        timestamp: Date.now(),
      });
    }
  } else {
    if (activeObj.data?.pinned) return;

    // Teleport flags use flagId, not id — handle separately
    if (activeObj.data?.type === 'teleportFlag') {
      deleteFlagObject(activeObj);
      canvas.requestRenderAll();
      return;
    }

    const objectId = activeObj.data?.id;

    // Orphan children before removing frame
    if (activeObj.data?.type === 'frame' && objectId) {
      orphanFrameChildren(objectId);
    }

    // Detach connectors that reference this object
    if (objectId) {
      detachConnectorsFromObject(canvas, objectId);
    }

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
