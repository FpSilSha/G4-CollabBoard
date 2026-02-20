import { useUIStore, Tool } from '../../stores/uiStore';
import { ColorPicker } from '../canvas/ColorPicker';
import styles from './Sidebar.module.css';

/**
 * Left sidebar containing:
 * 1. Collapse/expand toggle
 * 2. Tool selection buttons (Select, Dropper)
 * 3. Draggable object creation icons (Sticky, Rectangle, Circle)
 * 4. Color picker
 *
 * Objects can be created by:
 * - Clicking a tool icon then clicking on the canvas
 * - Dragging an icon from the sidebar onto the canvas
 *
 * The sidebar can be collapsed to free up canvas space. When collapsed,
 * a small "lip" tab sticks out from the left edge for re-opening.
 */
export function Sidebar() {
  const activeTool = useUIStore((s) => s.activeTool);
  const setActiveTool = useUIStore((s) => s.setActiveTool);
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);

  const handleDragStart = (e: React.DragEvent, objectType: string) => {
    e.dataTransfer.setData('application/collabboard-type', objectType);
    e.dataTransfer.setData(
      'application/collabboard-color',
      useUIStore.getState().activeColor
    );
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <aside className={`${styles.sidebar} ${sidebarOpen ? '' : styles.collapsed}`}>
      {/* --- Collapse/Expand toggle (right edge, vertically centered) --- */}
      <button
        className={styles.edgeToggle}
        onClick={toggleSidebar}
        title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
      >
        {sidebarOpen ? <ChevronLeftIcon /> : <ChevronRightIcon />}
      </button>

      {/* --- Tool content (hidden when collapsed) --- */}
      {sidebarOpen && (
        <>
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
            <DraggableToolButton
              icon={<TextIcon />}
              label="Text (T)"
              tool="text"
              activeTool={activeTool}
              onClick={setActiveTool}
              onDragStart={(e) => handleDragStart(e, 'text')}
            />
            <DraggableToolButton
              icon={<FrameIcon />}
              label="Frame (F)"
              tool="frame"
              activeTool={activeTool}
              onClick={setActiveTool}
              onDragStart={(e) => handleDragStart(e, 'frame')}
            />
            <DraggableToolButton
              icon={<ConnectorIcon />}
              label="Connector (L)"
              tool="connector"
              activeTool={activeTool}
              onClick={setActiveTool}
              onDragStart={(e) => handleDragStart(e, 'connector')}
            />
          </div>

          {/* --- Color Picker --- */}
          <div className={styles.toolGroup}>
            <ColorPicker />
          </div>
        </>
      )}
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

function TextIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M4 7V4h16v3" />
      <path d="M12 4v16" />
      <path d="M8 20h8" />
    </svg>
  );
}

function FrameIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="4 2" />
      <text x="6" y="10" fontSize="6" fill="currentColor" stroke="none">F</text>
    </svg>
  );
}

function ConnectorIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <line x1="5" y1="19" x2="19" y2="5" />
      <polyline points="14 5 19 5 19 10" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

