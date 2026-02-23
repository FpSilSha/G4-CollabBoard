import { fabric } from 'fabric';
import { generateLocalId } from './idGenerator';
import { hexToRgba } from './fabricStyleHelpers';

// ============================================================
// Frame Factory
// ============================================================

/**
 * Creates a Fabric.js Group representing a frame (grouping container).
 *
 * The frame is a dashed-border rectangle with a title label at the top-left.
 * Frames are visual containers — they don't actually Fabric-group children.
 * Objects can be placed inside the frame area visually, but the frame itself
 * is just a labeled rectangle.
 */
export function createFrame(options: {
  x: number;
  y: number;
  title?: string;
  width?: number;
  height?: number;
  color?: string;
  locked?: boolean;
  id?: string;
}): fabric.Group {
  const id = options.id ?? generateLocalId();
  const w = options.width ?? 400;
  const h = options.height ?? 300;
  const color = options.color ?? '#555555';
  const locked = options.locked ?? false;

  // Dashed-border rectangle with translucent tint matching frame color
  const border = new fabric.Rect({
    width: w,
    height: h,
    fill: hexToRgba(color, 0.06),
    stroke: color,
    strokeWidth: 2,
    strokeDashArray: [8, 4],
    rx: 4,
    ry: 4,
  });

  // Title label at top-left inside the frame
  const titleText = options.title ?? 'Frame';
  const label = new fabric.Text(titleText, {
    left: 8,
    top: -20,
    fontSize: 13,
    fill: '#ffffff',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    selectable: false,
    evented: false,
  });

  // Dark background behind the title for readability (consistent across all frame colors)
  const labelPadH = 6;
  const labelPadV = 2;
  const labelBg = new fabric.Rect({
    left: 8 - labelPadH,
    top: -20 - labelPadV,
    width: label.width! + labelPadH * 2,
    height: (label.height ?? 16) + labelPadV * 2,
    fill: 'rgba(0, 0, 0, 0.6)',
    rx: 3,
    ry: 3,
    selectable: false,
    evented: false,
  });

  const group = new fabric.Group([border, labelBg, label], {
    left: options.x,
    top: options.y,
    subTargetCheck: false,
    data: {
      id,
      type: 'frame',
      title: options.title ?? 'Frame',
      locked,
    },
  });

  // Add lock and edit custom controls (visible only when selected)
  setupFrameControls(group);

  return group;
}

/**
 * Checks whether an object's bounding box is completely inside a frame's
 * bounding box. Uses fast AABB comparison on the rendered (scaled) bounds.
 */
export function isObjectInsideFrame(
  obj: fabric.Object,
  frame: fabric.Group
): boolean {
  const objBounds = obj.getBoundingRect(true, true);
  const frameBounds = frame.getBoundingRect(true, true);

  return (
    objBounds.left >= frameBounds.left &&
    objBounds.top >= frameBounds.top &&
    objBounds.left + objBounds.width <= frameBounds.left + frameBounds.width &&
    objBounds.top + objBounds.height <= frameBounds.top + frameBounds.height
  );
}

/**
 * Check if a frame already has frame children on the canvas.
 * Used to enforce one-level-deep nesting constraint.
 */
export function frameHasFrameChildren(canvas: fabric.Canvas, frameId: string): boolean {
  return canvas.getObjects().some(
    (o) => o.data?.type === 'frame' && o.data?.frameId === frameId
  );
}

/**
 * Check if a fabric object is a frame that is already a child of another frame.
 */
export function isFrameChild(obj: fabric.Object): boolean {
  return obj.data?.type === 'frame' && !!obj.data?.frameId;
}

/**
 * Find all objects inside a frame that qualify for anchoring:
 * - Completely within frame bounds
 * - Higher z-index than the frame (rendered in front)
 * - Not a connector (connectors follow endpoint logic)
 * - Frames allowed only when allowFrames=true and nesting validation passes
 */
export function getObjectsInsideFrame(
  canvas: fabric.Canvas,
  frame: fabric.Group,
  allowFrames?: boolean
): fabric.Object[] {
  const allObjects = canvas.getObjects();
  const frameId = frame.data?.id;

  // A child frame cannot adopt other frames
  const parentIsChild = isFrameChild(frame);

  const result: fabric.Object[] = [];
  for (const obj of allObjects) {
    if (obj === frame) continue; // skip self
    if (!obj.data?.id) continue;
    if (obj.data.type === 'connector') continue;
    if (obj.data.type === 'frame') {
      if (!allowFrames || parentIsChild) continue;
      // Skip if inner frame is already a child of a DIFFERENT frame
      if (obj.data.frameId && obj.data.frameId !== frameId) continue;
    }
    if (isObjectInsideFrame(obj, frame)) {
      result.push(obj);
    }
  }
  return result;
}

/**
 * Sets up custom Fabric.js controls on a frame group:
 * - Lock toggle (padlock icon) at the top-right corner
 * - Edit title (pencil icon) next to the title label
 *
 * Controls are only rendered when the frame is selected (Fabric.js default).
 */
