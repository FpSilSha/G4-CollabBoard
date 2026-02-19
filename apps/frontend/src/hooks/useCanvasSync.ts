import { useEffect, useRef } from 'react';
import { fabric } from 'fabric';
import type { Socket } from 'socket.io-client';
import {
  WebSocketEvent,
  THROTTLE_CONFIG,
  type BoardStatePayload,
  type ObjectCreatedPayload,
  type ObjectUpdatedPayload,
  type ObjectDeletedPayload,
  type CursorMovedPayload,
  type UserJoinedPayload,
  type UserLeftPayload,
  type EditWarningPayload,
  type BoardObject,
} from 'shared';
import { useBoardStore } from '../stores/boardStore';
import { usePresenceStore } from '../stores/presenceStore';
import {
  findFabricObjectById,
  fabricToBoardObject,
  boardObjectToFabric,
  updateStickyColor,
  getStickyChildren,
} from '../utils/fabricHelpers';
import { throttle } from '../utils/throttle';

/**
 * Bridges Fabric.js canvas events <-> WebSocket events.
 *
 * OUTBOUND (local Fabric events → socket.emit):
 *   - mouse:move → cursor:move (throttled 50ms per .clauderules)
 *   - object:moving → object:update (throttled 100ms per .clauderules)
 *   - object:modified → object:update (UNTHROTTLED — Final State Rule)
 *
 * INBOUND (socket.on → local Fabric canvas updates):
 *   - board:state → clearCanvas + renderAll from server
 *   - object:created → add to canvas (if from other user)
 *   - object:updated → update on canvas (if from other user)
 *   - object:deleted → remove from canvas (if from other user)
 *   - cursor:moved → update presenceStore
 *   - user:joined / user:left → update presenceStore
 *
 * Anti-patterns avoided per .clauderules:
 *   - Never emit WS events in render loop
 *   - Never sync by array index (always data.id)
 *   - Never use volatile for object state events
 */
