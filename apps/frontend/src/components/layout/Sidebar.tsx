import { fabric } from 'fabric';
import { useUIStore, Tool, type ShapeTool } from '../../stores/uiStore';
import { useBoardStore } from '../../stores/boardStore';
import { ColorPicker } from '../canvas/ColorPicker';
import { ToolOptionsPanel } from '../toolbar/ToolOptionsPanel';
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
/** Shape tool names used to highlight the Shape button when any shape sub-tool is active. */
const SHAPE_TOOLS = new Set<Tool>(['rectangle', 'circle', 'triangle', 'star', 'arrow']);

export function Sidebar() {
  const activeTool = useUIStore((s) => s.activeTool);
  const setActiveTool = useUIStore((s) => s.setActiveTool);
  const activeShapeTool = useUIStore((s) => s.activeShapeTool);
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
              shortcut="V"
              tool="select"
              activeTool={activeTool}
              onClick={setActiveTool}
            />
            <ToolButton
              icon={<DropperIcon />}
              label="Color Picker (I)"
              shortcut="I"
              tool="dropper"
              activeTool={activeTool}
              onClick={setActiveTool}
            />
          </div>

          {/* --- Object Creation (2-column grid) --- */}
          <div className={styles.toolGroup}>
            <div className={styles.toolGrid}>
              <DraggableToolButton
                icon={<StickyIcon />}
                label="Sticky Note (S)"
                shortcut="S"
                tool="sticky"
                activeTool={activeTool}
                onClick={setActiveTool}
                onDragStart={(e) => handleDragStart(e, 'sticky')}
              />
              <DraggableToolButton
                icon={<RectangleIcon />}
                label="Shape (R)"
                shortcut="R"
                tool={activeShapeTool}
                activeTool={activeTool}
                isActive={SHAPE_TOOLS.has(activeTool)}
                onClick={() => setActiveTool(activeShapeTool)}
                onDragStart={(e) => handleDragStart(e, activeShapeTool)}
              />
              <DraggableToolButton
                icon={<TextIcon />}
                label="Text (T)"
                shortcut="T"
                tool="text"
                activeTool={activeTool}
                onClick={setActiveTool}
                onDragStart={(e) => handleDragStart(e, 'text')}
              />
              <DraggableToolButton
                icon={<FrameIcon />}
                label="Frame (F)"
                shortcut="F"
                tool="frame"
                activeTool={activeTool}
                onClick={setActiveTool}
                onDragStart={(e) => handleDragStart(e, 'frame')}
              />
              <DraggableToolButton
                icon={<LineIcon />}
                label="Line (N)"
                shortcut="N"
                tool="line"
                activeTool={activeTool}
                onClick={setActiveTool}
                onDragStart={(e) => handleDragStart(e, 'line')}
              />
              <DraggableToolButton
                icon={<ConnectorIcon />}
                label="Connector (L)"
                shortcut="L"
                tool="connector"
                activeTool={activeTool}
                onClick={setActiveTool}
                onDragStart={(e) => handleDragStart(e, 'connector')}
              />
            </div>
          </div>

          {/* --- Color Picker --- */}
          <div className={styles.toolGroup}>
            <ColorPicker />
          </div>

          {/* --- Contextual Tool Options (Line/Text panels) --- */}
          <ToolOptionsPanel />

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
  shortcut?: string;
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
      {props.shortcut && (
        <span className={styles.shortcutLabel}>({props.shortcut})</span>
      )}
    </button>
  );
}

function DraggableToolButton(props: {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  tool: Tool;
  activeTool: Tool;
  isActive?: boolean;
  onClick: ((tool: Tool) => void) | (() => void);
  onDragStart: (e: React.DragEvent) => void;
}) {
  const isActive = props.isActive ?? (props.tool === props.activeTool);
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
      {props.shortcut && (
        <span className={styles.shortcutLabel}>({props.shortcut})</span>
      )}
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

/** Thick directional arrow shape (polygon) */
function ArrowShapeIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
    >
      <polygon points="2,10 14,10 14,5 22,12 14,19 14,14 2,14" />
    </svg>
  );
}

/** Five-point star */
function StarIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
    >
      <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
    </svg>
  );
}

/** Plain diagonal line (no arrowhead — styling handled by Line options panel) */
function LineIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <line x1="5" y1="19" x2="19" y2="5" />
    </svg>
  );
}

/** Chainlink — two interlocking oval links */
function ConnectorIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      {/* Left half-link (open at right) */}
      <path d="M8 8H6a4 4 0 0 0 0 8h2" />
      {/* Right half-link (open at left) */}
      <path d="M16 8h2a4 4 0 0 1 0 8h-2" />
      {/* Center connecting bar */}
      <line x1="8" y1="12" x2="16" y2="12" />
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

