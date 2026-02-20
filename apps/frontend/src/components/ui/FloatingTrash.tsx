import { useUIStore } from '../../stores/uiStore';
import styles from './FloatingTrash.module.css';

/**
 * Floating trash button that appears at the bottom-center of the canvas
 * when the user is dragging an object. Sits ABOVE the edge border overlay
 * so the user can drag past it to use edge-scroll without accidentally
 * deleting.
 *
 * The actual deletion logic is handled by detecting when the mouse:up
 * event fires while the pointer is over this element (see useCanvas.ts
 * setupDragState). This component only renders the visual indicator.
 *
 * Renders nothing when no drag is in progress.
 */
export function FloatingTrash() {
  const isDragging = useUIStore((s) => s.isDraggingObject);

  if (!isDragging) return null;

  return (
    <div className={styles.trashContainer}>
      <div className={styles.trashButton} data-floating-trash="true">
        <TrashIcon />
        <span className={styles.trashLabel}>Drop to delete</span>
      </div>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}
