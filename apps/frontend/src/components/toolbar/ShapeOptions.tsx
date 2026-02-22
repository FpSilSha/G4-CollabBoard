import { useUIStore, type ShapeTool } from '../../stores/uiStore';
import styles from './ShapeOptions.module.css';

/** Shape sub-tools with icons and labels. */
const SHAPES: { tool: ShapeTool; label: string; icon: React.ReactNode }[] = [
  { tool: 'rectangle', label: 'Rectangle', icon: <RectIcon /> },
  { tool: 'circle', label: 'Circle', icon: <CircleShapeIcon /> },
  { tool: 'triangle', label: 'Triangle', icon: <TriangleIcon /> },
  { tool: 'star', label: 'Star', icon: <StarShapeIcon /> },
  { tool: 'arrow', label: 'Arrow', icon: <ArrowShapeOptionIcon /> },
];

/**
 * Shape sub-tool picker — appears when the Shape tool button is active.
 * Lets the user switch between rectangle, circle, triangle, star, arrow.
 */
export function ShapeOptions() {
  const activeShapeTool = useUIStore((s) => s.activeShapeTool);
  const setActiveShapeTool = useUIStore((s) => s.setActiveShapeTool);

  return (
    <div className={styles.panel}>
      <span className={styles.label}>Shape</span>
      <div className={styles.shapeRow}>
        {SHAPES.map((shape) => {
          const isActive = activeShapeTool === shape.tool;
          return (
            <button
              key={shape.tool}
              className={`${styles.shapeBtn} ${isActive ? styles.active : ''}`}
              onClick={() => setActiveShapeTool(shape.tool)}
              title={shape.label}
              aria-label={shape.label}
            >
              {shape.icon}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// Inline SVG Icons (small, monochrome)
// ============================================================

function RectIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="5" width="18" height="14" rx="1" />
    </svg>
  );
}

function CircleShapeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

function TriangleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <polygon points="12,3 22,21 2,21" />
    </svg>
  );
}

function StarShapeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
    </svg>
  );
}

function ArrowShapeOptionIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <polygon points="2,10 14,10 14,5 22,12 14,19 14,14 2,14" />
    </svg>
  );
}