export function useCanvasSync(
  socketRef: React.MutableRefObject<Socket | null>,
  fabricRef: React.MutableRefObject<fabric.Canvas | null>
) {
  const throttledCursorRef = useRef<ReturnType<typeof throttle> | null>(null);
  const throttledObjectMoveRef = useRef<ReturnType<typeof throttle> | null>(null);

  // Subscribe to connectionStatus so this effect re-runs when the socket
  // connects. Without this, the effect captures socketRef.current as null
  // on page refresh (socket isn't ready yet) and never registers listeners.
  const connectionStatus = usePresenceStore((s) => s.connectionStatus);

  useEffect(() => {
    const canvas = fabricRef.current;
    const socket = socketRef.current;
    if (!canvas || !socket) return;

    // =========================================================
    // OUTBOUND: Fabric.js events -> socket.emit
    // =========================================================

    // --- Cursor movement (throttled 50ms) ---
    const emitCursor = (x: number, y: number) => {
      const boardId = useBoardStore.getState().boardId;
      if (!boardId || !socket.connected) return;
      socket.emit(WebSocketEvent.CURSOR_MOVE, {
        boardId,
        x,
        y,
        timestamp: Date.now(),
      });
    };

    const throttledCursor = throttle(emitCursor, THROTTLE_CONFIG.CURSOR_MOVE_MS);
    throttledCursorRef.current = throttledCursor;

    const handleMouseMove = (opt: fabric.IEvent) => {
      const pointer = canvas.getPointer(opt.e);
      throttledCursor(pointer.x, pointer.y);
    };

    canvas.on('mouse:move', handleMouseMove);

    // --- Object moving during drag (throttled 100ms) ---
    const emitObjectMove = (objectId: string, x: number, y: number) => {
      const boardId = useBoardStore.getState().boardId;
      if (!boardId || !socket.connected) return;
      socket.emit(WebSocketEvent.OBJECT_UPDATE, {
        boardId,
        objectId,
        updates: { x, y },
        timestamp: Date.now(),
      });
    };

    const throttledObjectMove = throttle(emitObjectMove, THROTTLE_CONFIG.OBJECT_MOVING_MS);
    throttledObjectMoveRef.current = throttledObjectMove;

    const handleObjectMoving = (opt: fabric.IEvent) => {
      const target = opt.target;
      if (!target?.data?.id) return;
      throttledObjectMove(target.data.id, target.left ?? 0, target.top ?? 0);
    };

    canvas.on('object:moving', handleObjectMoving);

    // --- Object modified (mouse:up / end of interaction) ---
    // Per .clauderules: UNTHROTTLED — cancel throttle, emit immediately (Final State Rule)
    const handleObjectModified = (opt: fabric.IEvent) => {
      const target = opt.target;
      if (!target?.data?.id) return;

      // Cancel any pending throttled move emission
      throttledObjectMove.cancel();

      const boardId = useBoardStore.getState().boardId;
      if (!boardId || !socket.connected) return;

      const localUserId = usePresenceStore.getState().localUserId;

      // Build full updates from the fabric object's current state
      const boardObj = fabricToBoardObject(target, localUserId ?? undefined);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id, createdBy, createdAt, type, ...updates } = boardObj as unknown as Record<string, unknown>;

      socket.emit(WebSocketEvent.OBJECT_UPDATE, {
        boardId,
        objectId: target.data.id,
        updates,
        timestamp: Date.now(),
      });

      // Also update boardStore
      useBoardStore.getState().updateObject(
        target.data.id,
        updates as Partial<BoardObject>
      );
    };

    canvas.on('object:modified', handleObjectModified);

    // =========================================================
    // INBOUND: socket.on -> update canvas
    // =========================================================

    const localUserId = usePresenceStore.getState().localUserId;

    // --- board:state (initial load + reconnect) ---
    // Per .clauderules: reconnect = full re-render, do NOT merge with local state.
    // Exception: if the local user is editing a sticky (textarea open),
    // preserve that Fabric object so the textarea and in-progress text survive.
    const handleBoardState = (payload: BoardStatePayload) => {
      const { boardId, objects, users } = payload;

      // Update board metadata
      useBoardStore.getState().setBoardId(boardId);

      // Check if we're actively editing an object (textarea open)
      const editingId = useBoardStore.getState().editingObjectId;
      let preservedFabricObj: fabric.Object | undefined;

      if (editingId) {
        // Find the Fabric object currently being edited on the canvas
        preservedFabricObj = findFabricObjectById(canvas, editingId);
      }

      // Clear canvas — but re-add the preserved object after clear
      canvas.clear();
      useBoardStore.getState().clearObjects();

      if (preservedFabricObj) {
        canvas.add(preservedFabricObj);
      }

      // Render each object from server
      const boardObjects: BoardObject[] = [];
      objects.forEach((obj: BoardObject) => {
        if (editingId && obj.id === editingId) {
          // Skip rebuilding the object we're editing — it's already preserved.
          // Still include it in the store so the data stays consistent.
          boardObjects.push(obj);
          return;
        }
        const fabricObj = boardObjectToFabric(obj);
        if (fabricObj) {
          canvas.add(fabricObj);
          boardObjects.push(obj);
        }
      });

      // Bulk-set objects in store
      useBoardStore.getState().setObjects(boardObjects);
      canvas.requestRenderAll();

      // Update presence — filter out local user
      const currentLocalUserId = usePresenceStore.getState().localUserId;
      const remote = users.filter((u) => u.userId !== currentLocalUserId);
      usePresenceStore.getState().setRemoteUsers(remote);

      // Set local user info from the users list
      const localInfo = users.find((u) => u.userId === currentLocalUserId);
      if (localInfo) {
        usePresenceStore.getState().setLocalUser(
          localInfo.userId,
          localInfo.name,
          localInfo.color
        );
      }
    };

    socket.on(WebSocketEvent.BOARD_STATE, handleBoardState);

    // --- object:created ---
    const handleObjectCreated = (payload: ObjectCreatedPayload) => {
      const { object, userId } = payload;
      const currentLocalUserId = usePresenceStore.getState().localUserId;

      // Skip if this is our own creation (already on canvas optimistically)
      if (userId === currentLocalUserId) {
        return;
      }

      // Create Fabric object from server data and add to canvas
      const fabricObj = boardObjectToFabric(object);
      if (fabricObj) {
        canvas.add(fabricObj);
        canvas.requestRenderAll();
        useBoardStore.getState().addObject(object);
      }
    };

    socket.on(WebSocketEvent.OBJECT_CREATED, handleObjectCreated);

    // --- object:updated ---
    const handleObjectUpdated = (payload: ObjectUpdatedPayload) => {
      const { objectId, updates, userId } = payload;
      const currentLocalUserId = usePresenceStore.getState().localUserId;

      // Skip if this is our own update (already applied locally)
      if (userId === currentLocalUserId) return;

      const fabricObj = findFabricObjectById(canvas, objectId);
      if (!fabricObj) return;

      // Apply positional updates.
      // Detect if this is a drag-in-progress (only x/y fields) and use
      // Fabric.js animate() for smooth interpolation between 100ms updates.
      const u = updates as Record<string, unknown>;

      // If the local user is editing this sticky's text (textarea open),
      // skip incoming text updates — the textarea is the source of truth.
      // Other updates (position, color, size) still apply normally.
      const editingObjectId = useBoardStore.getState().editingObjectId;
      if (editingObjectId === objectId && u.text !== undefined) {
        delete u.text;
      }
      const updateKeys = Object.keys(u).filter(
        (k) => k !== 'updatedAt' && k !== 'lastEditedBy'
      );
      const isPositionOnly =
        updateKeys.length <= 2 &&
        updateKeys.every((k) => k === 'x' || k === 'y');

      if (isPositionOnly && (u.x !== undefined || u.y !== undefined)) {
        // Smooth animate for drag-in-progress position updates
        if (u.x !== undefined) {
          fabricObj.animate('left', u.x as number, {
            duration: 100,
            onChange: () => canvas.requestRenderAll(),
            easing: fabric.util.ease.easeOutQuad,
          });
        }
        if (u.y !== undefined) {
          fabricObj.animate('top', u.y as number, {
            duration: 100,
            onChange: () => canvas.requestRenderAll(),
            easing: fabric.util.ease.easeOutQuad,
          });
        }
      } else {
        // Snap immediately for full state updates (final state, resize, etc.)
        if (u.x !== undefined) fabricObj.set('left', u.x as number);
        if (u.y !== undefined) fabricObj.set('top', u.y as number);
      }
      if (u.rotation !== undefined) fabricObj.set('angle', u.rotation as number);

      // Apply type-specific updates
      if (fabricObj.data?.type === 'sticky' && fabricObj instanceof fabric.Group) {
        if (u.color) {
          updateStickyColor(fabricObj, u.color as string);
        }
        if (u.text !== undefined) {
          fabricObj.data.text = u.text as string;
          const { text } = getStickyChildren(fabricObj);
          text.set('text', u.text as string);
        }
        // Apply size updates — reset scale to 1 since we set actual dimensions
        if (u.width !== undefined || u.height !== undefined) {
          if (u.width !== undefined) fabricObj.set('width', u.width as number);
          if (u.height !== undefined) fabricObj.set('height', u.height as number);
          fabricObj.set('scaleX', 1);
          fabricObj.set('scaleY', 1);
        }
      } else {
        // Shape updates
        if (u.color) fabricObj.set('fill', u.color as string);
        // Apply size updates — reset scale to 1 since we set actual dimensions
        if (u.width !== undefined || u.height !== undefined) {
          if (fabricObj.data?.shapeType === 'circle') {
            // For circles, width = diameter, so set radius = width / 2
            const diameter = (u.width ?? u.height) as number;
            (fabricObj as fabric.Circle).set('radius', diameter / 2);
          } else {
            if (u.width !== undefined) fabricObj.set('width', u.width as number);
            if (u.height !== undefined) fabricObj.set('height', u.height as number);
          }
          fabricObj.set('scaleX', 1);
          fabricObj.set('scaleY', 1);
        }
      }

      fabricObj.setCoords();
      canvas.requestRenderAll();

      // Update boardStore
      useBoardStore.getState().updateObject(objectId, updates as Partial<BoardObject>);
    };

    socket.on(WebSocketEvent.OBJECT_UPDATED, handleObjectUpdated);

    // --- object:deleted ---
    const handleObjectDeleted = (payload: ObjectDeletedPayload) => {
      const { objectId, userId } = payload;
      const currentLocalUserId = usePresenceStore.getState().localUserId;

      if (userId === currentLocalUserId) return;

      const fabricObj = findFabricObjectById(canvas, objectId);
      if (fabricObj) {
        canvas.remove(fabricObj);
        canvas.requestRenderAll();
      }
      useBoardStore.getState().removeObject(objectId);
    };

    socket.on(WebSocketEvent.OBJECT_DELETED, handleObjectDeleted);

    // --- cursor:moved ---
    const handleCursorMoved = (payload: CursorMovedPayload) => {
      const currentLocalUserId = usePresenceStore.getState().localUserId;
      if (payload.userId === currentLocalUserId) return;

      // Look up user info from presence store for name/color
      const user = usePresenceStore.getState().remoteUsers.get(payload.userId);
      const name = user?.name ?? 'Unknown';
      const color = user?.color ?? '#999999';

      usePresenceStore.getState().updateRemoteCursor(
        payload.userId,
        payload.x,
        payload.y,
        name,
        color
      );
    };

    socket.on(WebSocketEvent.CURSOR_MOVED, handleCursorMoved);

    // --- user:joined ---
    const handleUserJoined = (payload: UserJoinedPayload) => {
      const currentLocalUserId = usePresenceStore.getState().localUserId;
      if (payload.user.userId === currentLocalUserId) return;
      usePresenceStore.getState().addRemoteUser(payload.user);
    };

    socket.on(WebSocketEvent.USER_JOINED, handleUserJoined);

    // --- user:left ---
    // Per .clauderules: remove cursor from UI immediately on user:left
    const handleUserLeft = (payload: UserLeftPayload) => {
      usePresenceStore.getState().removeRemoteUser(payload.userId);
    };

    socket.on(WebSocketEvent.USER_LEFT, handleUserLeft);

    // --- edit:reclaim (reconnect with active edit lock) ---
    // Server confirms the user's edit lock was preserved across the disconnect.
    // The textarea was already preserved in handleBoardState above.
    // Log for debugging; no additional action needed.
    const handleEditReclaim = (payload: { boardId: string; objectIds: string[] }) => {
      const editingId = useBoardStore.getState().editingObjectId;
      if (editingId && payload.objectIds.includes(editingId)) {
        console.debug(`Edit lock reclaimed for object ${editingId} after reconnect`);
      }
    };

    socket.on('edit:reclaim', handleEditReclaim);

    // --- edit:warning (server response with list of other editors) ---
    // Received when *we* start editing and others are already editing the same object.
    const handleEditWarning = (payload: EditWarningPayload) => {
      const editingId = useBoardStore.getState().editingObjectId;
      if (editingId && editingId === payload.objectId) {
        useBoardStore.getState().setConcurrentEditors(payload.editors);
      }
    };

    socket.on(WebSocketEvent.EDIT_WARNING, handleEditWarning);

    // --- edit:start (broadcast — another user started editing) ---
    // If we're currently editing the same object, add them to the warning list.
    const handleEditStartBroadcast = (payload: {
      boardId: string;
      objectId: string;
      userId: string;
      userName: string;
      timestamp: number;
    }) => {
      const editingId = useBoardStore.getState().editingObjectId;
      if (editingId && editingId === payload.objectId) {
        useBoardStore.getState().addConcurrentEditor({
          userId: payload.userId,
          userName: payload.userName,
        });
      }
    };

    socket.on(WebSocketEvent.EDIT_START, handleEditStartBroadcast);

    // --- edit:end (broadcast — another user stopped editing) ---
    // If we're currently editing the same object, remove them from the warning list.
    const handleEditEndBroadcast = (payload: {
      boardId: string;
      objectId: string;
      userId: string;
      timestamp: number;
    }) => {
      const editingId = useBoardStore.getState().editingObjectId;
      if (editingId && editingId === payload.objectId) {
        useBoardStore.getState().removeConcurrentEditor(payload.userId);
      }
    };

    socket.on(WebSocketEvent.EDIT_END, handleEditEndBroadcast);

    // =========================================================
    // Stale cursor cleanup (per .clauderules: fade out after 5s)
    // =========================================================
    const staleCursorInterval = setInterval(() => {
      const now = Date.now();
      const cursors = usePresenceStore.getState().remoteCursors;
      cursors.forEach((cursor, cursorUserId) => {
        if (now - cursor.lastUpdate > 5000) {
          usePresenceStore.getState().removeRemoteCursor(cursorUserId);
        }
      });
    }, 1000);

    // =========================================================
    // Cleanup
    // =========================================================
    return () => {
      canvas.off('mouse:move', handleMouseMove);
      canvas.off('object:moving', handleObjectMoving);
      canvas.off('object:modified', handleObjectModified);

      socket.off(WebSocketEvent.BOARD_STATE, handleBoardState);
      socket.off(WebSocketEvent.OBJECT_CREATED, handleObjectCreated);
      socket.off(WebSocketEvent.OBJECT_UPDATED, handleObjectUpdated);
      socket.off(WebSocketEvent.OBJECT_DELETED, handleObjectDeleted);
      socket.off(WebSocketEvent.CURSOR_MOVED, handleCursorMoved);
      socket.off(WebSocketEvent.USER_JOINED, handleUserJoined);
      socket.off(WebSocketEvent.USER_LEFT, handleUserLeft);
      socket.off('edit:reclaim', handleEditReclaim);
      socket.off(WebSocketEvent.EDIT_WARNING, handleEditWarning);
      socket.off(WebSocketEvent.EDIT_START, handleEditStartBroadcast);
      socket.off(WebSocketEvent.EDIT_END, handleEditEndBroadcast);

      throttledCursor.cancel();
      throttledObjectMove.cancel();
      clearInterval(staleCursorInterval);
    };
  }, [socketRef, fabricRef, connectionStatus]);
}
