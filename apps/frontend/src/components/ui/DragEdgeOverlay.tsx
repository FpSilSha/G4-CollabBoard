import { useUIStore } from '../../stores/uiStore';
import styles from './DragEdgeOverlay.module.css';

/**
 * A translucent border overlay that appears around the viewport edges
 * when the user is dragging an object on the canvas. This provides a
 * visual cue that the sidebars have collapsed and edge-scroll zones
 * are active.
 *
 * Renders nothing when no drag is in progress.
 */
export function DragEdgeOverlay() {
  const isDragging = useUIStore((s) => s.isDraggingObject);

  if (!isDragging) return null;

  return <div className={styles.overlay} />;
}
