import { useRef } from 'react';
import { useCanvas } from '../../hooks/useCanvas';
import { useObjectCreation } from '../../hooks/useObjectCreation';
import styles from './Canvas.module.css';

/**
 * Main canvas component. Renders the Fabric.js canvas and handles
 * drag-drop from the sidebar.
 *
 * Layout: fills all remaining space after sidebar + header.
 */
export function Canvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const fabricRef = useCanvas(containerRef);
  const { handleDrop, handleDragOver } = useObjectCreation(fabricRef);

  return (
    <div
      ref={containerRef}
      className={styles.canvasContainer}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    />
  );
}
