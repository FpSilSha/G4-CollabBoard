import { useEffect, useRef } from 'react';
import { fabric } from 'fabric';
import { CANVAS_CONFIG, UI_COLORS, WebSocketEvent } from 'shared';
import { useBoardStore } from '../stores/boardStore';
import { useUIStore } from '../stores/uiStore';
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

    // --- Trash zone: drag objects to sidebar trash to delete ---
    const cleanupTrash = setupTrashZone(canvas, socketRef ?? null);

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
      cleanupTrash();
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
 */
function setupSelectionStyle(): void {
  fabric.Object.prototype.set({
    borderColor: UI_COLORS.FOCUS_BLUE,
    cornerColor: UI_COLORS.FOCUS_BLUE,
    cornerStrokeColor: '#FFFFFF',
    borderScaleFactor: 2,     // 2px border
    cornerSize: 8,
    cornerStyle: 'circle',
    transparentCorners: false,
    padding: 4,
  });
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
    ctx.fillStyle = `rgba(0, 0, 0, ${UI_COLORS.DOT_GRID_OPACITY})`;

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

    canvas.bringToFront(opt.target);
    canvas.requestRenderAll();
  });
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
// Trash Zone (Drag-to-Delete via Sidebar Trash Icon)
// ============================================================

/**
 * Detects when Fabric.js objects are dragged over the sidebar trash zone
 * and deletes them on drop.
 *
 * Since Fabric.js objects use canvas events (not HTML5 drag-and-drop),
 * we detect the trash zone by comparing the mouse pointer's screen position
 * against the trash zone DOM element's bounding rect during object:moving.
 *
 * On object:modified (mouse up), if pointer is over the trash zone, delete
 * the object(s) and emit OBJECT_DELETE to the server.
 *
 * Works for both single objects and ActiveSelection groups.
 */
function setupTrashZone(
  canvas: fabric.Canvas,
  socketRef: React.MutableRefObject<Socket | null> | null
): () => void {
  let isOverTrash = false;

  function getTrashElement(): HTMLElement | null {
    return document.querySelector('[data-trash-zone="true"]');
  }

  function isPointerOverTrash(clientX: number, clientY: number): boolean {
    const trashEl = getTrashElement();
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
    const trashEl = getTrashElement();
    if (!trashEl) return;
    if (highlight) {
      trashEl.classList.add('drag-over');
    } else {
      trashEl.classList.remove('drag-over');
    }
  }

  /**
   * Delete a single fabric object: remove from canvas, store, and emit to server.
   */
  function deleteObject(obj: fabric.Object): void {
    // Skip pinned objects
    if (obj.data?.pinned) return;

    const objectId = obj.data?.id;
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

  // Track pointer position during object movement
  const onObjectMoving = (opt: fabric.IEvent<Event>) => {
    const evt = opt.e as MouseEvent;
    const over = isPointerOverTrash(evt.clientX, evt.clientY);

    if (over !== isOverTrash) {
      isOverTrash = over;
      setTrashHighlight(over);
    }
  };

  // On mouse up after object move: if over trash, delete the object(s)
  const onObjectModified = (opt: fabric.IEvent<Event>) => {
    if (!isOverTrash) return;

    // Reset trash state
    isOverTrash = false;
    setTrashHighlight(false);

    const target = opt.target;
    if (!target) return;

    if (target.type === 'activeSelection') {
      // Multi-select: delete all objects in the group
      const objects = (target as fabric.ActiveSelection).getObjects().slice();
      canvas.discardActiveObject();
      for (const obj of objects) {
        deleteObject(obj);
      }
    } else {
      // Single object deletion
      deleteObject(target);
    }

    canvas.requestRenderAll();
  };

  // Also reset highlight if drag leaves the trash zone area
  const onMouseUp = () => {
    if (isOverTrash) {
      isOverTrash = false;
      setTrashHighlight(false);
    }
  };

  canvas.on('object:moving', onObjectMoving);
  canvas.on('object:modified', onObjectModified);
  canvas.on('mouse:up', onMouseUp);

  return () => {
    canvas.off('object:moving', onObjectMoving);
    canvas.off('object:modified', onObjectModified);
    canvas.off('mouse:up', onMouseUp);
  };
}

