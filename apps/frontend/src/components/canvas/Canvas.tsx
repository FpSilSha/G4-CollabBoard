import { useRef } from 'react';
import type { Socket } from 'socket.io-client';
import { useCanvas } from '../../hooks/useCanvas';
import { useObjectCreation } from '../../hooks/useObjectCreation';
import { useCanvasSync } from '../../hooks/useCanvasSync';
import { RemoteCursors } from './RemoteCursors';
import styles from './Canvas.module.css';

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
