import { useEffect, useRef } from 'react';
import { fabric } from 'fabric';
import { CANVAS_CONFIG, UI_COLORS, WebSocketEvent } from 'shared';
import { useBoardStore } from '../stores/boardStore';
import { useUIStore } from '../stores/uiStore';
import {
  getObjectFillColor,
  getObjectsInsideFrame,
  fabricToBoardObject,
} from '../utils/fabricHelpers';
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
      fireRightClick: false,
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

    // --- Z-ordering: bring clicked object to front ---
    setupZOrderHandler(canvas);

    // --- Selection glow: colored aura around selected objects ---
    const cleanupGlow = setupSelectionGlow(canvas);

    // --- Drag state: auto-close sidebars + edge overlay while dragging ---
    const cleanupDragState = setupDragState(canvas, socketRef ?? null);

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
  mtrControl.render = function (ctx, left, top, _styleOverride, fabricObj) {
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

    // Hide dots at zoom <= 0.3 to prevent lag
    if (zoom <= 0.3) return;

    const spacing = UI_COLORS.DOT_GRID_SPACING;
    const canvasWidth = canvas.getWidth();
    const canvasHeight = canvas.getHeight();

    // Calculate the visible area in canvas coordinates
    const startX = -vpt[4] / zoom;
    const startY = -vpt[5] / zoom;
    const endX = startX + canvasWidth / zoom;
    const endY = startY + canvasHeight / zoom;

    // Round to nearest grid line
    const firstCol = Math.floor(startX / spacing) * spacing;
    const firstRow = Math.floor(startY / spacing) * spacing;

    ctx.save();
    ctx.fillStyle = UI_COLORS.DOT_GRID_COLOR;

    for (let x = firstCol; x <= endX; x += spacing) {
      for (let y = firstRow; y <= endY; y += spacing) {
        const screenX = x * zoom + vpt[4];
        const screenY = y * zoom + vpt[5];

        ctx.beginPath();
        ctx.arc(screenX, screenY, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

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
    // Only pan if clicking on empty canvas (no object target)
    if (opt.target) return;

    // Only pan when select tool is active (creation tools need empty-canvas clicks)
    const activeTool = useUIStore.getState().activeTool;
    if (activeTool !== 'select') return;

    // Shift+click on empty canvas → rubber band selection, don't pan
    if (opt.e.shiftKey) return;

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
    canvas.setViewportTransform(vpt);
  });

  canvas.on('mouse:up', () => {
    if (isDragging) {
      isDragging = false;
      canvas.defaultCursor = 'default';
      const upperCanvas = canvas.getElement().parentElement?.querySelector('.upper-canvas') as HTMLCanvasElement | null;
      if (upperCanvas) upperCanvas.style.cursor = 'default';
      canvas.selection = true;
      canvas.calcOffset(); // Ensure offset cache is fresh after pan ends
      canvas.requestRenderAll();
    }
  });

  return () => {
    // No document listeners to clean up
  };
}

// ============================================================
// Z-Order Handler (Bring clicked object to front)
// ============================================================

/**
 * When a user clicks on (selects) an object, bring it to the front
 * of the canvas so it renders above all other objects.
 *
 * This is a visual-only change — z-order is not persisted or synced.
 * Objects are re-added in server order on board reload, but during
 * a session the last-touched object always appears on top.
 */
function setupZOrderHandler(canvas: fabric.Canvas): void {
  canvas.on('mouse:down', (opt: fabric.IEvent<MouseEvent>) => {
    if (!opt.target) return;

    // Only reorder when using the select tool
    const activeTool = useUIStore.getState().activeTool;
    if (activeTool !== 'select') return;

    // Frames stay behind non-frame objects — bring to front of other frames only
    if (opt.target.data?.type === 'frame') {
      // Find the highest non-frame object index and place frame just below it
      const allObjects = canvas.getObjects();
      let highestFrameIdx = -1;
      for (let i = 0; i < allObjects.length; i++) {
        if (allObjects[i].data?.type === 'frame') {
          highestFrameIdx = i;
        }
      }
      if (highestFrameIdx > -1) {
        canvas.moveTo(opt.target, highestFrameIdx);
      }
    } else {
      canvas.bringToFront(opt.target);
    }
    canvas.requestRenderAll();
  });
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
    // Skip glow for connectors — the endpoint controls provide sufficient
    // selection feedback, and the blur-60 glow makes the line look bloated
    if (obj.data?.type === 'text' || obj.data?.type === 'connector' || obj.data?.type === 'teleportFlag') return;

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
      blur: 60,
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

  canvas.on('selection:created', onSelectionCreated);
  canvas.on('selection:updated', onSelectionUpdated);
  canvas.on('selection:cleared', onSelectionCleared);

  return () => {
    canvas.off('selection:created', onSelectionCreated);
    canvas.off('selection:updated', onSelectionUpdated);
    canvas.off('selection:cleared', onSelectionCleared);
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

    setZoom(zoom);
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
 */
function setupDragState(
  canvas: fabric.Canvas,
  socketRef: React.MutableRefObject<Socket | null> | null
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
      const uiState = useUIStore.getState();
      useUIStore.setState({ sidebarOpenBeforeDrag: uiState.sidebarOpen });
      uiState.setSidebarOpen(false);
      uiState.setIsDraggingObject(true);
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
        for (const obj of objects) {
          deleteObject(obj);
        }
      } else {
        deleteObject(target);
      }
      canvas.requestRenderAll();
    }

    // Reset state
    isOverTrash = false;
    setTrashHighlight(false);
    dragActive = false;

    const uiState = useUIStore.getState();
    uiState.setSidebarOpen(uiState.sidebarOpenBeforeDrag);
    uiState.setIsDraggingObject(false);
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
  // click hit the lockToggle control.
  const onMouseDown = (opt: fabric.IEvent) => {
    const target = opt.target;
    if (!target || target.data?.type !== 'frame') return;
    if (!(target instanceof fabric.Group)) return;

    // Check if the click hit one of our custom controls
    // Fabric.js sets __corner on the target when a control is clicked
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const corner = (target as any).__corner;

    if (corner === 'lockToggle') {
      const isLocked = target.data.locked ?? false;
      const newLocked = !isLocked;
      target.data.locked = newLocked;

      if (newLocked) {
        // Lock: find all qualifying objects and anchor them
        const children = getObjectsInsideFrame(canvas, target);
        for (const child of children) {
          child.data = { ...child.data, frameId: target.data.id };
          // Make children unselectable while locked inside the frame
          child.set({ selectable: false, evented: false });
          // Emit frameId update for each child
          emitObjectUpdate(child.data.id, { frameId: target.data.id });
          // Update in boardStore
          useBoardStore.getState().updateObject(child.data.id, { frameId: target.data.id });
        }
      } else {
        // Unlock: clear frameId from all children and restore selectability
        const allObjects = canvas.getObjects();
        for (const obj of allObjects) {
          if (obj.data?.frameId === target.data.id) {
            obj.data = { ...obj.data, frameId: null };
            obj.set({ selectable: true, evented: true });
            emitObjectUpdate(obj.data.id, { frameId: null });
            useBoardStore.getState().updateObject(obj.data.id, { frameId: null });
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
      const newTitle = prompt('Frame title:', currentTitle);
      if (newTitle !== null && newTitle !== currentTitle) {
        const trimmed = newTitle.slice(0, 255);
        target.data.title = trimmed;

        // Update the label text inside the group
        const label = target.getObjects()[1] as fabric.Text;
        label.set('text', trimmed || 'Frame');

        // Emit update
        emitObjectUpdate(target.data.id, { title: trimmed });
        useBoardStore.getState().updateObject(target.data.id, { title: trimmed });

        canvas.requestRenderAll();
      }
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

    // Move all anchored children by the same delta
    const allObjects = canvas.getObjects();
    for (const obj of allObjects) {
      if (obj.data?.frameId === frameId) {
        obj.set({
          left: (obj.left ?? 0) + dx,
          top: (obj.top ?? 0) + dy,
        });
        obj.setCoords();
      }
    }

    // Update tracked position
    frameDragStart.set(frameId, {
      left: target.left ?? 0,
      top: target.top ?? 0,
    });
  };

  // --- Anchored Movement: emit final positions on mouse:up ---
  const onMouseUp = () => {
    if (frameDragStart.size === 0) return;

    // Emit final positions for all moved frames and their children
    for (const [frameId] of frameDragStart) {
      const allObjects = canvas.getObjects();
      for (const obj of allObjects) {
        if (obj.data?.frameId === frameId) {
          const x = obj.left ?? 0;
          const y = obj.top ?? 0;
          emitObjectUpdate(obj.data.id, { x, y });
          useBoardStore.getState().updateObject(obj.data.id, { x, y });
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

  function onSelectionCreated(): void {
    updateSelection();
    autoCloseRightSidebar();
  }

  function onSelectionUpdated(): void {
    updateSelection();
    autoCloseRightSidebar();
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

