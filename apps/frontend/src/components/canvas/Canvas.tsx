import { useRef, useEffect } from 'react';
import type { Socket } from 'socket.io-client';
import { useCanvas } from '../../hooks/useCanvas';
import { useObjectCreation } from '../../hooks/useObjectCreation';
import { useCanvasSync } from '../../hooks/useCanvasSync';
import { useUIStore } from '../../stores/uiStore';
import { RemoteCursors } from './RemoteCursors';
import styles from './Canvas.module.css';

/**
 * Inline SVG cursor for the dropper (eyedropper) tool.
 * 16×16 px at hotspot (1,15) — tip of the dropper at bottom-left.
 */
const DROPPER_CURSOR_SVG = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 22l1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="M14.5 5.5 18 2l4 4-3.5 3.5"/><path d="M12 8l4 4"/></svg>`
);
const DROPPER_CURSOR = `url("data:image/svg+xml,${DROPPER_CURSOR_SVG}") 2 22, crosshair`;

interface CanvasProps {
  socketRef: React.MutableRefObject<Socket | null>;
}

/**
 * Main canvas component. Renders the Fabric.js canvas, handles
 * drag-drop from the sidebar, bridges canvas↔WebSocket sync,
 * and renders remote cursors overlay.
 *
 * Layout: fills all remaining space after sidebar + header.
 */
export function Canvas({ socketRef }: CanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fabricRef = useCanvas(containerRef, socketRef);
  const { handleDrop, handleDragOver } = useObjectCreation(fabricRef, socketRef);

  // Bridge Fabric.js events <-> WebSocket events
  useCanvasSync(socketRef, fabricRef);

  // --- Tool-specific cursor ---
  // When the dropper tool is active, show a dropper cursor on the canvas.
  // Resets to default when any other tool is selected.
  const activeTool = useUIStore((s) => s.activeTool);

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    if (activeTool === 'dropper') {
      canvas.defaultCursor = DROPPER_CURSOR;
      canvas.hoverCursor = DROPPER_CURSOR;
    } else if (activeTool === 'select') {
      canvas.defaultCursor = 'default';
      canvas.hoverCursor = 'move';
    } else {
      // Creation tools (sticky, rectangle, circle)
      canvas.defaultCursor = 'crosshair';
      canvas.hoverCursor = 'crosshair';
    }

    // Also update the upper canvas cursor immediately
    const upperCanvas = canvas.getElement().parentElement?.querySelector(
      '.upper-canvas'
    ) as HTMLCanvasElement | null;
    if (upperCanvas) {
      upperCanvas.style.cursor = canvas.defaultCursor;
    }

    canvas.requestRenderAll();
  }, [activeTool, fabricRef]);

  return (
    <div
      ref={containerRef}
      className={styles.canvasContainer}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <RemoteCursors />
    </div>
  );
}
