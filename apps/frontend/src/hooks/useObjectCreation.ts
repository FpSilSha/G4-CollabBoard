import { useEffect, useCallback } from 'react';
import { fabric } from 'fabric';
import type { Socket } from 'socket.io-client';
import { useUIStore, Tool } from '../stores/uiStore';
import { useBoardStore } from '../stores/boardStore';
import { usePresenceStore } from '../stores/presenceStore';
import { WebSocketEvent, THROTTLE_CONFIG } from 'shared';
import {
  createStickyNote,
  createRectangle,
  createCircle,
  createTextElement,
  createFrame,
  createConnector,
  fabricToBoardObject,
  getStickyChildren,
} from '../utils/fabricHelpers';
import { throttle } from '../utils/throttle';
import { setEditSession } from '../stores/editSessionRef';

/**
 * Hook for creating objects on the canvas via click or drag-drop.
 *
 * In Phase 4, also emits `object:create` to the server after local creation.
 *
 * Returns drag-drop event handlers to attach to the canvas container <div>.
 */
export function useObjectCreation(
  fabricRef: React.MutableRefObject<fabric.Canvas | null>,
  socketRef: React.MutableRefObject<Socket | null>
) {
  const addObject = useBoardStore((s) => s.addObject);

  // ========================================
  // Click-to-create on empty canvas area
  // ========================================
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const handleMouseDown = (opt: fabric.IEvent) => {
      const tool = useUIStore.getState().activeTool;
      const color = useUIStore.getState().activeColor;

      // Only create if a creation tool is active
      if (tool === 'select' || tool === 'dropper' || tool === 'connector') return;
      // Only create if clicking on empty canvas (not on existing object)
      if (opt.target) return;

      const pointer = canvas.getPointer(opt.e);
      const fabricObj = createFabricObject(tool, pointer.x, pointer.y, color);

      if (fabricObj) {
        canvas.add(fabricObj);

        // Frames always go behind non-frame objects
        if (fabricObj.data?.type === 'frame') {
          canvas.sendToBack(fabricObj);
        }

        canvas.setActiveObject(fabricObj);
        canvas.requestRenderAll();

        const userId = usePresenceStore.getState().localUserId;

        // Track in Zustand store
        const boardObj = fabricToBoardObject(fabricObj, userId ?? undefined);
        addObject(boardObj);

        // Emit to server
        emitObjectCreate(socketRef.current, boardObj);

        // Reset to select tool after placing object
        useUIStore.getState().setActiveTool('select');
      }
    };

    canvas.on('mouse:down', handleMouseDown);
    return () => {
      canvas.off('mouse:down', handleMouseDown);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fabricRef]);
  // Only depend on the ref, not activeTool/activeColor.
  // We read activeTool/activeColor from store inside the handler to avoid
  // re-registering the listener on every tool change.

  // ========================================
  // Double-click to edit sticky note text
  // Opens a centered modal (StickyEditModal) instead of a floating
  // DOM textarea.  The modal is driven by editingObjectId in boardStore.
  // Live canvas updates + WS broadcasts are bridged via editSessionRef.
  // ========================================
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const handleDblClick = (opt: fabric.IEvent) => {
      const target = opt.target;
      if (!target || target.data?.type !== 'sticky') return;
      if (!(target instanceof fabric.Group)) return;

      // Dim the group's text child (visible through backdrop as ghost preview)
      const { text: textChild } = getStickyChildren(target);
      textChild.set('opacity', 0.3);
      canvas.requestRenderAll();

      // Snapshot original text for Cancel revert
      const originalText = target.data!.text ?? '';

      // Track which object is being edited (for self-echo prevention)
      useBoardStore.getState().setEditingObjectId(target.data!.id);
      useBoardStore.getState().setEditingOriginalText(originalText);

      // Notify server: acquire edit lock (advisory — for disconnect grace period)
      const editBoardId = useBoardStore.getState().boardId;
      if (editBoardId && socketRef.current?.connected && target.data?.id) {
        socketRef.current.emit(WebSocketEvent.EDIT_START, {
          boardId: editBoardId,
          objectId: target.data.id,
          timestamp: Date.now(),
        });
      }

      // --- Live text broadcast (throttled) ---
      const emitTextUpdate = (text: string) => {
        const boardId = useBoardStore.getState().boardId;
        const socket = socketRef.current;
        if (!boardId || !socket?.connected || !target.data?.id) return;
        socket.emit(WebSocketEvent.OBJECT_UPDATE, {
          boardId,
          objectId: target.data.id,
          updates: { text },
          timestamp: Date.now(),
        });
      };
      const throttledTextEmit = throttle(emitTextUpdate, THROTTLE_CONFIG.TEXT_INPUT_MS);

      // Bridge Fabric objects + emitters to the modal via editSessionRef
      setEditSession({
        target,
        textChild: textChild as unknown as fabric.Text,
        canvas,
        throttledEmit: throttledTextEmit,
        emitDirect: emitTextUpdate,
      });

      // Define finishEditing — callable from the modal via boardStore
      const finishEditing = (cancelled: boolean) => {
        const store = useBoardStore.getState();
        const finalText = cancelled
          ? (store.editingOriginalText ?? '')
          : (target.data!.text ?? '');

        // Apply final text to Fabric object
        target.data!.text = finalText;
        textChild.set('text', finalText);
        textChild.set('opacity', 1);
        canvas.requestRenderAll();

        // Cancel throttle, emit final state unthrottled (Final State Rule)
        throttledTextEmit.cancel();
        emitTextUpdate(finalText);

        // Update boardStore
        if (target.data?.id) {
          store.updateObject(target.data.id, {
            text: finalText,
          } as Partial<import('shared').BoardObject>);
        }

        // Notify server: release edit lock
        const endBoardId = store.boardId;
        if (endBoardId && socketRef.current?.connected && target.data?.id) {
          socketRef.current.emit(WebSocketEvent.EDIT_END, {
            boardId: endBoardId,
            objectId: target.data.id,
            timestamp: Date.now(),
          });
        }

        // Clear all editing state
        store.setEditingObjectId(null);
        store.setEditingOriginalText(null);
        store.setFinishEditingFn(null);
        store.setConcurrentEditors([]);
        setEditSession(null);
      };

      // Store finishEditing so the modal component can call it
      useBoardStore.getState().setFinishEditingFn(finishEditing);
    };

    canvas.on('mouse:dblclick', handleDblClick);
    return () => {
      canvas.off('mouse:dblclick', handleDblClick);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fabricRef]);

  // ========================================
  // IText editing: sync text changes for standalone text elements
  // Fabric.js IText enters edit mode automatically on double-click.
  // We listen for text:editing:exited to emit the final text to server.
  // ========================================
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleTextEditingExited = (opt: any) => {
      const target = opt.target as fabric.IText | undefined;
      if (!target || target.data?.type !== 'text') return;
      if (!target.data?.id) return;

      const boardId = useBoardStore.getState().boardId;
      const socket = socketRef.current;
      const userId = usePresenceStore.getState().localUserId;

      // Update local store
      const textValue = target.text ?? '';
      useBoardStore.getState().updateObject(target.data.id, {
        text: textValue,
      } as Partial<import('shared').BoardObject>);

      // Emit to server
      if (boardId && socket?.connected) {
        socket.emit(WebSocketEvent.OBJECT_UPDATE, {
          boardId,
          objectId: target.data.id,
          updates: { text: textValue, lastEditedBy: userId },
          timestamp: Date.now(),
        });
      }
    };

    canvas.on('text:editing:exited', handleTextEditingExited);
    return () => {
      canvas.off('text:editing:exited', handleTextEditingExited);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fabricRef]);

  // ========================================
  // Dropper tool: sample color from object
  // ========================================
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    /**
     * Dropper uses mouse:down:before to intercept BEFORE Fabric.js
     * processes the click for selection. We sample the color from the
     * object under the pointer, then prevent Fabric from selecting it
     * by discarding any active object immediately after.
     */
    const handleDropperClick = (opt: fabric.IEvent) => {
      if (useUIStore.getState().activeTool !== 'dropper') return;
      if (!opt.target) return;

      const target = opt.target;
      let fill: string | undefined;

      if (target.data?.type === 'sticky' && target instanceof fabric.Group) {
        // For sticky groups, sample the base polygon color
        const { base } = getStickyChildren(target);
        fill = base.fill as string;
      } else if (target.data?.type === 'frame' && target instanceof fabric.Group) {
        // For frames, sample the border color (stroke of child rect)
        const borderRect = target.getObjects()[0];
        fill = borderRect.stroke as string;
      } else if (target.data?.type === 'connector') {
        // For connectors, sample the stroke color
        fill = target.stroke as string;
      } else {
        fill = target.fill as string | undefined;
      }

      if (typeof fill === 'string') {
        // Add to custom color slots and set as active color
        useUIStore.getState().addCustomColor(fill);
        useUIStore.getState().setActiveTool('select');

        // Prevent the clicked object from becoming selected —
        // the dropper should only sample, not select.
        canvas.discardActiveObject();
        canvas.requestRenderAll();
      }
    };

    canvas.on('mouse:down', handleDropperClick);
    return () => {
      canvas.off('mouse:down', handleDropperClick);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fabricRef]);

  // ========================================
  // Connector tool: click-and-drag to create
  //
  // Disables canvas.selection while the connector tool is active so
  // Fabric.js doesn't create a rubber-band selection zone during drag.
  // Uses mouse:down (not mouse:down:before) to avoid interfering with
  // other tools' click-to-create handlers.
  // ========================================

  // Disable rubber-band selection when connector tool is active.
  // Uses plain subscribe (no selector) since we don't have subscribeWithSelector.
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    let prevTool = useUIStore.getState().activeTool;
    canvas.selection = (prevTool !== 'connector');

    const unsub = useUIStore.subscribe((state) => {
      const tool = state.activeTool;
      if (tool !== prevTool) {
        prevTool = tool;
        canvas.selection = (tool !== 'connector');
      }
    });

    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fabricRef]);

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    // State for the connector drag operation
    let isDragging = false;
    let previewLine: fabric.Line | null = null;
    let startX = 0;
    let startY = 0;

    const handleConnectorMouseDown = (opt: fabric.IEvent) => {
      if (useUIStore.getState().activeTool !== 'connector') return;
      // Only start on empty canvas (not on existing objects)
      if (opt.target) return;

      const pointer = canvas.getPointer(opt.e);
      startX = pointer.x;
      startY = pointer.y;
      isDragging = true;

      // Create a dashed preview line
      previewLine = new fabric.Line([startX, startY, startX, startY], {
        stroke: useUIStore.getState().activeColor,
        strokeWidth: 2,
        strokeDashArray: [6, 4],
        selectable: false,
        evented: false,
        opacity: 0.6,
      });
      canvas.add(previewLine);
      canvas.requestRenderAll();
    };

    const handleConnectorMouseMove = (opt: fabric.IEvent) => {
      if (!isDragging || !previewLine) return;
      const pointer = canvas.getPointer(opt.e);
      previewLine.set({ x2: pointer.x, y2: pointer.y });
      canvas.requestRenderAll();
    };

    const finishConnectorDrag = (endX: number, endY: number) => {
      isDragging = false;

      // Remove the preview line
      if (previewLine) {
        canvas.remove(previewLine);
        previewLine = null;
      }

      // Only create if the user dragged a minimum distance (> 10px)
      const dx = endX - startX;
      const dy = endY - startY;
      const length = Math.sqrt(dx * dx + dy * dy);
      if (length < 10) {
        canvas.requestRenderAll();
        return;
      }

      // Create the real connector
      const color = useUIStore.getState().activeColor;
      const connector = createConnector({
        x: startX,
        y: startY,
        x2: endX,
        y2: endY,
        color,
      });

      canvas.add(connector);
      canvas.setActiveObject(connector);
      canvas.requestRenderAll();

      const userId = usePresenceStore.getState().localUserId;
      const boardObj = fabricToBoardObject(connector, userId ?? undefined);
      addObject(boardObj);

      // Emit to server
      emitObjectCreate(socketRef.current, boardObj);

      // Reset to select tool (this also re-enables canvas.selection via subscriber)
      useUIStore.getState().setActiveTool('select');
    };

    const handleConnectorMouseUp = (opt: fabric.IEvent) => {
      if (!isDragging || !previewLine) return;
      const pointer = canvas.getPointer(opt.e);
      finishConnectorDrag(pointer.x, pointer.y);
    };

    // Cancel connector creation on Escape
    const handleConnectorEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isDragging && previewLine) {
        isDragging = false;
        canvas.remove(previewLine);
        previewLine = null;
        canvas.requestRenderAll();
      }
    };

    canvas.on('mouse:down', handleConnectorMouseDown);
    canvas.on('mouse:move', handleConnectorMouseMove);
    canvas.on('mouse:up', handleConnectorMouseUp);
    document.addEventListener('keydown', handleConnectorEscape);
    return () => {
      canvas.off('mouse:down', handleConnectorMouseDown);
      canvas.off('mouse:move', handleConnectorMouseMove);
      canvas.off('mouse:up', handleConnectorMouseUp);
      document.removeEventListener('keydown', handleConnectorEscape);
      // Clean up any lingering preview
      if (previewLine) {
        canvas.remove(previewLine);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fabricRef]);

  // ========================================
  // Drag-drop from sidebar
  // ========================================
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const canvas = fabricRef.current;
      if (!canvas) return;

      const objectType = e.dataTransfer.getData(
        'application/collabboard-type'
      ) as Tool;
      const color =
        e.dataTransfer.getData('application/collabboard-color') ||
        useUIStore.getState().activeColor;
      if (!objectType) return;

      // Convert screen coordinates to canvas coordinates
      const canvasEl = canvas.getElement();
      const rect = canvasEl.getBoundingClientRect();
      const simEvent = {
        clientX: e.clientX,
        clientY: e.clientY,
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top,
      };
      const pointer = canvas.getPointer(simEvent as unknown as Event);

      // Center the object on the drop point
      const fabricObj = createFabricObject(objectType, pointer.x, pointer.y, color);

      if (fabricObj) {
        canvas.add(fabricObj);

        // Frames always go behind non-frame objects
        if (fabricObj.data?.type === 'frame') {
          canvas.sendToBack(fabricObj);
        }

        canvas.setActiveObject(fabricObj);
        canvas.requestRenderAll();

        const userId = usePresenceStore.getState().localUserId;
        const boardObj = fabricToBoardObject(fabricObj, userId ?? undefined);
        addObject(boardObj);

        // Emit to server
        emitObjectCreate(socketRef.current, boardObj);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fabricRef, addObject]
  );

  return { handleDragOver, handleDrop };
}

// ============================================================
// Helper: create the right fabric object based on tool type
// ============================================================

function createFabricObject(
  tool: Tool,
  x: number,
  y: number,
  color: string
): fabric.Object | null {
  switch (tool) {
    case 'sticky':
      return createStickyNote({ x, y, color });
    case 'rectangle':
      return createRectangle({ x, y, color });
    case 'circle':
      return createCircle({ x, y, color });
    case 'text':
      return createTextElement({ x, y, color });
    case 'frame':
      return createFrame({ x, y, color });
    case 'connector':
      return createConnector({ x, y, color });
    default:
      return null;
  }
}

// ============================================================
// Helper: emit object:create to server
// ============================================================

function emitObjectCreate(
  socket: Socket | null,
  boardObj: import('shared').BoardObject
): void {
  const boardId = useBoardStore.getState().boardId;
  if (!boardId || !socket?.connected) return;

  // Send the full object (including client-generated UUID)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { createdAt, updatedAt, ...objWithoutTimestamps } = boardObj as unknown as Record<string, unknown>;

  socket.emit(WebSocketEvent.OBJECT_CREATE, {
    boardId,
    object: objWithoutTimestamps,
    timestamp: Date.now(),
  });
}
