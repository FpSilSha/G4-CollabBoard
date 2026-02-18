import { useUIStore, Tool } from '../../stores/uiStore';
import { ColorPicker } from '../canvas/ColorPicker';
import styles from './Sidebar.module.css';

/**
 * Left sidebar containing:
 * 1. Tool selection buttons (Select, Dropper)
 * 2. Draggable object creation icons (Sticky, Rectangle, Circle)
 * 3. Color picker
 *
 * Objects can be created by:
 * - Clicking a tool icon then clicking on the canvas
 * - Dragging an icon from the sidebar onto the canvas
 */
export function Sidebar() {
  const activeTool = useUIStore((s) => s.activeTool);
  const setActiveTool = useUIStore((s) => s.setActiveTool);

  const handleDragStart = (e: React.DragEvent, objectType: string) => {
    e.dataTransfer.setData('application/collabboard-type', objectType);
    e.dataTransfer.setData(
      'application/collabboard-color',
      useUIStore.getState().activeColor
    );
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <aside className={styles.sidebar}>
      {/* --- Selection Tools --- */}
      <div className={styles.toolGroup}>
        <ToolButton
          icon={<PointerIcon />}
          label="Select (V)"
          tool="select"
          activeTool={activeTool}
          onClick={setActiveTool}
        />
        <ToolButton
          icon={<DropperIcon />}
          label="Color Picker (I)"
          tool="dropper"
          activeTool={activeTool}
          onClick={setActiveTool}
        />
      </div>

      {/* --- Object Creation --- */}
      <div className={styles.toolGroup}>
        <DraggableToolButton
          icon={<StickyIcon />}
          label="Sticky Note (S)"
          tool="sticky"
          activeTool={activeTool}
          onClick={setActiveTool}
          onDragStart={(e) => handleDragStart(e, 'sticky')}
        />
        <DraggableToolButton
          icon={<RectangleIcon />}
          label="Rectangle (R)"
          tool="rectangle"
          activeTool={activeTool}
          onClick={setActiveTool}
          onDragStart={(e) => handleDragStart(e, 'rectangle')}
        />
        <DraggableToolButton
          icon={<CircleIcon />}
          label="Circle (C)"
          tool="circle"
          activeTool={activeTool}
          onClick={setActiveTool}
          onDragStart={(e) => handleDragStart(e, 'circle')}
        />
      </div>

      {/* --- Color Picker --- */}
      <div className={styles.toolGroup}>
        <ColorPicker />
      </div>
    </aside>
  );
}

// ============================================================
// Sub-components
// ============================================================

function ToolButton(props: {
  icon: React.ReactNode;
  label: string;
  tool: Tool;
  activeTool: Tool;
  onClick: (tool: Tool) => void;
}) {
  const isActive = props.tool === props.activeTool;
  return (
    <button
      className={`${styles.toolButton} ${isActive ? styles.active : ''}`}
      onClick={() => props.onClick(props.tool)}
      title={props.label}
      aria-label={props.label}
    >
      {props.icon}
    </button>
  );
}

function DraggableToolButton(props: {
  icon: React.ReactNode;
  label: string;
  tool: Tool;
  activeTool: Tool;
  onClick: (tool: Tool) => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  const isActive = props.tool === props.activeTool;
  return (
    <div
      className={`${styles.draggableItem} ${isActive ? styles.active : ''}`}
      draggable
      onDragStart={props.onDragStart}
      onClick={() => props.onClick(props.tool)}
      title={props.label}
      role="button"
      aria-label={props.label}
      tabIndex={0}
    >
      {props.icon}
    </div>
  );
}

// ============================================================
// SVG Icons (inline, small, monochrome white)
// ============================================================

function PointerIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
    </svg>
  );
}

function DropperIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M2 22l1-1h3l9-9" />
      <path d="M3 21v-3l9-9" />
      <circle cx="17.5" cy="6.5" r="3.5" />
    </svg>
  );
}

function StickyIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="3" y="3" width="18" height="18" rx="1" />
      <path d="M15 3v6h6" />
    </svg>
  );
}

function RectangleIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="3" y="5" width="18" height="14" rx="1" />
    </svg>
  );
}

function CircleIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}
