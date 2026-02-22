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
  type ObjectsBatchMovedPayload,
  type ObjectsBatchCreatedPayload,
  type ObjectsBatchDeletedPayload,
  type BoardObject,
  type FlagCreatedPayload,
  type FlagUpdatedPayload,
  type FlagDeletedPayload,
} from 'shared';
import { useBoardStore } from '../stores/boardStore';
import { usePresenceStore } from '../stores/presenceStore';
import { useFlagStore } from '../stores/flagStore';
import {
  findFabricObjectById,
  fabricToBoardObject,
  boardObjectToFabric,
  createFlagMarker,
  updateStickyColor,
  updateFrameColor,
  getStickyChildren,
  syncConnectorCoordsAfterMove,
  applyConnectorLockState,
} from '../utils/fabricHelpers';
import { throttle } from '../utils/throttle';
import {
  updateAttachedConnectors,
  detachConnectorsFromObject,
} from '../utils/connectorAttachment';

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

    // --- Batch move for multi-select drag (one message for all objects) ---
    const emitBatchMove = (moves: Array<{ objectId: string; x: number; y: number }>) => {
      const boardId = useBoardStore.getState().boardId;
      if (!boardId || !socket.connected) return;
      socket.emit(WebSocketEvent.OBJECTS_BATCH_UPDATE, {
        boardId,
        moves,
        timestamp: Date.now(),
      });
    };

    const throttledBatchMove = throttle(emitBatchMove, THROTTLE_CONFIG.OBJECT_MOVING_MS);

    /**
     * Get the absolute top-left position of a child inside an ActiveSelection.
     *
     * ActiveSelection uses originX/Y: 'center', so group.left/top is the
     * center of the bounding box and child.left/top are offsets from that
     * center. Using calcTransformMatrix() gives us the absolute CENTER of
     * the child at [4]/[5], then we subtract half dimensions to get top-left
     * (which is what left/top mean for ungrouped objects with originX: 'left').
     */
    function getChildAbsolutePosition(child: fabric.Object): { x: number; y: number } {
      const m = child.calcTransformMatrix();
      return {
        x: m[4] - (child.width! * (child.scaleX ?? 1)) / 2,
        y: m[5] - (child.height! * (child.scaleY ?? 1)) / 2,
      };
    }

    const handleObjectMoving = (opt: fabric.IEvent) => {
      const target = opt.target;
      if (!target) return;

      if (target.type === 'activeSelection') {
        // Multi-select: collect all child positions into a single batch emit.
        const moves: Array<{ objectId: string; x: number; y: number }> = [];

        for (const child of (target as fabric.ActiveSelection).getObjects()) {
          if (!child.data?.id) continue;
          const pos = getChildAbsolutePosition(child);
          moves.push({ objectId: child.data.id, x: pos.x, y: pos.y });

          // Update connectors attached to this child
          if (child.data.type !== 'connector') {
            updateAttachedConnectors(canvas, child.data.id);
          }
        }

        if (moves.length > 0) {
          throttledBatchMove(moves);
        }
      } else {
        if (!target.data?.id) return;
        throttledObjectMove(target.data.id, target.left ?? 0, target.top ?? 0);

        // Update connectors attached to this object (live during drag)
        if (target.data.type !== 'connector') {
          updateAttachedConnectors(canvas, target.data.id);
          canvas.requestRenderAll();
        }
      }
    };

    canvas.on('object:moving', handleObjectMoving);

    // --- Object rotating (live during rotation drag) ---
    // Update attached connectors in real-time so the connector endpoint
    // follows the edge point as the shape rotates, not just on mouse:up.
    const handleObjectRotating = (opt: fabric.IEvent) => {
      const target = opt.target;
      if (!target) return;
      if (!target.data?.id || target.data.type === 'connector') return;

      updateAttachedConnectors(canvas, target.data.id);
      canvas.requestRenderAll();
    };

    canvas.on('object:rotating', handleObjectRotating);

    // --- Object scaling (live during resize drag) ---
    // Same as rotation — update connectors live during resize so
    // edge-locked endpoints track the changing dimensions.
    const handleObjectScaling = (opt: fabric.IEvent) => {
      const target = opt.target;
      if (!target) return;
      if (!target.data?.id || target.data.type === 'connector') return;

      updateAttachedConnectors(canvas, target.data.id);
      canvas.requestRenderAll();
    };

    canvas.on('object:scaling', handleObjectScaling);

    // --- Object modified (mouse:up / end of interaction) ---
    // Per .clauderules: UNTHROTTLED — cancel throttle, emit immediately (Final State Rule)
    //
    // For ActiveSelection (multi-select), we iterate each child and emit
    // individual object:update events. After a group move, Fabric.js updates
    // each child's absolute position when the selection is discarded, but
    // during the event the children still have group-relative coords. We
    // compute absolute positions using the group transform.
    const emitFinalState = (fabricObj: fabric.Object) => {
      const boardId = useBoardStore.getState().boardId;
      if (!boardId || !socket.connected) return;
      if (!fabricObj.data?.id) return;

      const localUserId = usePresenceStore.getState().localUserId;
      const boardObj = fabricToBoardObject(fabricObj, localUserId ?? undefined);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id, createdBy, createdAt, type, ...updates } = boardObj as unknown as Record<string, unknown>;

      socket.emit(WebSocketEvent.OBJECT_UPDATE, {
        boardId,
        objectId: fabricObj.data.id,
        updates,
        timestamp: Date.now(),
      });

      useBoardStore.getState().updateObject(
        fabricObj.data.id,
        updates as Partial<BoardObject>
      );
    };

    const handleObjectModified = (opt: fabric.IEvent) => {
      const target = opt.target;
      if (!target) return;

      // Cancel any pending throttled move emissions (single + batch)
      throttledObjectMove.cancel();
      throttledBatchMove.cancel();

      // Sync Line/Connector coords BEFORE serialization. Fabric.js Line only
      // updates left/top on move but leaves x1/y1/x2/y2 stale. This must
      // happen before emitFinalState so the correct endpoint coordinates
      // are sent to the server.
      if ((target.data?.type === 'connector' || target.data?.type === 'line') && target instanceof fabric.Line) {
        syncConnectorCoordsAfterMove(target);
      }

      // Track connector IDs that were updated via attachment (so we emit final state for them)
      const attachedConnectorIds = new Set<string>();

      if (target.type === 'activeSelection') {
        // Multi-select: emit final state for each child object.
        // Use calcTransformMatrix() to get absolute positions, then
        // temporarily set left/top so fabricToBoardObject serializes
        // the correct absolute coords.
        for (const child of (target as fabric.ActiveSelection).getObjects()) {
          if (!child.data?.id) continue;

          // Sync connector/line children too
          if ((child.data?.type === 'connector' || child.data?.type === 'line') && child instanceof fabric.Line) {
            syncConnectorCoordsAfterMove(child);
          }

          const pos = getChildAbsolutePosition(child);
          const origLeft = child.left ?? 0;
          const origTop = child.top ?? 0;
          child.set('left', pos.x);
          child.set('top', pos.y);

          emitFinalState(child);

          // Update attached connectors for non-connector objects
          if (child.data.type !== 'connector') {
            const updated = updateAttachedConnectors(canvas, child.data.id);
            updated.forEach((id) => attachedConnectorIds.add(id));
          }

          // Restore group-relative coords so Fabric.js selection isn't broken
          child.set('left', origLeft);
          child.set('top', origTop);
        }
      } else {
        emitFinalState(target);

        // Update and emit final state for attached connectors
        if (target.data?.type !== 'connector' && target.data?.id) {
          const updated = updateAttachedConnectors(canvas, target.data.id);
          updated.forEach((id) => attachedConnectorIds.add(id));
        }
      }

      // Emit final state for all connectors that were repositioned via attachment
      for (const connId of attachedConnectorIds) {
        const connObj = findFabricObjectById(canvas, connId);
        if (connObj) {
          emitFinalState(connObj);
        }
      }
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
      const { boardId, objects, users, flags } = payload;

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

      // Sort objects by zIndex (if present) before rendering so canvas order
      // matches persisted stacking order. Objects without zIndex sort last.
      const sorted = [...objects].sort((a, b) => {
        const za = a.zIndex ?? Number.MAX_SAFE_INTEGER;
        const zb = b.zIndex ?? Number.MAX_SAFE_INTEGER;
        return za - zb;
      });

      // Render each object from server
      const boardObjects: BoardObject[] = [];
      const frameObjects: fabric.Object[] = [];
      sorted.forEach((obj: BoardObject) => {
        if (editingId && obj.id === editingId) {
          // Skip rebuilding the object we're editing — it's already preserved.
          // Still include it in the store so the data stays consistent.
          boardObjects.push(obj);
          return;
        }
        const fabricObj = boardObjectToFabric(obj);
        if (fabricObj) {
          canvas.add(fabricObj);
          if (obj.type === 'frame') {
            frameObjects.push(fabricObj);
          }
          boardObjects.push(obj);
        }
      });

      // Send all frames to back so they render behind non-frame objects
      for (const frame of frameObjects) {
        canvas.sendToBack(frame);
      }

      // Make children of locked frames unselectable
      for (const obj of canvas.getObjects()) {
        if (!obj.data?.frameId) continue;
        // Check if the parent frame is locked
        const parentFrame = canvas.getObjects().find(
          (o) => o.data?.id === obj.data.frameId && o.data?.type === 'frame'
        );
        if (parentFrame?.data?.locked) {
          obj.set({ selectable: false, evented: false });
        }
      }

      // Bulk-set objects in store
      useBoardStore.getState().setObjects(boardObjects);

      // Render teleport flag markers on canvas + update flag store
      if (flags && flags.length > 0) {
        for (const flag of flags) {
          const marker = createFlagMarker({
            x: flag.x,
            y: flag.y,
            color: flag.color,
            flagId: flag.id,
            label: flag.label,
          });
          canvas.add(marker);
        }
      }
      useFlagStore.getState().clearFlags();
      if (flags) {
        useFlagStore.setState({ flags });
      }

      canvas.requestRenderAll();

      // Signal that objects are rendered — useThumbnailCapture listens for this
      useBoardStore.getState().setBoardStateLoaded(true);

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
        // Frames always go behind non-frame objects
        if (object.type === 'frame') {
          canvas.sendToBack(fabricObj);
        }
        // If anchored to a locked frame, make unselectable
        if (object.frameId) {
          const parentFrame = canvas.getObjects().find(
            (o) => o.data?.id === object.frameId && o.data?.type === 'frame'
          );
          if (parentFrame?.data?.locked) {
            fabricObj.set({ selectable: false, evented: false });
          }
        }
        canvas.requestRenderAll();
        useBoardStore.getState().addObject(object);
      }
    };

    socket.on(WebSocketEvent.OBJECT_CREATED, handleObjectCreated);

    // --- objects:batch_created (paste from another user) ---
    const handleBatchCreated = (payload: ObjectsBatchCreatedPayload) => {
      const currentLocalUserId = usePresenceStore.getState().localUserId;

      // Skip if this is our own batch (already on canvas optimistically)
      if (payload.userId === currentLocalUserId) return;

      for (const object of payload.objects) {
        const fabricObj = boardObjectToFabric(object);
        if (fabricObj) {
          canvas.add(fabricObj);
          useBoardStore.getState().addObject(object);
        }
      }
      canvas.requestRenderAll();
    };

    socket.on(WebSocketEvent.OBJECTS_BATCH_CREATED, handleBatchCreated);

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
      if (u.rotation !== undefined) {
        fabricObj.set('angle', u.rotation as number);
        // Rotation changes anchor positions — update attached connectors
        if (fabricObj.data?.id && fabricObj.data?.type !== 'connector') {
          updateAttachedConnectors(canvas, fabricObj.data.id);
        }
      }

      // Apply type-specific updates
      const objType = fabricObj.data?.type;

      if (objType === 'sticky' && fabricObj instanceof fabric.Group) {
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
      } else if (objType === 'text') {
        // Standalone text element (IText)
        if (u.text !== undefined) (fabricObj as fabric.IText).set('text', u.text as string);
        if (u.color) fabricObj.set('fill', u.color as string);
        if (u.fontSize !== undefined) (fabricObj as fabric.IText).set('fontSize', u.fontSize as number);
        if (u.fontFamily !== undefined) (fabricObj as fabric.IText).set('fontFamily', u.fontFamily as string);
      } else if (objType === 'line') {
        // Standalone line
        if (u.color) fabricObj.set('stroke', u.color as string);
        const lineObj = fabricObj as fabric.Line;
        if (u.x2 !== undefined) lineObj.set('x2', u.x2 as number);
        if (u.y2 !== undefined) lineObj.set('y2', u.y2 as number);
        // Sync styling in data and trigger re-render
        if (u.endpointStyle !== undefined) fabricObj.data.endpointStyle = u.endpointStyle;
        if (u.strokePattern !== undefined) fabricObj.data.strokePattern = u.strokePattern;
        if (u.strokeWeight !== undefined) fabricObj.data.strokeWeight = u.strokeWeight;
        // Force custom _render() to pick up changes
        fabricObj.dirty = true;
      } else if (objType === 'frame' && fabricObj instanceof fabric.Group) {
        // Frame: update border color + label color together
        if (u.color) {
          updateFrameColor(fabricObj, u.color as string);
        }
        if (u.title !== undefined) {
          fabricObj.data.title = u.title as string;
          // Frame group: [border, labelBg, label]
          const labelText = fabricObj.getObjects()[2] as fabric.Text;
          labelText.set('text', u.title as string);
          // Resize label background to match new text width
          const labelBg = fabricObj.getObjects()[1] as fabric.Rect;
          labelBg.set('width', (labelText.width ?? 0) + 12);
          labelBg.set('height', (labelText.height ?? 16) + 4);
        }
        if (u.locked !== undefined) {
          fabricObj.data.locked = u.locked as boolean;
        }
        if (u.width !== undefined || u.height !== undefined) {
          if (u.width !== undefined) fabricObj.set('width', u.width as number);
          if (u.height !== undefined) fabricObj.set('height', u.height as number);
          fabricObj.set('scaleX', 1);
          fabricObj.set('scaleY', 1);
        }
      } else if (objType === 'connector') {
        // Connector line
        if (u.color) fabricObj.set('stroke', u.color as string);
        // Update endpoint coordinates
        const connLine = fabricObj as fabric.Line;
        if (u.x2 !== undefined) connLine.set('x2', u.x2 as number);
        if (u.y2 !== undefined) connLine.set('y2', u.y2 as number);
        // Sync attachment IDs and anchors
        if (u.fromObjectId !== undefined) fabricObj.data.fromObjectId = u.fromObjectId;
        if (u.toObjectId !== undefined) fabricObj.data.toObjectId = u.toObjectId;
        if (u.fromAnchor !== undefined) fabricObj.data.fromAnchor = u.fromAnchor;
        if (u.toAnchor !== undefined) fabricObj.data.toAnchor = u.toAnchor;
        // Apply movement lock/unlock based on anchor state
        if (u.fromAnchor !== undefined || u.toAnchor !== undefined) {
          applyConnectorLockState(connLine);
        }
      } else {
        // Shape updates (rectangle, circle)
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

      // Size changes affect anchor positions — update attached connectors
      if ((u.width !== undefined || u.height !== undefined) &&
          objType !== 'connector' && fabricObj.data?.id) {
        updateAttachedConnectors(canvas, fabricObj.data.id);
      }

      // Apply frameId changes (applies to all object types)
      if (u.frameId !== undefined) {
        fabricObj.data = { ...fabricObj.data, frameId: u.frameId };
        if (u.frameId) {
          // Check if parent frame is locked — if so, make unselectable
          const parentFrame = canvas.getObjects().find(
            (o) => o.data?.id === u.frameId && o.data?.type === 'frame'
          );
          if (parentFrame?.data?.locked) {
            fabricObj.set({ selectable: false, evented: false });
          }
        } else {
          // Unanchored — restore selectability
          fabricObj.set({ selectable: true, evented: true });
        }
      }

      // When a frame's locked state changes, update children selectability
      if (objType === 'frame' && u.locked !== undefined) {
        const frameId = fabricObj.data?.id;
        const isNowLocked = u.locked as boolean;
        for (const child of canvas.getObjects()) {
          if (child.data?.frameId === frameId) {
            child.set({ selectable: !isNowLocked, evented: !isNowLocked });
          }
        }
      }

      // Apply z-index changes — move to correct canvas position
      if (u.zIndex !== undefined) {
        fabricObj.data.zIndex = u.zIndex as number;
        canvas.moveTo(fabricObj, u.zIndex as number);
      }

      fabricObj.setCoords();
      canvas.requestRenderAll();

      // Update boardStore
      useBoardStore.getState().updateObject(objectId, updates as Partial<BoardObject>);
    };

    socket.on(WebSocketEvent.OBJECT_UPDATED, handleObjectUpdated);

    // --- objects:batch_update (multi-select drag from another user) ---
    const handleBatchMoved = (payload: ObjectsBatchMovedPayload) => {
      const currentLocalUserId = usePresenceStore.getState().localUserId;
      if (payload.userId === currentLocalUserId) return;

      for (const move of payload.moves) {
        const fabricObj = findFabricObjectById(canvas, move.objectId);
        if (!fabricObj) continue;

        // Smooth animate for drag-in-progress position updates
        fabricObj.animate('left', move.x, {
          duration: 100,
          onChange: () => canvas.requestRenderAll(),
          easing: fabric.util.ease.easeOutQuad,
        });
        fabricObj.animate('top', move.y, {
          duration: 100,
          onChange: () => canvas.requestRenderAll(),
          easing: fabric.util.ease.easeOutQuad,
        });
      }
    };

    socket.on(WebSocketEvent.OBJECTS_BATCH_UPDATE, handleBatchMoved);

    // --- object:deleted ---
    const handleObjectDeleted = (payload: ObjectDeletedPayload) => {
      const { objectId, userId } = payload;
      const currentLocalUserId = usePresenceStore.getState().localUserId;

      if (userId === currentLocalUserId) return;

      const fabricObj = findFabricObjectById(canvas, objectId);
      if (fabricObj) {
        // If a frame is deleted, orphan all its anchored children + restore selectability
        if (fabricObj.data?.type === 'frame') {
          for (const obj of canvas.getObjects()) {
            if (obj.data?.frameId === objectId) {
              obj.data = { ...obj.data, frameId: null };
              obj.set({ selectable: true, evented: true });
              useBoardStore.getState().updateObject(obj.data.id, { frameId: null });
            }
          }
        }

        // Detach connectors that reference this deleted object
        detachConnectorsFromObject(canvas, objectId);

        canvas.remove(fabricObj);
        canvas.requestRenderAll();
      }
      useBoardStore.getState().removeObject(objectId);
    };

    socket.on(WebSocketEvent.OBJECT_DELETED, handleObjectDeleted);

    // --- objects:batch_deleted ---
    const handleBatchDeleted = (payload: ObjectsBatchDeletedPayload) => {
      const { objectIds, userId } = payload;
      const currentLocalUserId = usePresenceStore.getState().localUserId;

      // Skip if we were the sender (we already removed them locally)
      if (userId === currentLocalUserId) return;

      for (const objectId of objectIds) {
        const fabricObj = findFabricObjectById(canvas, objectId);
        if (fabricObj) {
          // If a frame is deleted, orphan all its anchored children
          if (fabricObj.data?.type === 'frame') {
            for (const obj of canvas.getObjects()) {
              if (obj.data?.frameId === objectId) {
                obj.data = { ...obj.data, frameId: null };
                obj.set({ selectable: true, evented: true });
                useBoardStore.getState().updateObject(obj.data.id, { frameId: null });
              }
            }
          }

          // Detach connectors that reference this deleted object
          detachConnectorsFromObject(canvas, objectId);

          canvas.remove(fabricObj);
        }
        useBoardStore.getState().removeObject(objectId);
      }

      canvas.requestRenderAll();
    };

    socket.on(WebSocketEvent.OBJECTS_BATCH_DELETED, handleBatchDeleted);

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

    // --- board:renamed (owner changed the title via REST) ---
    const handleBoardRenamed = (payload: { boardId: string; title: string }) => {
      useBoardStore.getState().setBoardTitle(payload.title);
    };
    socket.on(WebSocketEvent.BOARD_RENAMED, handleBoardRenamed);

    // --- flag:created (another user placed a teleport flag via REST) ---
    const handleFlagCreated = (payload: FlagCreatedPayload) => {
      const { flag, userId } = payload;

      // Skip if we created it (already added locally + on canvas)
      const currentLocalUserId = usePresenceStore.getState().localUserId;
      if (userId === currentLocalUserId) return;

      // Deduplicate — skip if flag already exists (e.g. board:state race)
      const existingFlags = useFlagStore.getState().flags;
      if (existingFlags.some((f) => f.id === flag.id)) return;

      // Skip if marker already on canvas
      const existingMarker = canvas.getObjects().find((o) => o.data?.flagId === flag.id);
      if (existingMarker) return;

      // Add marker to canvas
      const marker = createFlagMarker({
        x: flag.x,
        y: flag.y,
        color: flag.color,
        flagId: flag.id,
        label: flag.label,
      });
      canvas.add(marker);
      canvas.requestRenderAll();

      // Add to flag store
      useFlagStore.setState((s) => ({
        flags: [...s.flags, flag],
      }));
    };
    socket.on(WebSocketEvent.FLAG_CREATED, handleFlagCreated);

    // --- flag:updated (another user changed a flag's label/color/position via REST) ---
    const handleFlagUpdated = (payload: FlagUpdatedPayload) => {
      const { flag, userId } = payload;

      // Skip if we updated it (already applied locally)
      const currentLocalUserId = usePresenceStore.getState().localUserId;
      if (userId === currentLocalUserId) return;

      // Update canvas marker
      const marker = canvas.getObjects().find((o) => o.data?.flagId === flag.id);
      if (marker) {
        // Update position
        marker.set('left', flag.x);
        marker.set('top', flag.y);

        // Update pennant color (third child in the flag group: [hole, pole, pennant])
        if (marker.type === 'group') {
          const group = marker as fabric.Group;
          const pennant = group.getObjects().find((c) => c.type === 'path');
          if (pennant) {
            pennant.set('fill', flag.color);
          }
        }

        marker.setCoords();
        canvas.requestRenderAll();
      }

      // Update flag store
      useFlagStore.setState((s) => ({
        flags: s.flags.map((f) => (f.id === flag.id ? flag : f)),
      }));
    };
    socket.on(WebSocketEvent.FLAG_UPDATED, handleFlagUpdated);

    // --- flag:deleted (another user deleted a teleport flag via REST) ---
    const handleFlagDeleted = (payload: FlagDeletedPayload) => {
      const { flagId, userId } = payload;

      // Skip if we initiated the deletion (already removed locally)
      const localUserId = usePresenceStore.getState().localUserId;
      if (userId === localUserId) return;

      // Remove flag marker from canvas (flags use data.flagId, not data.id)
      const marker = canvas.getObjects().find((o) => o.data?.flagId === flagId);
      if (marker) {
        canvas.remove(marker);
        canvas.requestRenderAll();
      }

      // Remove from flag store
      useFlagStore.setState((s) => ({
        flags: s.flags.filter((f) => f.id !== flagId),
      }));
    };
    socket.on(WebSocketEvent.FLAG_DELETED, handleFlagDeleted);

    // =========================================================
    // Cleanup
    // =========================================================
    return () => {
      canvas.off('mouse:move', handleMouseMove);
      canvas.off('object:moving', handleObjectMoving);
      canvas.off('object:rotating', handleObjectRotating);
      canvas.off('object:scaling', handleObjectScaling);
      canvas.off('object:modified', handleObjectModified);

      socket.off(WebSocketEvent.BOARD_STATE, handleBoardState);
      socket.off(WebSocketEvent.OBJECT_CREATED, handleObjectCreated);
      socket.off(WebSocketEvent.OBJECTS_BATCH_CREATED, handleBatchCreated);
      socket.off(WebSocketEvent.OBJECT_UPDATED, handleObjectUpdated);
      socket.off(WebSocketEvent.OBJECTS_BATCH_UPDATE, handleBatchMoved);
      socket.off(WebSocketEvent.OBJECT_DELETED, handleObjectDeleted);
      socket.off(WebSocketEvent.OBJECTS_BATCH_DELETED, handleBatchDeleted);
      socket.off(WebSocketEvent.CURSOR_MOVED, handleCursorMoved);
      socket.off(WebSocketEvent.USER_JOINED, handleUserJoined);
      socket.off(WebSocketEvent.USER_LEFT, handleUserLeft);
      socket.off('edit:reclaim', handleEditReclaim);
      socket.off(WebSocketEvent.EDIT_WARNING, handleEditWarning);
      socket.off(WebSocketEvent.EDIT_START, handleEditStartBroadcast);
      socket.off(WebSocketEvent.EDIT_END, handleEditEndBroadcast);
      socket.off(WebSocketEvent.BOARD_RENAMED, handleBoardRenamed);
      socket.off(WebSocketEvent.FLAG_CREATED, handleFlagCreated);
      socket.off(WebSocketEvent.FLAG_UPDATED, handleFlagUpdated);
      socket.off(WebSocketEvent.FLAG_DELETED, handleFlagDeleted);

      throttledCursor.cancel();
      throttledObjectMove.cancel();
      throttledBatchMove.cancel();
      clearInterval(staleCursorInterval);
    };
  }, [socketRef, fabricRef, connectionStatus]);
}
