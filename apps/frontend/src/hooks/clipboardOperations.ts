import { fabric } from 'fabric';
import type { Socket } from 'socket.io-client';
import { useUIStore } from '../stores/uiStore';
import { useBoardStore } from '../stores/boardStore';
import { WebSocketEvent } from 'shared';
import type { BoardObject } from 'shared';
import { fabricToBoardObject, boardObjectToFabric } from '../utils/fabricHelpers';
import { generateLocalId } from '../utils/idGenerator';

/** Offset (px) for each successive paste, creating a cascade effect. */
const PASTE_OFFSET = 20;

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

/** Whether marching ants animation is currently active. */
export function isMarchingAntsActive(): boolean {
  return marchingAntsActive;
}

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
export function handleCopy(): void {
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
export function dismissMarchingAnts(canvas: fabric.Canvas): void {
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
export function handlePaste(socket: Socket | null): void {
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
