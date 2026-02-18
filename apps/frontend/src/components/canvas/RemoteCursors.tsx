import { useMemo } from 'react';
import { usePresenceStore } from '../../stores/presenceStore';
import { useBoardStore } from '../../stores/boardStore';
import styles from './RemoteCursors.module.css';

/**
 * Renders remote user cursors as SVG arrows with name labels.
 * Positioned absolutely over the canvas container.
 *
 * Cursor positions are in canvas coordinates; we convert to screen
 * coordinates using the Fabric.js viewport transform (zoom + pan).
 *
 * CSS transition on transform provides smooth interpolation between
 * the 50ms throttled cursor updates.
 */
export function RemoteCursors() {
  const remoteCursors = usePresenceStore((s) => s.remoteCursors);
  const canvas = useBoardStore((s) => s.canvas);
  const zoom = useBoardStore((s) => s.zoom);

  // Convert canvas coordinates to screen coordinates
  const cursorElements = useMemo(() => {
    if (!canvas) return [];

    const vpt = canvas.viewportTransform;
    if (!vpt) return [];

    const entries: Array<{
      userId: string;
      name: string;
      color: string;
      screenX: number;
      screenY: number;
    }> = [];

    remoteCursors.forEach((cursor) => {
      const screenX = cursor.x * vpt[0] + vpt[4];
      const screenY = cursor.y * vpt[3] + vpt[5];
      entries.push({
        userId: cursor.userId,
        name: cursor.name,
        color: cursor.color,
        screenX,
        screenY,
      });
    });

    return entries;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteCursors, canvas, zoom]);

  return (
    <div className={styles.cursorLayer}>
      {cursorElements.map((cursor) => (
        <div
          key={cursor.userId}
          className={styles.cursorWrapper}
          style={{
            transform: `translate(${cursor.screenX}px, ${cursor.screenY}px)`,
          }}
        >
          {/* SVG arrow cursor */}
          <svg
            className={styles.cursorArrow}
            width="16"
            height="20"
            viewBox="0 0 16 20"
            fill={cursor.color}
          >
            <path
              d="M0 0l16 8-6.5 2L6 16z"
              stroke="#000"
              strokeWidth="1"
              strokeLinejoin="round"
            />
          </svg>
          {/* Name label */}
          <span
            className={styles.cursorLabel}
            style={{ backgroundColor: cursor.color }}
          >
            {cursor.name}
          </span>
        </div>
      ))}
    </div>
  );
}
