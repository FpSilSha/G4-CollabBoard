import { useEffect } from 'react';
import { fabric } from 'fabric';
import type { Socket } from 'socket.io-client';
import { useUIStore } from '../stores/uiStore';
import { useBoardStore } from '../stores/boardStore';
import { useFlagStore } from '../stores/flagStore';
import { WebSocketEvent } from 'shared';
import type { BoardObject } from 'shared';
import { fabricToBoardObject, boardObjectToFabric } from '../utils/fabricHelpers';
import { generateLocalId } from '../utils/idGenerator';
import { detachConnectorsFromObject } from '../utils/connectorAttachment';

/** Offset (px) for each successive paste, creating a cascade effect. */
const PASTE_OFFSET = 20;

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
          if (canvas && marchingAntsActive) {
            dismissMarchingAnts(canvas);
          }
          // Exit rotation mode if active
          if (canvas && rotationModeObjectId) {
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

// ============================================================
// Copy (Ctrl+C) — Capture Selected Objects to Clipboard
// ============================================================

/**
 * IDs of objects currently showing the marching ants animation.
 * Module-scoped so the after:render callback can access them.
 */
const marchingAntsIds = new Set<string>();
let marchingAntsActive = false;
let marchingAntsRafId: number | null = null;

/**
 * Cached Fabric object references for the marching ants animation.
 * Populated once in startMarchingAnts(), iterated per frame in renderMarchingAnts().
 * Avoids scanning all canvas objects (~500+) every frame to find the 1-10 matches.
 */
const marchingAntsObjects: fabric.Object[] = [];

/** Handler ref so we can remove it on cleanup. */
let marchingAntsClickHandler: (() => void) | null = null;

/**
 * Tracks objects whose transform controls were locked during copy.
 * We restore them when the marching ants animation ends.
 */
const lockedObjectIds = new Set<string>();

/**
 * Copy the currently selected object(s) to the client-side clipboard.
 *
 * On copy:
 * 1. Snapshot the current positions of selected objects into the clipboard
 * 2. Deselect all objects (removes the blue selection/transform box)
 * 3. Lock the copied objects (no move/scale/rotate) during animation
 * 4. Show marching ants — persist until user clicks ANYTHING on the canvas
 *
 * IMPORTANT for multi-select: We must discard the ActiveSelection FIRST so
 * that Fabric.js decomposes the group and restores absolute coordinates on
 * each child object. Only then can we snapshot positions + bounding rects.
 */
function handleCopy(): void {
  const canvas = useBoardStore.getState().canvas;
  if (!canvas) return;

  const activeObj = canvas.getActiveObject();
  if (!activeObj) return;

  // Collect the object IDs while the selection is still active
  const objectIds: string[] = [];
  if (activeObj.type === 'activeSelection') {
    for (const obj of (activeObj as fabric.ActiveSelection).getObjects()) {
      if (obj.data?.id && !obj.data?.pinned) {
        objectIds.push(obj.data.id);
      }
    }
  } else {
    if (activeObj.data?.id && !activeObj.data?.pinned) {
      objectIds.push(activeObj.data.id);
    }
  }

  if (objectIds.length === 0) return;

  // Deselect FIRST — this decomposes ActiveSelection and restores absolute
  // coordinates on each child object. Without this, multi-select objects have
  // coordinates relative to the group center, causing wrong bounding rects.
  canvas.discardActiveObject();
  canvas.requestRenderAll();

  // Now look up the individual objects by ID (they now have absolute coords)
  const validFabricObjects: fabric.Object[] = [];
  const boardObjects: BoardObject[] = [];
  const userId = 'local-user'; // Clipboard is client-only

  for (const id of objectIds) {
    const obj = canvas.getObjects().find((o) => o.data?.id === id);
    if (!obj) continue;

    // Force coordinate recalculation after decomposition
    obj.setCoords();

    validFabricObjects.push(obj);
    boardObjects.push(fabricToBoardObject(obj, userId));
  }

  if (boardObjects.length === 0) return;

  useUIStore.getState().pushClipboard(boardObjects);

  // Auto-open the right sidebar if it's closed (so user sees clipboard indicator)
  const uiState = useUIStore.getState();
  if (!uiState.rightSidebarOpen) {
    useUIStore.setState({ rightSidebarOpen: true, rightSidebarAutoOpened: true });
  }

  // Lock transforms on copied objects during the animation
  lockObjects(validFabricObjects);

  // Start marching ants (persists until user clicks anywhere)
  startMarchingAnts(canvas, validFabricObjects);
}

/**
 * Lock movement/scaling/rotation on objects so the local user can't
 * transform them while the marching ants animation is playing.
 */
function lockObjects(objects: fabric.Object[]): void {
  for (const obj of objects) {
    if (!obj.data?.id) continue;
    lockedObjectIds.add(obj.data.id);
    obj.set({
      lockMovementX: true,
      lockMovementY: true,
      lockScalingX: true,
      lockScalingY: true,
      lockRotation: true,
      selectable: false,
      evented: false,
    });
  }
}

/**
 * Restore movement/scaling/rotation on objects after the animation ends.
 */
function restoreLockedObjects(canvas: fabric.Canvas): void {
  if (lockedObjectIds.size === 0) return;

  for (const obj of canvas.getObjects()) {
    if (!obj.data?.id || !lockedObjectIds.has(obj.data.id)) continue;

    // Sticky notes keep lockScaling and hasControls=false
    const isSticky = obj.data?.type === 'sticky';

    // If this object is anchored to a locked frame, keep it unselectable
    const isLockedChild = !!obj.data?.frameId;

    obj.set({
      lockMovementX: false,
      lockMovementY: false,
      lockScalingX: isSticky,
      lockScalingY: isSticky,
      lockRotation: false,
      selectable: !isLockedChild,
      evented: !isLockedChild,
    });
  }

  lockedObjectIds.clear();
}

/**
 * Start the marching ants animation on the given objects.
 * Animation persists indefinitely until the user clicks anywhere on the
 * canvas, presses Escape, or pastes. This matches the classic
 * Excel/Photoshop "copy selection" UX.
 */
function startMarchingAnts(canvas: fabric.Canvas, objects: fabric.Object[]): void {
  // Clear any existing animation first
  if (marchingAntsActive) {
    dismissMarchingAnts(canvas);
  }

  marchingAntsActive = true;

  // Track which object IDs should show the animation + cache references
  marchingAntsObjects.length = 0;
  for (const obj of objects) {
    if (obj.data?.id) {
      marchingAntsIds.add(obj.data.id);
      marchingAntsObjects.push(obj);
    }
  }

  // Use _renderBackground override approach (same pattern as dot grid)
  // to draw on the canvas context. We hook into after:render and grab
  // the context directly from the canvas element.
  canvas.on('after:render', renderMarchingAnts);

  // Start continuous rendering for the animation via RAF loop
  const animateFrame = () => {
    if (!marchingAntsActive) return;
    canvas.requestRenderAll();
    marchingAntsRafId = requestAnimationFrame(animateFrame);
  };
  marchingAntsRafId = requestAnimationFrame(animateFrame);

  // Dismiss on any click (mouse:down) on the canvas
  marchingAntsClickHandler = () => {
    dismissMarchingAnts(canvas);
  };
  canvas.on('mouse:down', marchingAntsClickHandler);
}

/**
 * Dismiss the marching ants: restore locked objects, stop animation,
 * remove click listener, and re-render.
 */
function dismissMarchingAnts(canvas: fabric.Canvas): void {
  restoreLockedObjects(canvas);
  stopMarchingAnts(canvas);
  canvas.requestRenderAll();
}

/**
 * Stop the marching ants animation and clean up all resources.
 */
function stopMarchingAnts(canvas: fabric.Canvas): void {
  marchingAntsIds.clear();
  marchingAntsObjects.length = 0;
  marchingAntsActive = false;

  if (marchingAntsRafId !== null) {
    cancelAnimationFrame(marchingAntsRafId);
    marchingAntsRafId = null;
  }

  canvas.off('after:render', renderMarchingAnts);

  if (marchingAntsClickHandler) {
    canvas.off('mouse:down', marchingAntsClickHandler);
    marchingAntsClickHandler = null;
  }
}

/**
 * after:render callback that draws marching ant borders around copied objects.
 *
 * Gets the 2D context directly from the canvas element (Fabric.js renders
 * to the lower-canvas). Manually converts object canvas-space coordinates
 * to screen-space using the viewport transform, which is more reliable than
 * getBoundingRect across pan/zoom states.
 */
function renderMarchingAnts(): void {
  if (marchingAntsIds.size === 0) return;

  const canvas = useBoardStore.getState().canvas;
  if (!canvas) return;

  // Get the 2D context directly from the lower canvas element
  const ctx = canvas.getContext();
  if (!ctx) return;

  const vpt = canvas.viewportTransform!;
  const zoom = vpt[0]; // scale factor (vpt[0] === vpt[3] for uniform zoom)
  const panX = vpt[4]; // horizontal pan offset
  const panY = vpt[5]; // vertical pan offset

  const animOffset = -(Date.now() / 50) % 20;

  ctx.save();
  // Reset transform to pixel coordinates so we can draw in screen space
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // Iterate only cached objects (populated in startMarchingAnts),
  // not all canvas objects — avoids O(N) scan on every frame.
  for (const obj of marchingAntsObjects) {
    // Ensure coordinates are fresh
    obj.setCoords();

    // Manually compute screen-space bounding rect from object coords.
    const objLeft = obj.left ?? 0;
    const objTop = obj.top ?? 0;
    const objWidth = (obj.width ?? 0) * (obj.scaleX ?? 1);
    const objHeight = (obj.height ?? 0) * (obj.scaleY ?? 1);
    const angle = obj.angle ?? 0;

    const screenX = objLeft * zoom + panX;
    const screenY = objTop * zoom + panY;
    const screenW = objWidth * zoom;
    const screenH = objHeight * zoom;

    // Padding around the object for the marching ants border
    const pad = 4;

    ctx.save();
    ctx.lineWidth = 2;

    // Rotate around the object's center if it has rotation
    if (angle !== 0) {
      const cx = screenX + screenW / 2;
      const cy = screenY + screenH / 2;
      ctx.translate(cx, cy);
      ctx.rotate((angle * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    }

    // Pass 1: White dashes
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.setLineDash([6, 4]);
    ctx.lineDashOffset = animOffset;
    ctx.strokeRect(
      screenX - pad, screenY - pad,
      screenW + pad * 2, screenH + pad * 2
    );

    // Pass 2: Black dashes (offset by half pattern to fill gaps)
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.setLineDash([6, 4]);
    ctx.lineDashOffset = animOffset + 5;
    ctx.strokeRect(
      screenX - pad, screenY - pad,
      screenW + pad * 2, screenH + pad * 2
    );

    ctx.restore();
  }

  ctx.restore();
}

// ============================================================
// Paste (Ctrl+V) — Create New Objects from Clipboard
// ============================================================

/**
 * Paste objects from the clipboard onto the canvas.
 * Each pasted object gets a new UUID and is offset by +20,+20 from the original.
 * Repeated pastes cascade diagonally. Pasted objects are auto-selected.
 *
 * Enforces the board's max object limit — if the paste would exceed the limit,
 * shows a toast warning and does not create any objects.
 *
 * Uses OBJECTS_BATCH_CREATE to send all pasted objects in a single WebSocket
 * message, avoiding rate-limit disconnects when pasting many objects at once.
 */
function handlePaste(socket: Socket | null): void {
  const canvas = useBoardStore.getState().canvas;
  if (!canvas) return;

  const clipboard = useUIStore.getState().clipboard;
  if (clipboard.length === 0) return;

  // --- Object limit check ---
  const currentCount = useBoardStore.getState().objects.size;
  const maxObjects = useBoardStore.getState().maxObjectsPerBoard;
  if (currentCount + clipboard.length > maxObjects) {
    useUIStore.getState().showToast(
      'Action would result in too many board objects for current plan'
    );
    return;
  }

  // Cancel any active marching ants (paste replaces the visual feedback)
  if (marchingAntsActive) {
    dismissMarchingAnts(canvas);
  }

  const boardId = useBoardStore.getState().boardId;
  const pastedFabricObjects: fabric.Object[] = [];
  const newBoardObjects: BoardObject[] = [];

  // Create new objects from clipboard entries with offset + fresh IDs
  const updatedClipboard: BoardObject[] = [];

  for (const entry of clipboard) {
    // Create new entry with fresh ID and offset position.
    // Clear frameId — pasted objects are always independent (not anchored).
    const newEntry: BoardObject = {
      ...entry,
      id: generateLocalId(),
      x: entry.x + PASTE_OFFSET,
      y: entry.y + PASTE_OFFSET,
      // Connectors: offset both endpoints and clear stale attachments
      ...(entry.type === 'connector' ? {
        x2: (entry as { x2: number }).x2 + PASTE_OFFSET,
        y2: (entry as { y2: number }).y2 + PASTE_OFFSET,
        fromObjectId: '',
        toObjectId: '',
        fromAnchor: null,
        toAnchor: null,
      } : {}),
      // Lines: offset both endpoints
      ...(entry.type === 'line' ? {
        x2: (entry as { x2: number }).x2 + PASTE_OFFSET,
        y2: (entry as { y2: number }).y2 + PASTE_OFFSET,
      } : {}),
      frameId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Convert to Fabric object and add to canvas
    const fabricObj = boardObjectToFabric(newEntry);
    if (!fabricObj) continue;

    canvas.add(fabricObj);
    pastedFabricObjects.push(fabricObj);
    newBoardObjects.push(newEntry);

    // Add to store (optimistic — local state updates immediately)
    useBoardStore.getState().addObject(newEntry);

    // Update the clipboard entry's position so next paste cascades further.
    // For connectors, x2/y2 must also cascade — otherwise repeated pastes
    // converge the second endpoint to the same spot.
    updatedClipboard.push({
      ...entry,
      x: entry.x + PASTE_OFFSET,
      y: entry.y + PASTE_OFFSET,
      ...(entry.type === 'connector' ? {
        x2: (entry as { x2: number }).x2 + PASTE_OFFSET,
        y2: (entry as { y2: number }).y2 + PASTE_OFFSET,
      } : {}),
      ...(entry.type === 'line' ? {
        x2: (entry as { x2: number }).x2 + PASTE_OFFSET,
        y2: (entry as { y2: number }).y2 + PASTE_OFFSET,
      } : {}),
    });
  }

  // Emit created objects in batch messages (max 50 per message to match schema).
  // Previously each object was sent as a separate OBJECT_CREATE event, which
  // caused force-disconnects when pasting many objects rapidly (e.g., 192 events/sec
  // exceeded the 60/sec limit). The batch approach sends one message per chunk.
  const BATCH_CHUNK_SIZE = 50;
  if (boardId && socket?.connected && newBoardObjects.length > 0) {
    for (let i = 0; i < newBoardObjects.length; i += BATCH_CHUNK_SIZE) {
      const chunk = newBoardObjects.slice(i, i + BATCH_CHUNK_SIZE);
      socket.emit(WebSocketEvent.OBJECTS_BATCH_CREATE, {
        boardId,
        objects: chunk,
        timestamp: Date.now(),
      });
    }
  }

  // Update clipboard positions for cascading paste
  useUIStore.getState().updateActiveClipboard(updatedClipboard);

  // Select the pasted objects
  if (pastedFabricObjects.length === 1) {
    canvas.setActiveObject(pastedFabricObjects[0]);
  } else if (pastedFabricObjects.length > 1) {
    const selection = new fabric.ActiveSelection(pastedFabricObjects, { canvas });
    canvas.setActiveObject(selection);
  }

  canvas.requestRenderAll();
}

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
  if (marchingAntsActive) {
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

// ============================================================
// Rotation Mode (R key toggle)
// ============================================================

/**
 * Tracks which object is currently in rotation mode.
 * When active, the object hides resize handles and only shows the rotation control.
 * Press R again, Escape, or deselect to exit.
 */
let rotationModeObjectId: string | null = null;

/** Saved control visibility so we can restore on exit. */
let savedControlVisibility: Record<string, boolean> | null = null;

/**
 * Toggle rotation mode on the given object.
 * In rotation mode: all resize controls are hidden, only the rotation
 * control (mtr) is visible. The object's lockMovement is set to prevent
 * accidental moves while rotating.
 */
function toggleRotationMode(canvas: fabric.Canvas, obj: fabric.Object): void {
  if (rotationModeObjectId === obj.data?.id) {
    // Already in rotation mode on this object — exit
    exitRotationMode(canvas);
    return;
  }

  // If rotation mode was on a different object, exit it first
  if (rotationModeObjectId) {
    exitRotationMode(canvas);
  }

  // Don't allow rotation on stickies (they have hasControls: false)
  if (obj.data?.type === 'sticky') return;

  rotationModeObjectId = obj.data?.id ?? null;

  // Save current control visibility and hide all except rotation (mtr)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const objAny = obj as any;
  savedControlVisibility = {};
  const controlKeys = ['tl', 'tr', 'bl', 'br', 'ml', 'mr', 'mt', 'mb'];
  for (const key of controlKeys) {
    savedControlVisibility[key] = objAny._controlsVisibility?.[key] ?? true;
    obj.setControlVisible(key, false);
  }

  // Make sure the rotation control IS visible
  obj.setControlVisible('mtr', true);
  obj.lockMovementX = true;
  obj.lockMovementY = true;

  canvas.requestRenderAll();
}

/**
 * Exit rotation mode: restore all control visibility and unlock movement.
 */
function exitRotationMode(canvas: fabric.Canvas): void {
  if (!rotationModeObjectId) return;

  const obj = canvas.getObjects().find((o) => o.data?.id === rotationModeObjectId);
  if (obj && savedControlVisibility) {
    // Restore saved control visibility
    for (const [key, visible] of Object.entries(savedControlVisibility)) {
      obj.setControlVisible(key, visible);
    }

    // Restore movement (unless it was locked for another reason like sticky)
    const isSticky = obj.data?.type === 'sticky';
    if (!isSticky) {
      obj.lockMovementX = false;
      obj.lockMovementY = false;
    }
  }

  rotationModeObjectId = null;
  savedControlVisibility = null;
  canvas.requestRenderAll();
}

/**
 * Hook into selection changes to exit rotation mode when the user
 * selects a different object or deselects all.
 * Called from useCanvas setup.
 */
export function setupRotationModeListeners(canvas: fabric.Canvas): () => void {
  const onSelectionCleared = () => {
    if (rotationModeObjectId) {
      exitRotationMode(canvas);
    }
  };

  const onSelectionUpdated = () => {
    if (rotationModeObjectId) {
      exitRotationMode(canvas);
    }
  };

  canvas.on('selection:cleared', onSelectionCleared);
  canvas.on('selection:updated', onSelectionUpdated);

  return () => {
    canvas.off('selection:cleared', onSelectionCleared);
    canvas.off('selection:updated', onSelectionUpdated);
  };
}