function setupFrameControls(group: fabric.Group): void {
  const controlRadius = 10;

  // Clone the controls object so frame-specific controls don't leak to the
  // prototype and appear on every fabric.Group instance (e.g. sticky notes).
  group.controls = { ...group.controls };

  /**
   * Position handler factory for frame title controls.
   * Places the control next to the title label (objects[2]) rather than
   * at the bounding box corners. `indexFromLabelEnd` controls which
   * position: 0 = first button right of the label, 1 = second button, etc.
   */
  const makeTitlePositionHandler = (indexFromLabelEnd: number) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return function (_dim: any, finalMatrix: any, fabricObj: any) {
      const grp = fabricObj as fabric.Group;

      // Guard: if the group isn't on a canvas yet (e.g. during multi-select
      // ActiveSelection rendering), fall back to the default finalMatrix center.
      if (!grp.canvas || !grp.canvas.viewportTransform) {
        return fabric.util.transformPoint(
          new fabric.Point(0, 0),
          finalMatrix
        );
      }

      const objects = grp.getObjects();
      // Guard: ensure we have the expected child structure [border, labelBg, label]
      if (objects.length < 3) {
        return fabric.util.transformPoint(
          new fabric.Point(0, 0),
          finalMatrix
        );
      }

      const label = objects[2] as fabric.Text;

      // Label's local coords relative to group center
      const labelLeft = label.left ?? 8;
      const labelTop = label.top ?? -20;
      const labelWidth = label.width ?? 40;
      const labelHeight = label.height ?? 16;

      // Position: just to the right of the label, vertically centered
      const gap = 6;
      const localX = labelLeft + labelWidth + gap + indexFromLabelEnd * (controlRadius * 2 + 4) + controlRadius;
      const localY = labelTop + labelHeight / 2;

      // Transform from group-local to screen coordinates
      const objectMatrix = grp.calcTransformMatrix();
      const viewportMatrix = grp.canvas.viewportTransform;
      const totalMatrix = fabric.util.multiplyTransformMatrices(viewportMatrix, objectMatrix);
      return fabric.util.transformPoint(new fabric.Point(localX, localY), totalMatrix);
    };
  };

  // Edit title control — first button to the right of the title label
  group.controls.editTitle = new fabric.Control({
    x: 0, // ignored — positionHandler overrides
    y: 0,
    sizeX: controlRadius * 2,
    sizeY: controlRadius * 2,
    cursorStyle: 'pointer',
    positionHandler: makeTitlePositionHandler(0),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    actionName: 'editTitle' as any,
    render: (ctx, left, top) => {
      ctx.save();
      ctx.translate(left, top);

      // Background circle
      ctx.beginPath();
      ctx.arc(0, 0, controlRadius, 0, Math.PI * 2);
      ctx.fillStyle = '#222222';
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Pencil icon (simplified)
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';

      // Pencil body (diagonal line)
      ctx.beginPath();
      ctx.moveTo(-4, 4);
      ctx.lineTo(3, -3);
      ctx.stroke();

      // Pencil tip
      ctx.beginPath();
      ctx.moveTo(-4, 4);
      ctx.lineTo(-5, 5);
      ctx.stroke();

      // Pencil top
      ctx.beginPath();
      ctx.moveTo(3, -3);
      ctx.lineTo(5, -5);
      ctx.stroke();

      ctx.restore();
    },
    actionHandler: () => false, // placeholder — overridden at setup time
  });

  // Lock control — second button to the right of the title label
  group.controls.lockToggle = new fabric.Control({
    x: 0, // ignored — positionHandler overrides
    y: 0,
    sizeX: controlRadius * 2,
    sizeY: controlRadius * 2,
    cursorStyle: 'pointer',
    positionHandler: makeTitlePositionHandler(1),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    actionName: 'lockToggle' as any,
    render: (ctx, left, top, _styleOverride, fabricObj) => {
      const isLocked = fabricObj.data?.locked ?? false;
      ctx.save();
      ctx.translate(left, top);

      // Background circle
      ctx.beginPath();
      ctx.arc(0, 0, controlRadius, 0, Math.PI * 2);
      ctx.fillStyle = isLocked ? '#4CAF50' : '#222222';
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      if (isLocked) {
        // ---- CLOSED LOCK ----
        // Lock body (rounded rect)
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.roundRect(-4, 0, 8, 6, 1);
        ctx.fill();

        // Closed shackle — centered arc sitting on top of the body
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(0, 0, 3.5, Math.PI, 0);
        ctx.stroke();

        // Keyhole dot
        ctx.fillStyle = '#4CAF50';
        ctx.beginPath();
        ctx.arc(0, 3, 1.2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // ---- OPEN LOCK ----
        // Lock body (rounded rect)
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.roundRect(-4, 1, 8, 6, 1);
        ctx.fill();

        // Open shackle — shifted up and to the right, not connected to body
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(2, -2, 3.5, Math.PI, -0.15);
        ctx.stroke();

        // Keyhole dot
        ctx.fillStyle = '#222222';
        ctx.beginPath();
        ctx.arc(0, 4, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    },
    // Action handler is wired externally in useCanvas — the control click
    // needs access to canvas + socket for emitting updates
    actionHandler: () => false, // placeholder — overridden at setup time
  });

  // Hide the rotation control for frames — not needed
  group.setControlVisible('mtr', false);
}
