import { useEffect, useCallback } from 'react';
import { fabric } from 'fabric';
import type { Socket } from 'socket.io-client';
import { useAuth0 } from '@auth0/auth0-react';
import { useUIStore, Tool } from '../stores/uiStore';
import { useBoardStore } from '../stores/boardStore';
import { usePresenceStore } from '../stores/presenceStore';
import { useFlagStore } from '../stores/flagStore';
import { useDemoStore } from '../stores/demoStore';
import { WebSocketEvent, THROTTLE_CONFIG } from 'shared';
import {
  createStickyNote,
  createRectangle,
  createCircle,
  createTextElement,
  createFrame,
  createConnector,
  createLine,
  createArrow,
  createStar,
  createTriangle,
  createDiamond,
  createFlagMarker,
  fabricToBoardObject,
  getStickyChildren,
  FLAG_COLORS,
} from '../utils/fabricHelpers';
import { throttle } from '../utils/throttle';
import { setEditSession } from '../stores/editSessionRef';
import { getSnapPreview } from '../utils/connectorAttachment';

const AUTH_PARAMS = {
  authorizationParams: {
    audience: import.meta.env.VITE_AUTH0_AUDIENCE || 'https://collabboard-api',
  },
};

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
  const { getAccessTokenSilently } = useAuth0();
  const addObject = useBoardStore((s) => s.addObject);

  // ========================================
  // Click-to-create on empty canvas area
  // ========================================
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const handleMouseDown = (opt: fabric.IEvent) => {
      // Only left-click triggers object placement (ignore right-click, middle-click)
      if ((opt.e as MouseEvent).button !== 0) return;

      const tool = useUIStore.getState().activeTool;
      const color = useUIStore.getState().activeColor;

      // Only create if a creation tool is active
      // Line and connector tools use drag-to-create, not click-to-create
      if (tool === 'select' || tool === 'dropper' || tool === 'connector' || tool === 'line' || tool === 'placeFlag') return;
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
  // Tab key: insert tab-space in IText when editing
  // ========================================
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const active = canvas.getActiveObject();
      if (!active || !(active instanceof fabric.IText) || !active.isEditing) return;

      e.preventDefault();
      // Insert 4 spaces at the cursor position
      active.insertChars('    ');
      canvas.requestRenderAll();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
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
      // Only left-click triggers dropper sampling
      if ((opt.e as MouseEvent).button !== 0) return;
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
      } else if (target.data?.type === 'connector' || target.data?.type === 'line') {
        // For connectors and lines, sample the stroke color
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
    canvas.selection = (prevTool !== 'connector' && prevTool !== 'line');

    const unsub = useUIStore.subscribe((state) => {
      const tool = state.activeTool;
      if (tool !== prevTool) {
        prevTool = tool;
        canvas.selection = (tool !== 'connector' && tool !== 'line');
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
    let snapIndicator: fabric.Circle | null = null;
    let startX = 0;
    let startY = 0;
    let startSnapId = '';   // Object ID snapped at start point

    /**
     * Show/hide a snap indicator circle at the snap target center.
     */
    const showSnapIndicator = (center: { x: number; y: number } | null) => {
      if (snapIndicator) {
        canvas.remove(snapIndicator);
        snapIndicator = null;
      }
      if (center) {
        snapIndicator = new fabric.Circle({
          left: center.x - 8,
          top: center.y - 8,
          radius: 8,
          fill: 'rgba(76, 175, 80, 0.3)',
          stroke: '#4CAF50',
          strokeWidth: 2,
          selectable: false,
          evented: false,
        });
        canvas.add(snapIndicator);
      }
    };

    const handleConnectorMouseDown = (opt: fabric.IEvent) => {
      // Only left-click initiates connector creation
      if ((opt.e as MouseEvent).button !== 0) return;
      if (useUIStore.getState().activeTool !== 'connector') return;

      const pointer = canvas.getPointer(opt.e);

      // Check if starting on or near an object — snap start endpoint
      const startSnap = getSnapPreview(canvas, pointer.x, pointer.y);
      if (startSnap) {
        startX = startSnap.center.x;
        startY = startSnap.center.y;
        startSnapId = startSnap.objectId;
      } else {
        // Allow starting on empty canvas
        if (opt.target && opt.target.data?.type !== 'connector') {
          // Starting on an object — snap to its center
          const center = opt.target.getCenterPoint();
          startX = center.x;
          startY = center.y;
          startSnapId = opt.target.data?.id || '';
        } else if (opt.target) {
          return; // Don't start on another connector
        } else {
          startX = pointer.x;
          startY = pointer.y;
          startSnapId = '';
        }
      }

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

      // Check for snap target at the current pointer position
      const snap = getSnapPreview(canvas, pointer.x, pointer.y,
        startSnapId ? [startSnapId] : undefined
      );

      if (snap) {
        // Snap the preview line's end to the target center
        previewLine.set({ x2: snap.center.x, y2: snap.center.y });
        showSnapIndicator(snap.center);
      } else {
        previewLine.set({ x2: pointer.x, y2: pointer.y });
        showSnapIndicator(null);
      }

      canvas.requestRenderAll();
    };

    const finishConnectorDrag = (endX: number, endY: number) => {
      isDragging = false;

      // Remove preview elements
      if (previewLine) {
        canvas.remove(previewLine);
        previewLine = null;
      }
      showSnapIndicator(null);

      // Check for end snap
      const endSnap = getSnapPreview(canvas, endX, endY,
        startSnapId ? [startSnapId] : undefined
      );
      let finalEndX = endX;
      let finalEndY = endY;
      let finalEndSnapId = '';

      if (endSnap) {
        finalEndX = endSnap.center.x;
        finalEndY = endSnap.center.y;
        finalEndSnapId = endSnap.objectId;
      }

      // Only create if the user dragged a minimum distance (> 10px)
      const dx = finalEndX - startX;
      const dy = finalEndY - startY;
      const length = Math.sqrt(dx * dx + dy * dy);
      if (length < 10) {
        canvas.requestRenderAll();
        return;
      }

      // Create the real connector with attachment IDs
      const color = useUIStore.getState().activeColor;
      const connector = createConnector({
        x: startX,
        y: startY,
        x2: finalEndX,
        y2: finalEndY,
        color,
        fromObjectId: startSnapId || undefined,
        toObjectId: finalEndSnapId || undefined,
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
        showSnapIndicator(null);
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
      // Clean up any lingering previews
      if (previewLine) {
        canvas.remove(previewLine);
      }
      showSnapIndicator(null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fabricRef]);

  // ========================================
  // Line (arrow) tool: click-and-drag to create
  //
  // Same mechanic as the connector tool, but creates a connector
  // with style='arrow' and no object attachment.
  // ========================================
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    let isDraggingLine = false;
    let linePreview: fabric.Line | null = null;
    let lineStartX = 0;
    let lineStartY = 0;

    const handleLineMouseDown = (opt: fabric.IEvent) => {
      // Only left-click initiates line creation
      if ((opt.e as MouseEvent).button !== 0) return;
      if (useUIStore.getState().activeTool !== 'line') return;
      if (opt.target) return;

      const pointer = canvas.getPointer(opt.e);
      lineStartX = pointer.x;
      lineStartY = pointer.y;
      isDraggingLine = true;

      linePreview = new fabric.Line([lineStartX, lineStartY, lineStartX, lineStartY], {
        stroke: useUIStore.getState().activeColor,
        strokeWidth: 2,
        strokeDashArray: [6, 4],
        selectable: false,
        evented: false,
        opacity: 0.6,
      });
      canvas.add(linePreview);
      canvas.requestRenderAll();
    };

    const handleLineMouseMove = (opt: fabric.IEvent) => {
      if (!isDraggingLine || !linePreview) return;
      const pointer = canvas.getPointer(opt.e);
      linePreview.set({ x2: pointer.x, y2: pointer.y });
      canvas.requestRenderAll();
    };

    const finishLineDrag = (endX: number, endY: number) => {
      isDraggingLine = false;

      if (linePreview) {
        canvas.remove(linePreview);
        linePreview = null;
      }

      const dx = endX - lineStartX;
      const dy = endY - lineStartY;
      const length = Math.sqrt(dx * dx + dy * dy);
      if (length < 10) {
        canvas.requestRenderAll();
        return;
      }

      // Create a standalone Line object with styling from uiStore
      const uiState = useUIStore.getState();
      const color = uiState.activeColor;
      const lineObj = createLine({
        x: lineStartX,
        y: lineStartY,
        x2: endX,
        y2: endY,
        color,
        endpointStyle: uiState.lineEndpointStyle,
        strokePattern: uiState.lineStrokePattern,
        strokeWeight: uiState.lineStrokeWeight,
      });

      canvas.add(lineObj);
      canvas.setActiveObject(lineObj);
      canvas.requestRenderAll();

      const userId = usePresenceStore.getState().localUserId;
      const boardObj = fabricToBoardObject(lineObj, userId ?? undefined);
      addObject(boardObj);

      emitObjectCreate(socketRef.current, boardObj);

      useUIStore.getState().setActiveTool('select');
    };

    const handleLineMouseUp = (opt: fabric.IEvent) => {
      if (!isDraggingLine || !linePreview) return;
      const pointer = canvas.getPointer(opt.e);
      finishLineDrag(pointer.x, pointer.y);
    };

    const handleLineEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isDraggingLine && linePreview) {
        isDraggingLine = false;
        canvas.remove(linePreview);
        linePreview = null;
        canvas.requestRenderAll();
      }
    };

    canvas.on('mouse:down', handleLineMouseDown);
    canvas.on('mouse:move', handleLineMouseMove);
    canvas.on('mouse:up', handleLineMouseUp);
    document.addEventListener('keydown', handleLineEscape);
    return () => {
      canvas.off('mouse:down', handleLineMouseDown);
      canvas.off('mouse:move', handleLineMouseMove);
      canvas.off('mouse:up', handleLineMouseUp);
      document.removeEventListener('keydown', handleLineEscape);
      if (linePreview) {
        canvas.remove(linePreview);
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

      // --- Teleport flag drag-drop ---
      if (objectType === 'placeFlag') {
        const x = pointer.x;
        const y = pointer.y;

        (async () => {
          const label = await useUIStore.getState().openTextInputModal({
            title: 'Flag Label',
            placeholder: 'Enter a name for this flag',
          });
          if (!label) return;

          const currentBoardId = useBoardStore.getState().boardId;
          if (!currentBoardId) return;

          const flagColor = FLAG_COLORS[
            useFlagStore.getState().flags.length % FLAG_COLORS.length
          ];

          try {
            const currentIsDemoMode = useDemoStore.getState().isDemoMode;
            let flag;
            if (currentIsDemoMode) {
              flag = useFlagStore.getState().createFlagLocal(
                currentBoardId,
                { label, x, y, color: flagColor },
              );
            } else {
              const token = await getAccessTokenSilently(AUTH_PARAMS);
              flag = await useFlagStore.getState().createFlag(
                currentBoardId,
                { label, x, y, color: flagColor },
                token,
              );
            }
            const marker = createFlagMarker({
              x: flag.x,
              y: flag.y,
              color: flag.color,
              flagId: flag.id,
              label: flag.label,
            });
            canvas.add(marker);
            canvas.requestRenderAll();
          } catch (err) {
            console.error('[useObjectCreation] flag drop error:', err);
          }
        })();
        return;
      }

      // --- Normal object creation ---
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
    [fabricRef, addObject, getAccessTokenSilently]
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
    case 'sticky': {
      const stickySize = useUIStore.getState().stickySize;
      return createStickyNote({ x, y, color, size: stickySize });
    }
    case 'rectangle':
      return createRectangle({ x, y, color });
    case 'circle':
      return createCircle({ x, y, color });
    case 'arrow':
      return createArrow({ x, y, color });
    case 'star':
      return createStar({ x, y, color });
    case 'triangle':
      return createTriangle({ x, y, color });
    case 'diamond':
      return createDiamond({ x, y, color });
    case 'text': {
      const uiState = useUIStore.getState();
      return createTextElement({
        x,
        y,
        color: '#000000',
        fontSize: uiState.textFontSize,
        fontFamily: uiState.textFontFamily,
      });
    }
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
