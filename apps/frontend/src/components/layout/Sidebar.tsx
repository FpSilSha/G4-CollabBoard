import { fabric } from 'fabric';
import { useUIStore, Tool } from '../../stores/uiStore';
import { useBoardStore } from '../../stores/boardStore';
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

          {/* --- Z-Order Controls (visible only when objects are selected) --- */}
          <ZOrderControls />
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
// Z-Order Controls (Send to Back / Down / Up / Bring to Front)
// ============================================================

/**
 * Four z-order buttons that appear when one or more objects are selected.
 * Frames are excluded from "bring to front" — they always stay behind
 * non-frame objects.
 */
function ZOrderControls() {
  const selectedIds = useUIStore((s) => s.selectedObjectIds);
  const selectedTypes = useUIStore((s) => s.selectedObjectTypes);

  if (selectedIds.length === 0) return null;

  // Check if the selection is exclusively frames (disable bring-to-front)
  const allFrames = selectedTypes.length > 0 && selectedTypes.every((t) => t === 'frame');

  const handleZOrder = (action: 'sendToBack' | 'moveDown' | 'moveUp' | 'bringToFront') => {
    const canvas = useBoardStore.getState().canvas;
    if (!canvas) return;

    const active = canvas.getActiveObject();
    if (!active) return;

    // Collect all objects to operate on
    const objects: fabric.Object[] = active.type === 'activeSelection'
      ? (active as fabric.ActiveSelection).getObjects()
      : [active];

    // Find the lowest non-frame index (frames must stay below this)
    const allCanvasObjects = canvas.getObjects();
    let lowestNonFrameIndex = allCanvasObjects.length;
    for (let i = 0; i < allCanvasObjects.length; i++) {
      if (allCanvasObjects[i].data?.type !== 'frame') {
        lowestNonFrameIndex = i;
        break;
      }
    }

    for (const obj of objects) {
      const isFrame = obj.data?.type === 'frame';

      switch (action) {
        case 'sendToBack':
          if (isFrame) {
            canvas.sendToBack(obj);
          } else {
            // Send to back, but not behind frames
            canvas.moveTo(obj, lowestNonFrameIndex);
          }
          break;

        case 'moveDown': {
          const idx = allCanvasObjects.indexOf(obj);
          if (idx <= 0) break;
          const targetIdx = idx - 1;
          // Non-frames can't go behind frames
          if (!isFrame && allCanvasObjects[targetIdx]?.data?.type === 'frame') break;
          canvas.moveTo(obj, targetIdx);
          break;
        }

        case 'moveUp': {
          const idx = allCanvasObjects.indexOf(obj);
          if (idx >= allCanvasObjects.length - 1) break;
          const targetIdx = idx + 1;
          // Frames can't go in front of non-frames
          if (isFrame && allCanvasObjects[targetIdx]?.data?.type !== 'frame') break;
          canvas.moveTo(obj, targetIdx);
          break;
        }

        case 'bringToFront':
          if (isFrame) {
            // Frames: bring to front of other frames only
            let highestFrameIdx = -1;
            for (let i = 0; i < allCanvasObjects.length; i++) {
              if (allCanvasObjects[i].data?.type === 'frame') {
                highestFrameIdx = i;
              }
            }
            if (highestFrameIdx > -1) {
              canvas.moveTo(obj, highestFrameIdx);
            }
          } else {
            canvas.bringToFront(obj);
          }
          break;
      }
    }

    canvas.requestRenderAll();
  };

  return (
    <div className={styles.toolGroup}>
      <div className={styles.zOrderLabel}>Layer</div>
      <div className={styles.zOrderGroup}>
        <button
          className={styles.zOrderButton}
          onClick={() => handleZOrder('sendToBack')}
          title="Send to back"
          aria-label="Send to back"
        >
          <SendToBackIcon />
        </button>
        <button
          className={styles.zOrderButton}
          onClick={() => handleZOrder('moveDown')}
          title="Move down"
          aria-label="Move down one layer"
        >
          <MoveDownIcon />
        </button>
        <button
          className={styles.zOrderButton}
          onClick={() => handleZOrder('moveUp')}
          title="Move up"
          aria-label="Move up one layer"
          disabled={allFrames}
        >
          <MoveUpIcon />
        </button>
        <button
          className={styles.zOrderButton}
          onClick={() => handleZOrder('bringToFront')}
          title="Bring to front"
          aria-label="Bring to front"
          disabled={allFrames}
        >
          <BringToFrontIcon />
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Z-Order SVG Icons
// ============================================================

/** Down arrow with underline — "send to back" */
function SendToBackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M12 4v12" />
      <path d="M7 11l5 5 5-5" />
      <line x1="6" y1="20" x2="18" y2="20" />
    </svg>
  );
}

/** Down arrow — "move one layer down" */
function MoveDownIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M12 4v14" />
      <path d="M7 13l5 5 5-5" />
    </svg>
  );
}

/** Up arrow — "move one layer up" */
function MoveUpIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M12 20V6" />
      <path d="M7 11l5-5 5 5" />
    </svg>
  );
}

/** Up arrow with overline — "bring to front" */
function BringToFrontIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="6" y1="4" x2="18" y2="4" />
      <path d="M12 20V8" />
      <path d="M7 13l5-5 5 5" />
    </svg>
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

