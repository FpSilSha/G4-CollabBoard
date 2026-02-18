import { useEffect, useRef } from 'react';
import { fabric } from 'fabric';
import { CANVAS_CONFIG, UI_COLORS } from 'shared';
import { useBoardStore } from '../stores/boardStore';
import { useUIStore } from '../stores/uiStore';

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
  containerRef: React.RefObject<HTMLDivElement | null>
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

    // --- Resize observer ---
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        canvas.setDimensions({ width, height });
        canvas.requestRenderAll();
      }
    });
    resizeObserver.observe(container);

    // --- Cleanup ---
    return () => {
      cleanupPan();
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
    canvas.requestRenderAll();
  });

  canvas.on('mouse:up', () => {
    if (isDragging) {
      isDragging = false;
      canvas.defaultCursor = 'default';
      const upperCanvas = canvas.getElement().parentElement?.querySelector('.upper-canvas') as HTMLCanvasElement | null;
      if (upperCanvas) upperCanvas.style.cursor = 'default';
      canvas.selection = true;
      canvas.requestRenderAll();
    }
  });

  return () => {
    // No document listeners to clean up
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

