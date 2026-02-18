import { fabric } from 'fabric';
import { CANVAS_CONFIG } from 'shared';
import { useBoardStore } from '../../stores/boardStore';
import styles from './Header.module.css';

/**
 * Header bar at the top of the main area (right of sidebar).
 *
 * Contains:
 * - Board title (hardcoded "Untitled Board" for Phase 3)
 * - Zoom controls (-, percentage display, +, home button)
 * - Placeholder for presence avatars (Phase 4)
 */
export function Header() {
  const zoom = useBoardStore((s) => s.zoom);
  const canvas = useBoardStore((s) => s.canvas);
  const boardTitle = useBoardStore((s) => s.boardTitle);
  const setZoom = useBoardStore((s) => s.setZoom);

  const handleZoom = (newZoom: number) => {
    if (!canvas) return;
    const clamped = Math.max(
      CANVAS_CONFIG.MIN_ZOOM,
      Math.min(CANVAS_CONFIG.MAX_ZOOM, newZoom)
    );
    // Zoom toward canvas center
    const center = new fabric.Point(
      canvas.getWidth() / 2,
      canvas.getHeight() / 2
    );
    canvas.zoomToPoint(center, clamped);
    setZoom(clamped);
  };

  const handleZoomIn = () => handleZoom(zoom + CANVAS_CONFIG.ZOOM_STEP);
  const handleZoomOut = () => handleZoom(zoom - CANVAS_CONFIG.ZOOM_STEP);

  /**
   * Home: center the viewport on the defined board center point (0,0)
   * at the current zoom level. The center point is always placed at
   * the center of the viewport, regardless of zoom level.
   */
  const handleHome = () => {
    if (!canvas) return;
    const vpt = canvas.viewportTransform!;
    // Place canvas origin (0,0) at the center of the viewport
    vpt[4] = canvas.getWidth() / 2;
    vpt[5] = canvas.getHeight() / 2;
    canvas.setViewportTransform(vpt);
  };

  const zoomPercent = Math.round(zoom * 100);

  return (
    <header className={styles.header}>
      <div className={styles.left}>
        <h1 className={styles.boardTitle}>{boardTitle}</h1>
      </div>

      <div className={styles.center}>
        <div className={styles.zoomControls}>
          <button
            className={styles.zoomButton}
            onClick={handleZoomOut}
            title="Zoom Out"
            aria-label="Zoom out"
            disabled={zoom <= CANVAS_CONFIG.MIN_ZOOM}
          >
            &minus;
          </button>
          <span className={styles.zoomLevel}>{zoomPercent}%</span>
          <button
            className={styles.zoomButton}
            onClick={handleZoomIn}
            title="Zoom In"
            aria-label="Zoom in"
            disabled={zoom >= CANVAS_CONFIG.MAX_ZOOM}
          >
            +
          </button>
          <button
            className={styles.homeButton}
            onClick={handleHome}
            title="Return to Center (H)"
            aria-label="Return to center of canvas"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1" />
            </svg>
          </button>
        </div>
      </div>

      <div className={styles.right}>
        {/* Phase 4: Presence avatars will go here */}
        <div className={styles.presencePlaceholder} />
      </div>
    </header>
  );
}
