import { useEffect, useRef } from 'react';
import { fabric } from 'fabric';
import { CANVAS_CONFIG, UI_COLORS, WebSocketEvent } from 'shared';
import { useBoardStore } from '../stores/boardStore';
import { useUIStore } from '../stores/uiStore';
import { useFlagStore } from '../stores/flagStore';
import {
  getObjectFillColor,
  getObjectsInsideFrame,
  fabricToBoardObject,
  applyConnectorLockState,
  findFabricObjectById,
} from '../utils/fabricHelpers';
import { findEdgeLockTarget } from '../utils/edgeGeometry';
import { updateAttachedConnectors } from '../utils/connectorAttachment';
import { setupRotationModeListeners } from './useKeyboardShortcuts';
import type { Socket } from 'socket.io-client';

/**
 * Core hook: initializes Fabric.js canvas, pan/zoom, dot grid, selection styling.
 *
 * @param containerRef - ref to the <div> that will contain the <canvas> element
 * @returns ref to the fabric.Canvas instance (null until mounted)
 *
 * Usage:
 *   const containerRef = useRef<HTMLDivElement>(null);
 *   const fabricRef = useCanvas(containerRef);
 */
export function useCanvas(
  containerRef: React.RefObject<HTMLDivElement | null>,
  socketRef?: React.MutableRefObject<Socket | null>
): React.MutableRefObject<fabric.Canvas | null> {
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const setCanvas = useBoardStore((s) => s.setCanvas);
  const setZoom = useBoardStore((s) => s.setZoom);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // --- Create the <canvas> DOM element ---
    const canvasEl = document.createElement('canvas');
    canvasEl.id = 'collabboard-canvas';
    container.appendChild(canvasEl);

    // --- Initialize Fabric.js ---
    const canvas = new fabric.Canvas(canvasEl, {
      width: container.offsetWidth,
      height: container.offsetHeight,
      backgroundColor: 'transparent', // actual bg handled by CSS; dots drawn via after:render
      selection: true,
      preserveObjectStacking: true,
      stopContextMenu: true,
      fireRightClick: true,
      renderOnAddRemove: false,  // Batch adds during board:state — render once after all objects added
      skipOffscreen: true,       // Skip rendering objects entirely outside viewport
    });

    fabricRef.current = canvas;
    setCanvas(canvas);

    // --- Selection styling (Focus Blue) ---
    setupSelectionStyle();

    // --- Dot grid (rendered on canvas after:render) ---
    setupDotGrid(canvas);

    // --- Pan handler (click + drag on empty canvas) ---
    const cleanupPan = setupPanHandler(canvas);

    // --- Zoom handler (mouse wheel) ---
    setupZoomHandler(canvas, setZoom);

    // --- Selection glow: colored aura around selected objects ---
    const cleanupGlow = setupSelectionGlow(canvas);

    // --- Drag state: auto-close sidebars + edge overlay while dragging ---
    const cleanupDragState = setupDragState(canvas, socketRef ?? null, container);

    // --- Edge scroll: auto-pan when dragging objects near viewport edges ---
    const cleanupEdgeScroll = setupEdgeScroll(canvas);

    // --- Frame controls: lock/unlock + title editing ---
    const cleanupFrameControls = setupFrameControlHandlers(canvas, socketRef ?? null);

    // --- Selection tracking: update uiStore when selection changes ---
    const cleanupSelectionTracking = setupSelectionTracking(canvas);

    // --- Rotation mode: exit on deselect/selection change ---
    const cleanupRotationMode = setupRotationModeListeners(canvas);

    // --- Resize observer ---
    // Debounced so sidebar collapse/expand CSS transitions (250ms) don't
    // cause rapid re-renders that flash objects. Only the final size matters.
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        // Skip degenerate sizes during transition
        if (width < 1 || height < 1) continue;

        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          canvas.setDimensions({ width, height });
          canvas.calcOffset();
          canvas.requestRenderAll();
        }, 50);
      }
    });
    resizeObserver.observe(container);

    // --- Cleanup ---
    return () => {
      cleanupPan();
      cleanupGlow();
      cleanupDragState();
      cleanupEdgeScroll();
      cleanupFrameControls();
      cleanupSelectionTracking();
      cleanupRotationMode();
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      canvas.dispose();
      if (container.contains(canvasEl)) {
        container.removeChild(canvasEl);
      }
      fabricRef.current = null;
      setCanvas(null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount

  return fabricRef;
}

// ============================================================
// Selection Styling
// ============================================================

/**
 * Configure the default selection appearance for all Fabric.js objects.
 * Per user spec: 2px solid Focus Blue (#007AFF) outline and handles.
 *
 * Corner controls render as black directional arrows indicating the
 * resize direction. The rotation control (mtr) renders as two curved
 * arrows forming a rotation symbol.
 */
function setupSelectionStyle(): void {
  fabric.Object.prototype.set({
    borderColor: UI_COLORS.FOCUS_BLUE,
    cornerColor: '#222222',
    cornerStrokeColor: '#FFFFFF',
    borderScaleFactor: 2,     // 2px border
    cornerSize: 16,           // Increased from 10 for visibility
    cornerStyle: 'circle',
    transparentCorners: false,
    padding: 4,
  });

  // Custom rotation handle: two curved arrows
  const mtrControl = fabric.Object.prototype.controls.mtr;
  mtrControl.sizeX = 24;
  mtrControl.sizeY = 24;
  mtrControl.render = function (ctx, left, top, _styleOverride, _fabricObj) {
    const radius = 11;
    ctx.save();
    ctx.translate(left, top);

    // Background circle
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#222222';
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Draw two curved arrows (rotation symbol)
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';

    const arcR = 6;

    // Top arc
    ctx.beginPath();
    ctx.arc(0, 0, arcR, -Math.PI * 0.8, Math.PI * 0.2);
    ctx.stroke();

    // Arrow head on top arc
    const ax1 = arcR * Math.cos(Math.PI * 0.2);
    const ay1 = arcR * Math.sin(Math.PI * 0.2);
    ctx.beginPath();
    ctx.moveTo(ax1 - 3, ay1 - 4);
    ctx.lineTo(ax1, ay1);
    ctx.lineTo(ax1 + 4, ay1 - 1);
    ctx.stroke();

    // Bottom arc
    ctx.beginPath();
    ctx.arc(0, 0, arcR, Math.PI * 0.2, Math.PI * 1.2);
    ctx.stroke();

    // Arrow head on bottom arc
    const ax2 = arcR * Math.cos(-Math.PI * 0.8);
    const ay2 = arcR * Math.sin(-Math.PI * 0.8);
    ctx.beginPath();
    ctx.moveTo(ax2 + 3, ay2 + 4);
    ctx.lineTo(ax2, ay2);
    ctx.lineTo(ax2 - 4, ay2 + 1);
    ctx.stroke();

    ctx.restore();
  };

  // Custom corner controls: single arrow pointing outward from the corner.
  // The arrow direction matches the diagonal away from the center of the
  // bounding box so the user intuitively knows which way to drag.
  //
  // angle param: the outward diagonal angle in degrees
  //   tl → -135 (up-left), tr → -45 (up-right),
  //   bl →  135 (down-left), br →  45 (down-right)
  const cornerArrowRender = (angle: number) => {
    return function (
      ctx: CanvasRenderingContext2D,
      left: number,
      top: number
    ) {
      const radius = 8;
      ctx.save();
      ctx.translate(left, top);

      // Background circle
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fillStyle = '#222222';
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Single outward-pointing arrow
      ctx.rotate((angle * Math.PI) / 180);
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Arrow shaft (from center toward outward direction)
      ctx.beginPath();
      ctx.moveTo(-2, 0);
      ctx.lineTo(5, 0);
      ctx.stroke();

      // Arrow head (chevron at the tip)
      ctx.beginPath();
      ctx.moveTo(2, -3);
      ctx.lineTo(5, 0);
      ctx.lineTo(2, 3);
      ctx.stroke();

      ctx.restore();
    };
  };

  // Assign outward-pointing arrows to each corner
  fabric.Object.prototype.controls.tl.render = cornerArrowRender(-135);
  fabric.Object.prototype.controls.tr.render = cornerArrowRender(-45);
  fabric.Object.prototype.controls.bl.render = cornerArrowRender(135);
  fabric.Object.prototype.controls.br.render = cornerArrowRender(45);

  // Update corner control hit area to match new visual size
  for (const key of ['tl', 'tr', 'bl', 'br']) {
    fabric.Object.prototype.controls[key].sizeX = 16;
    fabric.Object.prototype.controls[key].sizeY = 16;
  }

  // Edge midpoint controls: double-headed horizontal or vertical arrows
  const edgeArrowRender = (angle: number) => {
    return function (
      ctx: CanvasRenderingContext2D,
      left: number,
      top: number
    ) {
      const radius = 7;
      ctx.save();
      ctx.translate(left, top);
      ctx.rotate((angle * Math.PI) / 180);

      // Background circle
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fillStyle = '#222222';
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Horizontal double-headed arrow
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.8;
      ctx.lineCap = 'round';

      ctx.beginPath();
      ctx.moveTo(-4, 0);
      ctx.lineTo(4, 0);
      ctx.stroke();

      // Right arrow head
      ctx.beginPath();
      ctx.moveTo(2, -2.5);
      ctx.lineTo(4, 0);
      ctx.lineTo(2, 2.5);
      ctx.stroke();

      // Left arrow head
      ctx.beginPath();
      ctx.moveTo(-2, -2.5);
      ctx.lineTo(-4, 0);
      ctx.lineTo(-2, 2.5);
      ctx.stroke();

      ctx.restore();
    };
  };

  for (const key of ['ml', 'mr', 'mt', 'mb']) {
    fabric.Object.prototype.controls[key].sizeX = 14;
    fabric.Object.prototype.controls[key].sizeY = 14;
  }

  fabric.Object.prototype.controls.ml.render = edgeArrowRender(0);
  fabric.Object.prototype.controls.mr.render = edgeArrowRender(0);
  fabric.Object.prototype.controls.mt.render = edgeArrowRender(90);
  fabric.Object.prototype.controls.mb.render = edgeArrowRender(90);
}

// ============================================================
// Dot Grid (rendered via after:render callback)
// ============================================================

/**
 * Renders a dot grid on the canvas BEHIND all objects.
 *
 * Uses a custom backgroundColor render function which Fabric.js calls
 * during the background phase of rendering, before any objects are drawn.
 * This ensures objects always appear in front of the dots.
 *
 * Dots are hidden at zoom <= 0.3 to prevent lag from too many dots.
 * Spec: 20px spacing, 0.2 opacity.
 */
function setupDotGrid(canvas: fabric.Canvas): void {
  // Override the canvas _renderBackground to inject dot drawing after the
  // solid background color but before objects.
  const originalRenderBackground = (canvas as any)._renderBackground;

  (canvas as any)._renderBackground = function (ctx: CanvasRenderingContext2D) {
    // Call original to render solid backgroundColor if any
    originalRenderBackground.call(this, ctx);

    const vpt = canvas.viewportTransform!;
    const zoom = canvas.getZoom();

    // Hide dots at zoom <= 0.3 (too sparse to be useful)
    // Hide dots at zoom >= 3.0 (too dense, performance waste)
    if (zoom <= 0.3 || zoom >= 3.0) return;

    const spacing = UI_COLORS.DOT_GRID_SPACING;
    // At low zoom, double spacing to halve dot count
    const effectiveSpacing = zoom <= 0.5 ? spacing * 2 : spacing;

    const canvasWidth = canvas.getWidth();
    const canvasHeight = canvas.getHeight();

    // Calculate the visible area in canvas coordinates
    const startX = -vpt[4] / zoom;
    const startY = -vpt[5] / zoom;
    const endX = startX + canvasWidth / zoom;
    const endY = startY + canvasHeight / zoom;

    // Round to nearest grid line
    const firstCol = Math.floor(startX / effectiveSpacing) * effectiveSpacing;
    const firstRow = Math.floor(startY / effectiveSpacing) * effectiveSpacing;

    ctx.save();
    ctx.fillStyle = UI_COLORS.DOT_GRID_COLOR;

    // Batch all dots into a single path — one beginPath + one fill
    // instead of 3 API calls per dot (~9,720 → 2 calls total)
    ctx.beginPath();
    for (let x = firstCol; x <= endX; x += effectiveSpacing) {
      for (let y = firstRow; y <= endY; y += effectiveSpacing) {
        const screenX = x * zoom + vpt[4];
        const screenY = y * zoom + vpt[5];
        ctx.moveTo(screenX + 1, screenY);
        ctx.arc(screenX, screenY, 1, 0, Math.PI * 2);
      }
    }
    ctx.fill();

    ctx.restore();
  };
}

// ============================================================
// Pan Handler (Click + Drag on empty canvas with Select tool)
// ============================================================

/**
 * Implements infinite canvas panning:
 * - When the select tool is active and user clicks on empty canvas
 *   (not on an object), dragging pans the viewport.
 * - Cursor changes to grab (hover) / grabbing (active drag) during pan.
 * - Clicking on an object still selects/moves it normally.
 *
 * Returns a cleanup function (none needed for canvas-only handlers).
 */
function setupPanHandler(canvas: fabric.Canvas): () => void {
  let isDragging = false;
  let lastPosX = 0;
  let lastPosY = 0;

  canvas.on('mouse:down', (opt: fabric.IEvent<MouseEvent>) => {
    // Pan on RIGHT-click only (button === 2). Left-click = rubber band / select.
    if (opt.e.button !== 2) return;

    isDragging = true;
    canvas.defaultCursor = 'grabbing';
    // Also set the upper canvas cursor directly for immediate feedback
    const upperCanvas = canvas.getElement().parentElement?.querySelector('.upper-canvas') as HTMLCanvasElement | null;
    if (upperCanvas) upperCanvas.style.cursor = 'grabbing';
    canvas.selection = false;
    const evt = opt.e;
    lastPosX = evt.clientX;
    lastPosY = evt.clientY;
  });

  canvas.on('mouse:move', (opt: fabric.IEvent<MouseEvent>) => {
    if (!isDragging) return;
    const evt = opt.e;
    const vpt = canvas.viewportTransform!;
    vpt[4] += evt.clientX - lastPosX;
    vpt[5] += evt.clientY - lastPosY;
    lastPosX = evt.clientX;
    lastPosY = evt.clientY;
    // setViewportTransform updates the transform AND refreshes the cached
    // canvas offset (via calcOffset), keeping pointer hit-testing accurate.
    // NOTE: With renderOnAddRemove=false, setViewportTransform does NOT
    // auto-render, so we must call requestRenderAll() explicitly.
    canvas.setViewportTransform(vpt);
    canvas.requestRenderAll();
  });

  canvas.on('mouse:up', () => {
    if (isDragging) {
      isDragging = false;
      canvas.defaultCursor = 'default';
      const upperCanvas = canvas.getElement().parentElement?.querySelector('.upper-canvas') as HTMLCanvasElement | null;
      if (upperCanvas) upperCanvas.style.cursor = 'default';
      canvas.selection = true;
      // Notify RemoteCursors that viewport changed so positions update
      useBoardStore.getState().bumpViewportVersion();
      canvas.calcOffset(); // Ensure offset cache is fresh after pan ends
      canvas.requestRenderAll();
    }
  });

  return () => {
    // No document listeners to clean up
  };
}

// ============================================================
// Selection Glow (Colored Aura on Selected Objects)
// ============================================================

/**
 * Applies a bold colored glow aura around selected objects using
 * Fabric.js shadow + a colored semi-transparent stroke outline.
 *
 * Uses fabric.Shadow with aggressive blur (60) at full opacity for
 * the glow halo, plus a 3px colored stroke ring around the object
 * for extra "pop". Original shadows are saved in a WeakMap and
 * restored on deselection (important for sticky notes' default shadow).
 *
 * Events:
 *   selection:created  — objects just selected
 *   selection:updated  — selection changed (shift-click add/remove)
 *   selection:cleared  — all deselected
 */
function setupSelectionGlow(canvas: fabric.Canvas): () => void {
  const originalShadows = new WeakMap<fabric.Object, fabric.Shadow | string | null>();
  const originalStrokes = new WeakMap<fabric.Object, { stroke: string | null; strokeWidth: number }>();

  function applyGlow(obj: fabric.Object): void {
    // Don't re-apply if already glowing
    if (originalShadows.has(obj)) return;

    // Skip glow for text elements — it visually clutters the text
    // Skip glow for connectors/lines — the endpoint controls provide sufficient
    // selection feedback, and the glow overrides stroke color used for rendering
    if (obj.data?.type === 'text' || obj.data?.type === 'connector' || obj.data?.type === 'line' || obj.data?.type === 'teleportFlag') return;

    // Save original shadow and stroke
    originalShadows.set(obj, obj.shadow ?? null);
    originalStrokes.set(obj, {
      stroke: (obj.stroke as string) ?? null,
      strokeWidth: obj.strokeWidth ?? 0,
    });

    const hex = getObjectFillColor(obj);

    // Apply a very aggressive shadow glow: full color, huge blur, full opacity
    obj.set('shadow', new fabric.Shadow({
      color: hex,
      blur: 20,
      offsetX: 0,
      offsetY: 0,
    }));

    // Add a colored stroke ring around the object for extra definition
    obj.set('stroke', hex);
    obj.set('strokeWidth', 3);
  }

  function removeGlow(obj: fabric.Object): void {
    if (!originalShadows.has(obj)) return;

    // Restore original shadow
    const origShadow = originalShadows.get(obj);
    obj.set('shadow', origShadow ?? undefined);
    originalShadows.delete(obj);

    // Restore original stroke
    const origStroke = originalStrokes.get(obj);
    if (origStroke) {
      obj.set('stroke', origStroke.stroke ?? '');
      obj.set('strokeWidth', origStroke.strokeWidth);
    }
    originalStrokes.delete(obj);
  }

  /** Refresh glow color on an already-glowing object (e.g. after color change). */
  function updateGlow(obj: fabric.Object): void {
    if (!originalShadows.has(obj)) return; // not glowing
    const hex = getObjectFillColor(obj);
    obj.set('shadow', new fabric.Shadow({
      color: hex,
      blur: 20,
      offsetX: 0,
      offsetY: 0,
    }));
    obj.set('stroke', hex);
  }

  const onSelectionCreated = (opt: fabric.IEvent) => {
    if (opt.selected) {
      for (const obj of opt.selected) {
        applyGlow(obj);
      }
    }
    canvas.requestRenderAll();
  };

  const onSelectionUpdated = (opt: fabric.IEvent) => {
    if (opt.deselected) {
      for (const obj of opt.deselected) {
        removeGlow(obj);
      }
    }
    if (opt.selected) {
      for (const obj of opt.selected) {
        applyGlow(obj);
      }
    }
    canvas.requestRenderAll();
  };

  const onSelectionCleared = (opt: fabric.IEvent) => {
    if (opt.deselected) {
      for (const obj of opt.deselected) {
        removeGlow(obj);
      }
    }
    canvas.requestRenderAll();
  };

  // Refresh glow color whenever an object is modified (e.g. fill change from color picker)
  const onObjectModified = (opt: fabric.IEvent) => {
    const target = opt.target;
    if (!target) return;
    const targets = target.type === 'activeSelection'
      ? (target as fabric.ActiveSelection).getObjects()
      : [target];
    for (const obj of targets) {
      updateGlow(obj);
    }
    canvas.requestRenderAll();
  };

  canvas.on('selection:created', onSelectionCreated);
  canvas.on('selection:updated', onSelectionUpdated);
  canvas.on('selection:cleared', onSelectionCleared);
  canvas.on('object:modified', onObjectModified);

  return () => {
    canvas.off('selection:created', onSelectionCreated);
    canvas.off('selection:updated', onSelectionUpdated);
    canvas.off('selection:cleared', onSelectionCleared);
    canvas.off('object:modified', onObjectModified);
  };
}

// ============================================================
// Zoom Handler (Mouse Wheel)
// ============================================================

/**
 * Implements zoom-to-cursor via mouse wheel.
 * Clamped to CANVAS_CONFIG.MIN_ZOOM (0.1) through MAX_ZOOM (20).
 * Uses exponential scaling for smooth zoom feel.
 */
function setupZoomHandler(
  canvas: fabric.Canvas,
  setZoom: (z: number) => void
): void {
  canvas.on('mouse:wheel', (opt: fabric.IEvent<WheelEvent>) => {
    const evt = opt.e;
    evt.preventDefault();
    evt.stopPropagation();

    const delta = evt.deltaY;
    let zoom = canvas.getZoom();

    // Exponential zoom for smooth feel
    zoom *= 0.999 ** delta;
    zoom = Math.max(CANVAS_CONFIG.MIN_ZOOM, Math.min(CANVAS_CONFIG.MAX_ZOOM, zoom));

    canvas.zoomToPoint(
      new fabric.Point(evt.offsetX, evt.offsetY),
      zoom
    );
    // With renderOnAddRemove=false, zoomToPoint won't auto-render
    canvas.requestRenderAll();

    setZoom(zoom);
    useBoardStore.getState().bumpViewportVersion();
  });
}

// ============================================================
// Drag State (Sidebar Auto-Close + Floating Trash + Edge Overlay)
// ============================================================

/**
 * Manages the isDraggingObject state, sidebar auto-close behavior,
 * and the floating trash button at the bottom of the canvas.
 *
 * On drag start (object:moving):
 * - Sidebars temporarily close for full viewport
 * - Edge glow overlay + floating trash appear
 *
 * During drag (object:moving continues):
 * - Detects if pointer is over the floating trash and highlights it
 *
 * On drag end (mouse:up / object:modified):
 * - If pointer was over floating trash, delete the object(s)
 * - Sidebars re-open to their pre-drag state
 * - Edge overlay + floating trash disappear
 *
 * Note: Sidebars use fixed-position overlay layout and do NOT affect
 * canvas container size. Collapsing them is purely visual — no viewport
 * shift or container-freezing is needed.
 */
function setupDragState(
  canvas: fabric.Canvas,
  socketRef: React.MutableRefObject<Socket | null> | null,
  _canvasContainer: HTMLElement
): () => void {
  let dragActive = false;
  let isOverTrash = false;

  function getFloatingTrashEl(): HTMLElement | null {
    return document.querySelector('[data-floating-trash="true"]');
  }

  function isPointerOverTrash(clientX: number, clientY: number): boolean {
    const trashEl = getFloatingTrashEl();
    if (!trashEl) return false;
    const rect = trashEl.getBoundingClientRect();
    return (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    );
  }

  function setTrashHighlight(highlight: boolean): void {
    const trashEl = getFloatingTrashEl();
    if (!trashEl) return;
    if (highlight) {
      trashEl.classList.add('dragOver');
    } else {
      trashEl.classList.remove('dragOver');
    }
  }

  function deleteObject(obj: fabric.Object): void {
    if (obj.data?.pinned) return;

    // Teleport flags use flagId, not id — handle separately via REST API.
    // Only remove from canvas AFTER server confirms (prevents ghost deletes on 403).
    if (obj.data?.type === 'teleportFlag') {
      const flagId = obj.data?.flagId as string | undefined;
      const boardId = useBoardStore.getState().boardId;
      const token = useBoardStore.getState().cachedAuthToken;
      if (flagId && boardId && token) {
        useFlagStore.getState().deleteFlag(boardId, flagId, token).then(() => {
          canvas.remove(obj);
          canvas.requestRenderAll();
        }).catch((err) => {
          console.error('[drag-to-trash] Flag delete failed:', err);
          useUIStore.getState().showToast('Cannot delete this flag — you are not the creator or board owner');
        });
      }
      return;
    }

    const objectId = obj.data?.id;

    // Orphan children when deleting a frame via drag-to-trash
    if (obj.data?.type === 'frame' && objectId) {
      for (const child of canvas.getObjects()) {
        if (child.data?.frameId === objectId) {
          child.data = { ...child.data, frameId: null };
          child.set({ selectable: true, evented: true });
          useBoardStore.getState().updateObject(child.data.id, { frameId: null });
        }
      }
    }

    canvas.remove(obj);

    if (objectId) {
      useBoardStore.getState().removeObject(objectId);
      const boardId = useBoardStore.getState().boardId;
      const socket = socketRef?.current;
      if (boardId && socket?.connected) {
        socket.emit(WebSocketEvent.OBJECT_DELETE, {
          boardId,
          objectId,
          timestamp: Date.now(),
        });
      }
    }
  }

  const onObjectMoving = (opt: fabric.IEvent<Event>) => {
    if (!dragActive) {
      dragActive = true;

      const ui = useUIStore.getState();

      // Remember sidebar state before collapsing
      useUIStore.setState({
        sidebarOpenBeforeDrag: ui.sidebarOpen,
        rightSidebarOpenBeforeDrag: ui.rightSidebarOpen,
      });

      // Collapse sidebars — they are fixed-position overlays, so this
      // only hides the overlay panels without affecting canvas size at all.
      if (ui.sidebarOpen) ui.setSidebarOpen(false);
      if (ui.rightSidebarOpen) ui.setRightSidebarOpen(false);

      useUIStore.getState().setIsDraggingObject(true);
    }

    // Check floating trash hover
    const evt = opt.e as MouseEvent;
    const over = isPointerOverTrash(evt.clientX, evt.clientY);
    if (over !== isOverTrash) {
      isOverTrash = over;
      setTrashHighlight(over);
    }
  };

  const onDragEnd = (opt?: fabric.IEvent<Event>) => {
    if (!dragActive) return;

    // If dropped on floating trash, delete the object(s)
    if (isOverTrash && opt?.target) {
      const target = opt.target;
      if (target.type === 'activeSelection') {
        const objects = (target as fabric.ActiveSelection).getObjects().slice();
        canvas.discardActiveObject();

        // Collect objects to remove, then batch-process
        const deletedIds: string[] = [];
        const objectsToRemove: fabric.Object[] = [];

        for (const obj of objects) {
          if (obj.data?.pinned) continue;

          // Teleport flags use flagId — handle separately via REST API.
          // Only remove from canvas AFTER server confirms.
          if (obj.data?.type === 'teleportFlag') {
            const flagId = obj.data?.flagId as string | undefined;
            const boardId = useBoardStore.getState().boardId;
            const token = useBoardStore.getState().cachedAuthToken;
            if (flagId && boardId && token) {
              const flagObj = obj; // capture reference for async callback
              useFlagStore.getState().deleteFlag(boardId, flagId, token).then(() => {
                canvas.remove(flagObj);
                canvas.requestRenderAll();
              }).catch((err) => {
                console.error('[drag-to-trash] Flag delete failed:', err);
                useUIStore.getState().showToast('Cannot delete this flag — you are not the creator or board owner');
              });
            }
            continue;
          }

          const objectId = obj.data?.id;

          // Orphan children when deleting a frame via drag-to-trash
          if (obj.data?.type === 'frame' && objectId) {
            for (const child of canvas.getObjects()) {
              if (child.data?.frameId === objectId) {
                child.data = { ...child.data, frameId: null };
                child.set({ selectable: true, evented: true });
                useBoardStore.getState().updateObject(child.data.id, { frameId: null });
              }
            }
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

        // Single Zustand state update for all removals (avoids N re-renders)
        useBoardStore.getState().removeObjects(deletedIds);

        // Send all deletes in a single batch message
        if (deletedIds.length > 0) {
          const boardId = useBoardStore.getState().boardId;
          const socket = socketRef?.current;
          if (boardId && socket?.connected) {
            socket.emit(WebSocketEvent.OBJECTS_BATCH_DELETE, {
              boardId,
              objectIds: deletedIds,
              timestamp: Date.now(),
            });
          }
        }
      } else {
        deleteObject(target);
      }
      canvas.requestRenderAll();
    }

    // Restore sidebars to their pre-drag state
    const ui = useUIStore.getState();
    if (ui.sidebarOpenBeforeDrag) ui.setSidebarOpen(true);
    if (ui.rightSidebarOpenBeforeDrag) ui.setRightSidebarOpen(true);

    // Reset state
    isOverTrash = false;
    setTrashHighlight(false);
    dragActive = false;

    useUIStore.getState().setIsDraggingObject(false);
  };

  canvas.on('object:moving', onObjectMoving);
  canvas.on('object:modified', onDragEnd);
  canvas.on('mouse:up', onDragEnd);

  return () => {
    onDragEnd();
    canvas.off('object:moving', onObjectMoving);
    canvas.off('object:modified', onDragEnd);
    canvas.off('mouse:up', onDragEnd);
  };
}

// ============================================================
// Edge Scroll (Auto-Pan When Dragging Objects Near Viewport Edges)
// ============================================================

/**
 * Auto-pans the canvas when the user drags an object near the edges
 * of the viewport. This enables moving objects off-screen without
 * manually zooming out or releasing and panning.
 *
 * Speed scales linearly: gentle at the threshold boundary, max speed
 * at the very edge. Diagonal movement (corners) works naturally since
 * each edge axis is computed independently.
 *
 * The scroll loop runs via requestAnimationFrame while active, so the
 * viewport pans smoothly even if the mouse stays still near the edge.
 *
 * Returns a cleanup function that cancels the RAF loop and removes
 * all event listeners.
 */
function setupEdgeScroll(canvas: fabric.Canvas): () => void {
  const THRESHOLD = CANVAS_CONFIG.EDGE_SCROLL_THRESHOLD;
  const MIN_SPEED = CANVAS_CONFIG.EDGE_SCROLL_MIN_SPEED;
  const MAX_SPEED = CANVAS_CONFIG.EDGE_SCROLL_MAX_SPEED;

  let rafId: number | null = null;
  let isDragging = false;
  let pointerX = 0;
  let pointerY = 0;

  /**
   * Compute scroll delta for one axis.
   * Returns negative value for left/top edge, positive for right/bottom.
   * Returns 0 if pointer is not in an edge zone.
   */
  function edgeDelta(pos: number, viewportSize: number): number {
    if (pos < THRESHOLD) {
      // Near the left/top edge — scroll in negative direction (pan right/down)
      const depth = (THRESHOLD - pos) / THRESHOLD; // 0 at threshold, 1 at edge
      return -(MIN_SPEED + (MAX_SPEED - MIN_SPEED) * depth);
    }
    if (pos > viewportSize - THRESHOLD) {
      // Near the right/bottom edge — scroll in positive direction (pan left/up)
      const depth = (pos - (viewportSize - THRESHOLD)) / THRESHOLD;
      return MIN_SPEED + (MAX_SPEED - MIN_SPEED) * Math.min(depth, 1);
    }
    return 0;
  }

  function scrollLoop(): void {
    if (!isDragging) return;

    const canvasWidth = canvas.getWidth();
    const canvasHeight = canvas.getHeight();

    const dx = edgeDelta(pointerX, canvasWidth);
    const dy = edgeDelta(pointerY, canvasHeight);

    if (dx !== 0 || dy !== 0) {
      const vpt = canvas.viewportTransform!;
      // Pan the viewport (opposite direction to make objects "follow" the edge)
      vpt[4] -= dx;
      vpt[5] -= dy;
      canvas.setViewportTransform(vpt);
      // With renderOnAddRemove=false, setViewportTransform won't auto-render
      canvas.requestRenderAll();

      // Also move the active object(s) so they stay under the cursor
      const activeObj = canvas.getActiveObject();
      if (activeObj) {
        const zoom = canvas.getZoom();
        activeObj.set({
          left: (activeObj.left ?? 0) + dx / zoom,
          top: (activeObj.top ?? 0) + dy / zoom,
        });
        activeObj.setCoords();
      }
    }

    rafId = requestAnimationFrame(scrollLoop);
  }

  const onObjectMoving = (opt: fabric.IEvent<Event>) => {
    const evt = opt.e as MouseEvent;

    // Use offsetX/offsetY for canvas-relative pointer position
    // (clientX/Y would need adjustment for canvas container offset)
    const canvasEl = canvas.getElement();
    const rect = canvasEl.getBoundingClientRect();
    pointerX = evt.clientX - rect.left;
    pointerY = evt.clientY - rect.top;

    if (!isDragging) {
      isDragging = true;
      rafId = requestAnimationFrame(scrollLoop);
    }
  };

  const onDragEnd = () => {
    if (isDragging) {
      useBoardStore.getState().bumpViewportVersion();
    }
    isDragging = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  canvas.on('object:moving', onObjectMoving);
  canvas.on('object:modified', onDragEnd);
  canvas.on('mouse:up', onDragEnd);

  return () => {
    onDragEnd(); // Stop any active RAF
    canvas.off('object:moving', onObjectMoving);
    canvas.off('object:modified', onDragEnd);
    canvas.off('mouse:up', onDragEnd);
  };
}

// ============================================================
// Connector Lock Handler
// ============================================================

/**
 * Handle the connector lock-button click. For each endpoint:
 *   1. If within EDGE_SNAP_RADIUS of an object's edge → lock to that edge point.
 *   2. If inside an object → lock to that interior point (highest z-index wins).
 *   3. If no target → unlock (clear attachment).
 *
 * If already locked (any anchor exists), clicking unlocks both endpoints.
 *
 * Snaps the endpoint position to the resolved anchor point and emits the update.
 */
function handleConnectorLock(
  line: fabric.Line,
  canvas: fabric.Canvas,
  emitObjectUpdate: (objectId: string, updates: Record<string, unknown>) => void
): void {
  if (!line.data?.id) return;
  const connectorId = line.data.id;

  const wasLocked = !!(line.data.fromAnchor || line.data.toAnchor);

  if (wasLocked) {
    // Toggle OFF — clear all attachments
    line.data.fromObjectId = '';
    line.data.fromAnchor = null;
    line.data.toObjectId = '';
    line.data.toAnchor = null;
  } else {
    // Toggle ON — try to lock each endpoint to nearest edge
    const x1 = line.x1 ?? 0;
    const y1 = line.y1 ?? 0;
    const x2 = line.x2 ?? 0;
    const y2 = line.y2 ?? 0;

    const fromResult = findEdgeLockTarget(canvas, x1, y1, [connectorId]);
    const toResult = findEdgeLockTarget(canvas, x2, y2, [connectorId]);

    if (fromResult) {
      line.data.fromObjectId = fromResult.objectId;
      line.data.fromAnchor = fromResult.anchor;
      line.set({ x1: fromResult.absolutePoint.x, y1: fromResult.absolutePoint.y });
    } else {
      line.data.fromObjectId = '';
      line.data.fromAnchor = null;
    }

    if (toResult) {
      line.data.toObjectId = toResult.objectId;
      line.data.toAnchor = toResult.anchor;
      line.set({ x2: toResult.absolutePoint.x, y2: toResult.absolutePoint.y });
    } else {
      line.data.toObjectId = '';
      line.data.toAnchor = null;
    }
  }

  // Apply movement lock/unlock based on new anchor state
  applyConnectorLockState(line);

  line.setCoords();
  canvas.requestRenderAll();

  // Emit the updated connector state
  const boardObj = fabricToBoardObject(line);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, createdBy, createdAt, type, ...updates } = boardObj as unknown as Record<string, unknown>;
  emitObjectUpdate(connectorId, updates);
  useBoardStore.getState().updateObject(connectorId, updates as Record<string, unknown>);
}

// ============================================================
// Frame Control Handlers (Lock/Unlock + Title Editing + Anchored Movement)
// ============================================================

/**
 * Wires up the frame's custom control action handlers and anchored
 * movement behavior.
 *
 * Lock toggle:
 *   - Scans canvas for objects completely inside the frame + in front of it
 *   - Sets/clears frameId on each qualifying object
 *   - Emits object:update for the frame (locked state) and each child (frameId)
 *
 * Edit title:
 *   - Opens a prompt() dialog for the new title
 *   - Updates the frame's label text and emits object:update
 *
 * Anchored movement:
 *   - When a locked frame is dragged, all children move by the same delta
 *   - On mouse:up, final positions for frame + children are emitted
 *   - When a child is dragged outside the frame bounds, it's unanchored
 */
function setupFrameControlHandlers(
  canvas: fabric.Canvas,
  socketRef: React.MutableRefObject<Socket | null> | null
): () => void {
  // Track the last known position of a frame being dragged, for delta computation
  const frameDragStart = new Map<string, { left: number; top: number }>();

  function emitObjectUpdate(objectId: string, updates: Record<string, unknown>): void {
    const boardId = useBoardStore.getState().boardId;
    const socket = socketRef?.current;
    if (!boardId || !socket?.connected) return;
    socket.emit(WebSocketEvent.OBJECT_UPDATE, {
      boardId,
      objectId,
      updates,
      timestamp: Date.now(),
    });
  }

  // --- Lock Toggle Handler ---
  // Overrides the lockToggle control's actionHandler on each frame that's
  // selected. We listen for mouse:down on the canvas and check if the
  // click hit the lockToggle control. Also handles connector lockBtn.
  const onMouseDown = (opt: fabric.IEvent) => {
    const target = opt.target;
    if (!target) return;

    // Check if the click hit one of our custom controls
    // Fabric.js sets __corner on the target when a control is clicked
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const corner = (target as any).__corner;

    // --- Connector Lock Button ---
    if (corner === 'lockBtn' && target.data?.type === 'connector') {
      handleConnectorLock(target as fabric.Line, canvas, emitObjectUpdate);
      return;
    }

    // Below: frame-specific controls
    if (target.data?.type !== 'frame') return;
    if (!(target instanceof fabric.Group)) return;

    if (corner === 'lockToggle') {
      const isLocked = target.data.locked ?? false;
      const newLocked = !isLocked;
      target.data.locked = newLocked;

      if (newLocked) {
        // Lock: find all qualifying objects inside bounds and anchor them.
        // allowFrames=true enables one-level-deep frame nesting.
        const children = getObjectsInsideFrame(canvas, target, true);

        // First pass: identify child frames so we can exclude their
        // existing children (grandchildren) from being re-parented.
        const adoptedFrameIds = new Set<string>();
        for (const child of children) {
          if (child.data?.type === 'frame') {
            adoptedFrameIds.add(child.data.id);
          }
        }

        // Second pass: adopt objects as direct children of this frame,
        // but skip objects that already belong to an adopted child frame
        // (they should keep their existing frameId → child frame).
        for (const child of children) {
          // If this object already belongs to an adopted child frame, don't re-parent it
          if (child.data?.frameId && adoptedFrameIds.has(child.data.frameId)) {
            // Just lock it visually — it keeps its existing frameId
            child.set({ selectable: false, evented: false });
            continue;
          }

          child.data = { ...child.data, frameId: target.data.id };
          child.set({ selectable: false, evented: false });
          emitObjectUpdate(child.data.id, { frameId: target.data.id });
          useBoardStore.getState().updateObject(child.data.id, { frameId: target.data.id });

          // If the child is a frame, promote it above the parent in z-order
          // so it renders in front (frames default to back).
          if (child.data?.type === 'frame') {
            const parentIdx = canvas.getObjects().indexOf(target);
            const childIdx = canvas.getObjects().indexOf(child);
            if (childIdx < parentIdx) {
              canvas.moveTo(child, parentIdx);
            }
          }
        }

        // Also lock any grandchildren that weren't caught by getObjectsInsideFrame
        // (e.g. grandchildren that are inside the child frame but were too small
        // to overlap with the parent's bounds check).
        if (adoptedFrameIds.size > 0) {
          for (const obj of canvas.getObjects()) {
            if (obj.data?.frameId && adoptedFrameIds.has(obj.data.frameId)) {
              obj.set({ selectable: false, evented: false });
            }
          }
        }
      } else {
        // Unlock: release direct children only.
        // If a child frame was locked before, keep it locked with its children.
        const allObjects = canvas.getObjects();
        for (const obj of allObjects) {
          if (obj.data?.frameId !== target.data.id) continue;

          // If this child is a frame that is itself locked, keep it locked
          // and don't release its own children — just detach from parent.
          const isLockedChildFrame = obj.data?.type === 'frame' && obj.data?.locked;

          obj.data = { ...obj.data, frameId: null };
          obj.set({ selectable: true, evented: true });
          emitObjectUpdate(obj.data.id, { frameId: null });
          useBoardStore.getState().updateObject(obj.data.id, { frameId: null });

          // If the child frame was locked, restore its children's unselectable state
          if (isLockedChildFrame) {
            const childFrameId = obj.data.id;
            for (const grandchild of allObjects) {
              if (grandchild.data?.frameId === childFrameId) {
                grandchild.set({ selectable: false, evented: false });
              }
            }
          }
        }
      }

      // Emit the frame's locked state change
      emitObjectUpdate(target.data.id, { locked: newLocked });
      useBoardStore.getState().updateObject(target.data.id, { locked: newLocked });

      canvas.requestRenderAll();
      return;
    }

    if (corner === 'editTitle') {
      const currentTitle = target.data.title ?? 'Frame';

      // Use async IIFE — the TextInputModal is Promise-based, but
      // onMouseDown handles multiple control types and must stay sync.
      (async () => {
        const newTitle = await useUIStore.getState().openTextInputModal({
          title: 'Edit Frame Title',
          initialValue: currentTitle,
          placeholder: 'Frame title...',
          maxLength: 255,
        });
        if (newTitle === null || newTitle === currentTitle) return;

        const trimmed = newTitle.slice(0, 255);
        target.data.title = trimmed;

        // Update the label text inside the group (index 2: [border, labelBg, label])
        const label = target.getObjects()[2] as fabric.Text;
        label.set('text', trimmed || 'Frame');

        // Resize the label background to match new text width
        const labelBg = target.getObjects()[1] as fabric.Rect;
        const labelPadH = 6;
        const labelPadV = 2;
        labelBg.set('width', (label.width ?? 0) + labelPadH * 2);
        labelBg.set('height', (label.height ?? 16) + labelPadV * 2);

        // Emit update
        emitObjectUpdate(target.data.id, { title: trimmed });
        useBoardStore.getState().updateObject(target.data.id, { title: trimmed });

        canvas.requestRenderAll();
      })();
      return;
    }
  };

  // --- Anchored Movement: track frame drag start ---
  const onObjectMoving = (opt: fabric.IEvent<Event>) => {
    const target = opt.target;
    if (!target || target.data?.type !== 'frame') return;
    if (!target.data.locked) return;

    const frameId = target.data.id;

    // First move event: record starting position
    if (!frameDragStart.has(frameId)) {
      // We can't get "before move" position from this event, so we use
      // the previous stored position. On first call, it's the current
      // position (delta will be 0).
      frameDragStart.set(frameId, {
        left: target.left ?? 0,
        top: target.top ?? 0,
      });
      return;
    }

    // Compute delta from last known position
    const prev = frameDragStart.get(frameId)!;
    const dx = (target.left ?? 0) - prev.left;
    const dy = (target.top ?? 0) - prev.top;

    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return;

    // Move all anchored children by the same delta.
    // For one-level-deep nesting, also move grandchildren:
    // if a child is a nested frame, move objects anchored to it too.
    const movedFrameIds = new Set<string>([frameId]);
    const allObjects = canvas.getObjects();

    // First pass: move direct children, track nested frame IDs
    for (const obj of allObjects) {
      if (obj.data?.frameId === frameId) {
        obj.set({
          left: (obj.left ?? 0) + dx,
          top: (obj.top ?? 0) + dy,
        });
        obj.setCoords();
        // If this child is a frame, its children need moving too
        if (obj.data?.type === 'frame') {
          movedFrameIds.add(obj.data.id);
        }
      }
    }

    // Second pass: move grandchildren (objects inside nested frames)
    if (movedFrameIds.size > 1) {
      for (const obj of allObjects) {
        const fid = obj.data?.frameId;
        if (fid && movedFrameIds.has(fid) && fid !== frameId) {
          obj.set({
            left: (obj.left ?? 0) + dx,
            top: (obj.top ?? 0) + dy,
          });
          obj.setCoords();
        }
      }
    }

    // Third pass: update connectors attached to any moved children.
    // This handles both cases:
    //   - Both endpoints inside frame → connector translates with the frame
    //   - One endpoint inside frame → connector stretches (attached end follows, free end stays)
    for (const obj of allObjects) {
      const fid = obj.data?.frameId;
      if (!fid || !movedFrameIds.has(fid)) continue;
      if (obj.data?.type === 'connector') continue;
      updateAttachedConnectors(canvas, obj.data.id);
    }
    canvas.requestRenderAll();

    // Update tracked position
    frameDragStart.set(frameId, {
      left: target.left ?? 0,
      top: target.top ?? 0,
    });
  };

  // --- Anchored Movement: emit final positions on mouse:up ---
  const onMouseUp = () => {
    if (frameDragStart.size === 0) return;

    // Track connector IDs already emitted to avoid duplicates
    // (a connector can have BOTH endpoints attached to objects inside the same frame)
    const emittedConnectorIds = new Set<string>();

    // Emit final positions for all moved frames, their children, and grandchildren
    for (const [frameId] of frameDragStart) {
      const allObjects = canvas.getObjects();
      const movedFrameIds = new Set<string>([frameId]);
      const movedChildIds: string[] = [];

      // First pass: emit for direct children, collect nested frame IDs
      for (const obj of allObjects) {
        if (obj.data?.frameId === frameId) {
          const x = obj.left ?? 0;
          const y = obj.top ?? 0;
          emitObjectUpdate(obj.data.id, { x, y });
          useBoardStore.getState().updateObject(obj.data.id, { x, y });
          if (obj.data?.type === 'frame') {
            movedFrameIds.add(obj.data.id);
          }
          movedChildIds.push(obj.data.id);
        }
      }

      // Second pass: emit for grandchildren (objects inside nested frames)
      if (movedFrameIds.size > 1) {
        for (const obj of allObjects) {
          const fid = obj.data?.frameId;
          if (fid && movedFrameIds.has(fid) && fid !== frameId) {
            const x = obj.left ?? 0;
            const y = obj.top ?? 0;
            emitObjectUpdate(obj.data.id, { x, y });
            useBoardStore.getState().updateObject(obj.data.id, { x, y });
            movedChildIds.push(obj.data.id);
          }
        }
      }

      // Third pass: update and emit connectors attached to moved children.
      // updateAttachedConnectors repositions endpoints based on current object geometry.
      // We call it one final time to ensure endpoints are exact before serialization.
      for (const childId of movedChildIds) {
        const updatedConnectorIds = updateAttachedConnectors(canvas, childId);
        for (const connId of updatedConnectorIds) {
          if (emittedConnectorIds.has(connId)) continue;
          emittedConnectorIds.add(connId);

          const connObj = findFabricObjectById(canvas, connId);
          if (!connObj) continue;

          // Emit full connector state (x, y, x2, y2, anchors, etc.)
          const boardObj = fabricToBoardObject(connObj);
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { id: _id, createdBy, createdAt, type: _type, ...connUpdates } = boardObj as unknown as Record<string, unknown>;
          emitObjectUpdate(connId, connUpdates);
          useBoardStore.getState().updateObject(connId, connUpdates as Record<string, unknown>);
        }
      }
    }

    frameDragStart.clear();
  };

  // --- Child un-anchoring: when a child is dragged out of its frame ---
  // --- Frame resize un-anchoring: when a locked frame is resized ---
  const onObjectModified = (opt: fabric.IEvent<Event>) => {
    const target = opt.target;
    if (!target) return;

    // Case 1: A locked frame was resized — check if children fell outside
    if (target.data?.type === 'frame' && target.data.locked && target instanceof fabric.Group) {
      const frameId = target.data.id;
      const frameBounds = target.getBoundingRect(true, true);

      const releasedFrameIds: string[] = [];
      for (const obj of canvas.getObjects()) {
        if (obj.data?.frameId !== frameId) continue;
        const objBounds = obj.getBoundingRect(true, true);
        const isInside = (
          objBounds.left >= frameBounds.left &&
          objBounds.top >= frameBounds.top &&
          objBounds.left + objBounds.width <= frameBounds.left + frameBounds.width &&
          objBounds.top + objBounds.height <= frameBounds.top + frameBounds.height
        );
        if (!isInside) {
          obj.data = { ...obj.data, frameId: null };
          obj.set({ selectable: true, evented: true });
          emitObjectUpdate(obj.data.id, { frameId: null });
          useBoardStore.getState().updateObject(obj.data.id, { frameId: null });
          // If a nested frame was released, also release its children
          if (obj.data?.type === 'frame') {
            releasedFrameIds.push(obj.data.id);
          }
        }
      }
      // Release grandchildren of any nested frames that were un-anchored
      if (releasedFrameIds.length > 0) {
        for (const obj of canvas.getObjects()) {
          if (obj.data?.frameId && releasedFrameIds.includes(obj.data.frameId)) {
            obj.data = { ...obj.data, frameId: null };
            obj.set({ selectable: true, evented: true });
            emitObjectUpdate(obj.data.id, { frameId: null });
            useBoardStore.getState().updateObject(obj.data.id, { frameId: null });
          }
        }
      }
      return;
    }

    // Case 2: An anchored child was moved/resized — check if it left the frame
    // (This case is now rare since locked children are unselectable, but can
    // still occur via programmatic moves or if the object was re-enabled.)
    if (!target.data?.frameId) return;

    const parentFrameId = target.data.frameId;
    const frame = canvas.getObjects().find(
      (o) => o.data?.id === parentFrameId && o.data?.type === 'frame'
    );

    if (!frame || !(frame instanceof fabric.Group)) {
      // Frame was deleted — clear the stale frameId and restore selectability
      target.data = { ...target.data, frameId: null };
      target.set({ selectable: true, evented: true });
      emitObjectUpdate(target.data.id, { frameId: null });
      useBoardStore.getState().updateObject(target.data.id, { frameId: null });
      return;
    }

    const objBounds = target.getBoundingRect(true, true);
    const frameBounds = frame.getBoundingRect(true, true);
    const isInside = (
      objBounds.left >= frameBounds.left &&
      objBounds.top >= frameBounds.top &&
      objBounds.left + objBounds.width <= frameBounds.left + frameBounds.width &&
      objBounds.top + objBounds.height <= frameBounds.top + frameBounds.height
    );

    if (!isInside) {
      target.data = { ...target.data, frameId: null };
      target.set({ selectable: true, evented: true });
      emitObjectUpdate(target.data.id, { frameId: null });
      useBoardStore.getState().updateObject(target.data.id, { frameId: null });

      // If the un-anchored child is a nested frame, also release its children
      if (target.data?.type === 'frame') {
        for (const obj of canvas.getObjects()) {
          if (obj.data?.frameId === target.data.id) {
            obj.data = { ...obj.data, frameId: null };
            obj.set({ selectable: true, evented: true });
            emitObjectUpdate(obj.data.id, { frameId: null });
            useBoardStore.getState().updateObject(obj.data.id, { frameId: null });
          }
        }
      }
    }
  };

  canvas.on('mouse:down', onMouseDown);
  canvas.on('object:moving', onObjectMoving);
  canvas.on('mouse:up', onMouseUp);
  canvas.on('object:modified', onObjectModified);

  return () => {
    canvas.off('mouse:down', onMouseDown);
    canvas.off('object:moving', onObjectMoving);
    canvas.off('mouse:up', onMouseUp);
    canvas.off('object:modified', onObjectModified);
    frameDragStart.clear();
  };
}

// ============================================================
// Selection Tracking (Sync canvas selection → uiStore)
// ============================================================

/**
 * Keeps uiStore.selectedObjectIds / selectedObjectTypes in sync with
 * the canvas selection state. The sidebar uses these to conditionally
 * show the z-order control buttons.
 */
function setupSelectionTracking(canvas: fabric.Canvas): () => void {
  function updateSelection(): void {
    const active = canvas.getActiveObject();
    if (!active) {
      useUIStore.getState().clearSelection();
      return;
    }

    let ids: string[];
    let types: string[];

    if (active.type === 'activeSelection') {
      const objects = (active as fabric.ActiveSelection).getObjects();
      ids = objects.map((o) => o.data?.id).filter(Boolean) as string[];
      types = objects.map((o) => o.data?.type).filter(Boolean) as string[];
    } else {
      ids = active.data?.id ? [active.data.id] : [];
      types = active.data?.type ? [active.data.type] : [];
    }

    useUIStore.getState().setSelection(ids, types);
  }

  function autoCloseRightSidebar(): void {
    const ui = useUIStore.getState();
    if (ui.rightSidebarAutoOpened) {
      useUIStore.setState({ rightSidebarOpen: false, rightSidebarAutoOpened: false });
    }
  }

  /** When the user selects an object on the canvas while a creation tool is
   *  active, automatically switch back to the select tool. This feels natural:
   *  clicking an existing object implies you want to interact with it, not
   *  create a new one. */
  function autoSwitchToSelectTool(): void {
    const { activeTool, setActiveTool } = useUIStore.getState();
    if (activeTool !== 'select' && activeTool !== 'dropper') {
      setActiveTool('select');
    }
  }

  /**
   * Auto-open the appropriate sidebar when a selection is created/updated:
   * - Teleport flags → open right sidebar (flag list lives there)
   * - Regular objects → open left sidebar if closed (object properties live there)
   *
   * Drag state handler already closes sidebars during drag and restores
   * on drag end, so this fires correctly for simple click-to-select.
   */
  function autoOpenSidebar(): void {
    const active = canvas.getActiveObject();
    if (!active) return;

    // If drag is in progress, don't auto-open (drag handler manages sidebars)
    if (useUIStore.getState().isDraggingObject) return;

    const isTeleportFlag = active.type !== 'activeSelection' &&
      active.data?.type === 'teleportFlag';

    if (isTeleportFlag) {
      // Open right sidebar for flag interaction
      if (!useUIStore.getState().rightSidebarOpen) {
        useUIStore.getState().setRightSidebarOpen(true);
      }
    } else {
      // Open left sidebar for object properties
      if (!useUIStore.getState().sidebarOpen) {
        useUIStore.getState().setSidebarOpen(true);
      }
    }
  }

  function onSelectionCreated(): void {
    updateSelection();
    autoSwitchToSelectTool();
    // Auto-open sidebar for selected object type; auto-close right sidebar
    // if it was auto-opened from copy (but skip close if selecting a flag)
    const active = canvas.getActiveObject();
    const isTeleportFlag = active && active.type !== 'activeSelection' &&
      active.data?.type === 'teleportFlag';
    if (!isTeleportFlag) autoCloseRightSidebar();
    autoOpenSidebar();
  }

  function onSelectionUpdated(): void {
    updateSelection();
    autoSwitchToSelectTool();
    const active = canvas.getActiveObject();
    const isTeleportFlag = active && active.type !== 'activeSelection' &&
      active.data?.type === 'teleportFlag';
    if (!isTeleportFlag) autoCloseRightSidebar();
    autoOpenSidebar();
  }

  canvas.on('selection:created', onSelectionCreated);
  canvas.on('selection:updated', onSelectionUpdated);
  canvas.on('selection:cleared', updateSelection);

  return () => {
    canvas.off('selection:created', onSelectionCreated);
    canvas.off('selection:updated', onSelectionUpdated);
    canvas.off('selection:cleared', updateSelection);
    useUIStore.getState().clearSelection();
  };
}

