import { fabric } from 'fabric';
import {
  STICKY_NOTE_COLORS,
  SHAPE_COLORS,
  OBJECT_DEFAULTS,
} from 'shared';
import type { BoardObject } from 'shared';
import { generateLocalId } from './idGenerator';

// ============================================================
// Sticky Note Factory (Group-based)
// ============================================================

/**
 * Creates a Fabric.js Group representing a sticky note.
 *
 * The Group consists of three parts:
 * 1. Base: A Polygon shaped like a square with the bottom-right corner
 *    clipped off — creates the classic folded sticky note silhouette.
 * 2. Fold: A darker triangle placed exactly in the clipped corner.
 * 3. Text: A fabric.Text centered inside the group for display.
 *
 * Text editing is handled externally via double-click DOM textarea overlay.
 * The text content is stored in group.data.text.
 *
 * The data.id is applied to the entire Group so it syncs as one unit.
 */
export function createStickyNote(options: {
  x: number;
  y: number;
  color?: string;
  text?: string;
  id?: string;
}): fabric.Group {
  const id = options.id ?? generateLocalId();
  const color = options.color ?? STICKY_NOTE_COLORS[0];
  const w = OBJECT_DEFAULTS.STICKY_WIDTH;
  const h = OBJECT_DEFAULTS.STICKY_HEIGHT;
  const foldSize = 24;
  const padding = OBJECT_DEFAULTS.STICKY_PADDING;

  // 1. Base polygon: square with bottom-right corner clipped
  // Points relative to (0,0) origin of the group
  const base = new fabric.Polygon(
    [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h - foldSize },
      { x: w - foldSize, y: h },
      { x: 0, y: h },
    ],
    {
      fill: color,
      stroke: '#000000',
      strokeWidth: 1,
      strokeLineJoin: 'round',
    }
  );

  // 2. Fold triangle: placed in the clipped corner, darker shade
  const fold = new fabric.Polygon(
    [
      { x: w, y: h - foldSize },
      { x: w - foldSize, y: h - foldSize },
      { x: w - foldSize, y: h },
    ],
    {
      fill: darkenColor(color, 15),
      stroke: '#000000',
      strokeWidth: 1,
      strokeLineJoin: 'round',
    }
  );

  // 3. Text display inside the sticky
  const textObj = new fabric.Text(options.text ?? '', {
    left: padding,
    top: padding,
    fontSize: OBJECT_DEFAULTS.STICKY_FONT_SIZE,
    fill: '#000000',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    selectable: false,
    evented: false,
  });

  // Build the group
  const group = new fabric.Group([base, fold, textObj], {
    left: options.x,
    top: options.y,
    // Layered shadow for the 'lift' effect
    shadow: new fabric.Shadow({
      color: 'rgba(0,0,0,0.18)',
      blur: 12,
      offsetX: 2,
      offsetY: 4,
    }),
    subTargetCheck: false,
    // Disable scaling — sticky notes are fixed 200x200.
    // Prevents stretch desync between users (child polygons don't resize
    // with the group). Resizable stickies will be revisited as a design task.
    lockScalingX: true,
    lockScalingY: true,
    hasControls: false,
    // Data applied to the entire group — syncs as one unit
    data: {
      id,
      type: 'sticky',
      text: options.text ?? '',
    },
  });

  return group;
}

/**
 * Extract the visual fill color from any supported Fabric.js object.
 * Used by selection glow to match the aura color to the object's color.
 *
 * - Sticky group: reads base polygon fill
 * - Shape (rect/circle): reads obj.fill
 * - Fallback: Focus Blue (#007AFF)
 */
export function getObjectFillColor(obj: fabric.Object): string {
  if (obj.data?.type === 'sticky' && obj instanceof fabric.Group) {
    const { base } = getStickyChildren(obj);
    return (base.fill as string) ?? '#007AFF';
  }
  if (obj.data?.type === 'frame' && obj instanceof fabric.Group) {
    // Frame: use the border color from the child rect's stroke
    const borderRect = obj.getObjects()[0] as fabric.Rect;
    return (borderRect.stroke as string) ?? '#555555';
  }
  if (obj.data?.type === 'connector') {
    return (obj.stroke as string) ?? '#FFFFFF';
  }
  if (obj.fill && typeof obj.fill === 'string') {
    return obj.fill;
  }
  return '#007AFF';
}

/**
 * Helper: get the child objects of a sticky group by role.
 * Index 0 = base polygon, 1 = fold polygon, 2 = text object.
 */
export function getStickyChildren(group: fabric.Group): {
  base: fabric.Polygon;
  fold: fabric.Polygon;
  text: fabric.Text;
} {
  const objects = group.getObjects();
  return {
    base: objects[0] as fabric.Polygon,
    fold: objects[1] as fabric.Polygon,
    text: objects[2] as fabric.Text,
  };
}

/**
 * Update the fill color of a sticky note group.
 * Updates both the base polygon and the fold (darkened).
 */
export function updateStickyColor(group: fabric.Group, newColor: string): void {
  const { base, fold } = getStickyChildren(group);
  base.set('fill', newColor);
  fold.set('fill', darkenColor(newColor, 15));
}

/**
 * Update the color of a frame group.
 * Updates both the border rectangle's stroke and the title label's fill.
 */
export function updateFrameColor(group: fabric.Group, newColor: string): void {
  const objects = group.getObjects();
  const borderRect = objects[0] as fabric.Rect;
  // objects[1] = labelBg (background rect), objects[2] = label text
  const label = objects[2] as fabric.Text;
  borderRect.set('stroke', newColor);
  label.set('fill', newColor);
}

// ============================================================
// Shape Factories
// ============================================================

/**
 * Creates a Fabric.js Rect representing a rectangle shape.
 */
export function createRectangle(options: {
  x: number;
  y: number;
  color?: string;
  width?: number;
  height?: number;
  id?: string;
}): fabric.Rect {
  const id = options.id ?? generateLocalId();
  return new fabric.Rect({
    left: options.x,
    top: options.y,
    width: options.width ?? OBJECT_DEFAULTS.SHAPE_WIDTH,
    height: options.height ?? OBJECT_DEFAULTS.SHAPE_HEIGHT,
    fill: options.color ?? SHAPE_COLORS[0],
    stroke: '#000000',
    strokeWidth: 1,
    rx: 0,
    ry: 0,
    data: {
      id,
      type: 'shape',
      shapeType: 'rectangle',
    },
  });
}

/**
 * Creates a Fabric.js Circle.
 */
export function createCircle(options: {
  x: number;
  y: number;
  color?: string;
  radius?: number;
  id?: string;
}): fabric.Circle {
  const id = options.id ?? generateLocalId();
  const radius = options.radius ?? OBJECT_DEFAULTS.SHAPE_HEIGHT / 2;
  return new fabric.Circle({
    left: options.x,
    top: options.y,
    radius,
    fill: options.color ?? SHAPE_COLORS[0],
    stroke: '#000000',
    strokeWidth: 1,
    data: {
      id,
      type: 'shape',
      shapeType: 'circle',
    },
  });
}

// ============================================================
// Text Element Factory
// ============================================================

/**
 * Creates a Fabric.js IText for a standalone text element.
 * IText supports inline editing (double-click to enter edit mode).
 */
export function createTextElement(options: {
  x: number;
  y: number;
  text?: string;
  fontSize?: number;
  color?: string;
  id?: string;
}): fabric.IText {
  const id = options.id ?? generateLocalId();
  const textObj = new fabric.IText(options.text ?? 'Text', {
    left: options.x,
    top: options.y,
    fontSize: options.fontSize ?? 24,
    fill: options.color ?? '#000000',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    lockUniScaling: true,
    data: {
      id,
      type: 'text',
    },
  });

  // Corner-only resize: hide middle (side) handles so aspect ratio is always preserved
  textObj.setControlsVisibility({
    mt: false, // middle-top
    mb: false, // middle-bottom
    ml: false, // middle-left
    mr: false, // middle-right
  });

  return textObj;
}

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

  // Dashed-border rectangle background
  const border = new fabric.Rect({
    width: w,
    height: h,
    fill: 'rgba(0, 0, 0, 0.02)',
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
    fill: color,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    selectable: false,
    evented: false,
  });

  // Semi-opaque background behind the title for readability
  const labelPadH = 6;
  const labelPadV = 2;
  const labelBg = new fabric.Rect({
    left: 8 - labelPadH,
    top: -20 - labelPadV,
    width: label.width! + labelPadH * 2,
    height: (label.height ?? 16) + labelPadV * 2,
    fill: 'rgba(0, 0, 0, 0.06)',
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
 * Find all objects inside a frame that qualify for anchoring:
 * - Completely within frame bounds
 * - Higher z-index than the frame (rendered in front)
 * - Not a connector (connectors follow endpoint logic)
 * - Not another frame (no nesting)
 */
export function getObjectsInsideFrame(
  canvas: fabric.Canvas,
  frame: fabric.Group
): fabric.Object[] {
  const allObjects = canvas.getObjects();
  const frameIndex = allObjects.indexOf(frame);
  if (frameIndex === -1) return [];

  const result: fabric.Object[] = [];
  for (let i = frameIndex + 1; i < allObjects.length; i++) {
    const obj = allObjects[i];
    if (!obj.data?.id) continue;
    if (obj.data.type === 'connector') continue;
    if (obj.data.type === 'frame') continue;
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

// ============================================================
// Connector Factory
// ============================================================

/**
 * Creates a Fabric.js Line representing a connector.
 *
 * Accepts start (x, y) and end (x2, y2) coordinates.
 * If x2/y2 are not provided, defaults to a 200px horizontal line.
 */
export function createConnector(options: {
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  color?: string;
  style?: 'line' | 'arrow';
  fromObjectId?: string;
  toObjectId?: string;
  id?: string;
}): fabric.Line {
  const id = options.id ?? generateLocalId();
  const color = options.color ?? '#FFFFFF';

  const x1 = options.x;
  const y1 = options.y;
  const x2 = options.x2 ?? (options.x + 200);
  const y2 = options.y2 ?? options.y;

  const line = new fabric.Line(
    [x1, y1, x2, y2],
    {
      stroke: color,
      strokeWidth: 2,
      fill: '',
      // Disable default resize/rotate controls — we use custom endpoint controls
      hasBorders: false,
      lockScalingX: true,
      lockScalingY: true,
      data: {
        id,
        type: 'connector',
        style: options.style ?? 'line',
        fromObjectId: options.fromObjectId ?? '',
        toObjectId: options.toObjectId ?? '',
      },
    }
  );

  // Add custom endpoint controls for dragging each end independently
  setupConnectorEndpointControls(line);

  // For arrow style, override _render to draw an arrowhead at p2
  if ((options.style ?? 'line') === 'arrow') {
    setupArrowheadRender(line);
  }

  return line;
}

/**
 * After a connector line is moved (dragged by body), x1/y1/x2/y2 become
 * stale because Fabric.js only updates left/top on move. We must sync
 * the endpoint coordinates so custom controls and serialization stay correct.
 *
 * Called from useCanvasSync / useCanvas on `object:modified` for connectors.
 */
export function syncConnectorCoordsAfterMove(line: fabric.Line): void {
  // Fabric.js Line: left = min(x1,x2), top = min(y1,y2) at creation.
  // After a move, left/top changed but x1/y1/x2/y2 are still the original values.
  // Compute the delta between the stale computed-left and the actual left.
  const staleLeft = Math.min(line.x1 ?? 0, line.x2 ?? 0);
  const staleTop = Math.min(line.y1 ?? 0, line.y2 ?? 0);
  const dx = (line.left ?? 0) - staleLeft;
  const dy = (line.top ?? 0) - staleTop;

  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return;

  // Update x1/y1/x2/y2 to match the new position.
  // Use direct property assignment to avoid _setWidthHeight recalculation loop.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lineAny = line as any;
  lineAny.x1 = (line.x1 ?? 0) + dx;
  lineAny.y1 = (line.y1 ?? 0) + dy;
  lineAny.x2 = (line.x2 ?? 0) + dx;
  lineAny.y2 = (line.y2 ?? 0) + dy;
  line.setCoords();
}

/**
 * Override the Line's _render to also draw an arrowhead triangle at p2.
 * The arrowhead is drawn in the line's local coordinate space.
 */
function setupArrowheadRender(line: fabric.Line): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalRender = (line as any)._render.bind(line);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (line as any)._render = function (ctx: CanvasRenderingContext2D) {
    // Draw the original line
    originalRender(ctx);

    // Now draw the arrowhead at the p2 end
    // In Line's local space, endpoints are center-relative:
    //   p1 local = calcLinePoints().x1, .y1
    //   p2 local = calcLinePoints().x2, .y2
    const pts = this.calcLinePoints();
    const p1x = pts.x1;
    const p1y = pts.y1;
    const p2x = pts.x2;
    const p2y = pts.y2;

    const angle = Math.atan2(p2y - p1y, p2x - p1x);
    const headLength = 12;

    ctx.save();
    ctx.translate(p2x, p2y);
    ctx.rotate(angle);

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-headLength, -headLength * 0.4);
    ctx.lineTo(-headLength, headLength * 0.4);
    ctx.closePath();
    ctx.fillStyle = this.stroke || '#FFFFFF';
    ctx.fill();
    ctx.restore();
  };

  // Disable Fabric.js object caching so the arrowhead always re-renders
  line.objectCaching = false;
}

/**
 * Adds custom Fabric.js controls to a connector line so the user can
 * grab either endpoint and drag it independently while the other stays fixed.
 *
 * Two controls are created:
 *   p1 — positioned at the start point (x1, y1)
 *   p2 — positioned at the end point (x2, y2)
 *
 * positionHandler uses calcLinePoints() to get center-relative coords, then
 * transforms through calcTransformMatrix() * viewportTransform to get the
 * correct screen position. This is robust across pans, zooms, and moves.
 *
 * actionHandler receives (x, y) in canvas coordinates and sets x1/y1 or
 * x2/y2 directly. Fabric's Line._set automatically recalculates left/top.
 */
function setupConnectorEndpointControls(line: fabric.Line): void {
  const endpointRadius = 7;

  // Renderer: white-filled circle with dark border (endpoint handle)
  const renderEndpoint = (
    ctx: CanvasRenderingContext2D,
    left: number,
    top: number
  ) => {
    ctx.save();
    ctx.translate(left, top);
    ctx.beginPath();
    ctx.arc(0, 0, endpointRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.strokeStyle = '#222222';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  };

  // Position handler: uses calcLinePoints() for center-relative local coords,
  // then transforms to screen space via calcTransformMatrix + viewportTransform.
  // This is the recommended approach from Fabric.js docs and avoids relying
  // on the finalMatrix parameter which doesn't account for Line internals.
  const makePositionHandler = (endpoint: 'p1' | 'p2') => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return function (_dim: any, finalMatrix: any, fabricObj: any) {
      const lineObj = fabricObj as fabric.Line;

      // Guard: if this control is rendered on a non-Line object (e.g. during
      // multi-select ActiveSelection), fall back to the finalMatrix center.
      if (typeof lineObj.calcLinePoints !== 'function') {
        return fabric.util.transformPoint(
          new fabric.Point(0, 0),
          finalMatrix
        );
      }

      // calcLinePoints() returns center-relative coords:
      // {x1: +/-width/2, y1: +/-height/2, x2: -/+width/2, y2: -/+height/2}
      const pts = lineObj.calcLinePoints();
      const pt = endpoint === 'p1'
        ? new fabric.Point(pts.x1, pts.y1)
        : new fabric.Point(pts.x2, pts.y2);

      // Transform from object-local space → canvas space → screen space
      const objectMatrix = lineObj.calcTransformMatrix();
      const viewportMatrix = lineObj.canvas!.viewportTransform!;
      const totalMatrix = fabric.util.multiplyTransformMatrices(
        viewportMatrix, objectMatrix
      );
      return fabric.util.transformPoint(pt, totalMatrix);
    };
  };

  // Action handler: x, y are in canvas coordinates (from Fabric.js).
  // Set the endpoint directly. Fabric's Line._set override will
  // recalculate left/top/width/height automatically.
  const makeActionHandler = (endpoint: 'p1' | 'p2') => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return function (_eventData: any, transform: any, x: number, y: number) {
      const lineObj = transform.target as fabric.Line;
      // Guard: only modify if this is actually a Line (not an ActiveSelection)
      if (typeof lineObj.calcLinePoints !== 'function') return false;
      if (endpoint === 'p1') {
        lineObj.set({ x1: x, y1: y });
      } else {
        lineObj.set({ x2: x, y2: y });
      }
      return true;
    };
  };

  // P1 control (start point)
  line.controls.p1 = new fabric.Control({
    positionHandler: makePositionHandler('p1'),
    actionHandler: makeActionHandler('p1'),
    cursorStyle: 'crosshair',
    render: renderEndpoint,
    sizeX: endpointRadius * 2,
    sizeY: endpointRadius * 2,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    actionName: 'modifyLine' as any,
  });

  // P2 control (end point)
  line.controls.p2 = new fabric.Control({
    positionHandler: makePositionHandler('p2'),
    actionHandler: makeActionHandler('p2'),
    cursorStyle: 'crosshair',
    render: renderEndpoint,
    sizeX: endpointRadius * 2,
    sizeY: endpointRadius * 2,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    actionName: 'modifyLine' as any,
  });

  // Hide all default controls — only show our custom endpoint controls
  const defaultControls = ['tl', 'tr', 'bl', 'br', 'ml', 'mr', 'mt', 'mb', 'mtr'];
  for (const key of defaultControls) {
    line.setControlVisible(key, false);
  }
}

// ============================================================
// Lookup Helper
// ============================================================

/**
 * Find a Fabric.js canvas object by its data.id.
 * Per .clauderules: never look up by array index, always by data.id.
 */
export function findFabricObjectById(
  canvas: fabric.Canvas,
  objectId: string
): fabric.Object | undefined {
  return canvas.getObjects().find((obj: fabric.Object) => obj.data?.id === objectId);
}

// ============================================================
// Conversion: Fabric Object -> BoardObject (for store tracking)
// ============================================================

/**
 * Converts a Fabric.js object into a BoardObject suitable for
 * storing in the Zustand boardStore.
 *
 * Accepts an optional userId parameter for the authenticated user.
 * Falls back to 'local-user' if not provided (Phase 3 local-only mode).
 */
export function fabricToBoardObject(fabricObj: fabric.Object, userId?: string): BoardObject {
  const data = fabricObj.data!;
  const now = new Date();
  const user = userId ?? 'local-user';

  // Fabric.js uses scaleX/scaleY for resize, NOT width/height.
  // Multiply intrinsic dimensions by scale to get actual rendered size.
  const scaleX = fabricObj.scaleX ?? 1;
  const scaleY = fabricObj.scaleY ?? 1;

  const base = {
    id: data.id,
    x: fabricObj.left ?? 0,
    y: fabricObj.top ?? 0,
    frameId: (data.frameId as string | null) ?? null,
    createdBy: user,
    createdAt: now,
    updatedAt: now,
    lastEditedBy: user,
  };

  if (data.type === 'sticky') {
    // Sticky is now a Group — get color from child base polygon
    let color: string = STICKY_NOTE_COLORS[0];
    if (fabricObj instanceof fabric.Group) {
      const { base: basePoly } = getStickyChildren(fabricObj);
      color = basePoly.fill as string;
    }
    return {
      ...base,
      type: 'sticky' as const,
      text: data.text ?? '',
      color,
      width: (fabricObj.width ?? OBJECT_DEFAULTS.STICKY_WIDTH) * scaleX,
      height: (fabricObj.height ?? OBJECT_DEFAULTS.STICKY_HEIGHT) * scaleY,
    };
  }

  if (data.type === 'shape' && data.shapeType === 'circle') {
    const circle = fabricObj as fabric.Circle;
    const diameter = (circle.radius ?? 75) * 2 * scaleX;
    return {
      ...base,
      type: 'shape' as const,
      shapeType: 'circle' as const,
      width: diameter,
      height: diameter,
      color: circle.fill as string,
      rotation: fabricObj.angle ?? 0,
    };
  }

  if (data.type === 'text') {
    const itext = fabricObj as fabric.IText;
    return {
      ...base,
      type: 'text' as const,
      text: itext.text ?? '',
      fontSize: itext.fontSize ?? 24,
      color: (itext.fill as string) ?? '#000000',
      rotation: fabricObj.angle ?? 0,
      scaleX: scaleX !== 1 ? scaleX : undefined,
      scaleY: scaleY !== 1 ? scaleY : undefined,
    };
  }

  if (data.type === 'frame') {
    // Frame color is stored as the child rect's stroke color
    let frameColor = '#555555';
    if (fabricObj instanceof fabric.Group) {
      const borderRect = fabricObj.getObjects()[0];
      frameColor = (borderRect.stroke as string) ?? '#555555';
    }
    return {
      ...base,
      type: 'frame' as const,
      title: data.title ?? 'Frame',
      width: (fabricObj.width ?? 400) * scaleX,
      height: (fabricObj.height ?? 300) * scaleY,
      color: frameColor,
      locked: data.locked ?? false,
    };
  }

  if (data.type === 'connector') {
    const line = fabricObj as fabric.Line;
    // Connector x/y must be the FIRST endpoint (x1/y1), NOT left/top.
    // left/top = min(x1,x2)/min(y1,y2) which loses orientation info.
    // createConnector treats options.x/y as x1/y1, so we must serialize
    // the actual first endpoint to preserve the line's direction.
    return {
      ...base,
      x: line.x1 ?? 0,
      y: line.y1 ?? 0,
      type: 'connector' as const,
      fromObjectId: data.fromObjectId ?? '',
      toObjectId: data.toObjectId ?? '',
      style: data.style ?? 'line',
      color: (line.stroke as string) ?? '#FFFFFF',
      x2: line.x2 ?? 0,
      y2: line.y2 ?? 0,
    };
  }

  // Default: rectangle shape
  return {
    ...base,
    type: 'shape' as const,
    shapeType: 'rectangle' as const,
    width: (fabricObj.width ?? OBJECT_DEFAULTS.SHAPE_WIDTH) * scaleX,
    height: (fabricObj.height ?? OBJECT_DEFAULTS.SHAPE_HEIGHT) * scaleY,
    color: (fabricObj as fabric.Rect).fill as string,
    rotation: fabricObj.angle ?? 0,
  };
}

// ============================================================
// Conversion: BoardObject -> Fabric Object (for rendering server state)
// ============================================================

/**
 * Converts a BoardObject (from server) into a Fabric.js object for rendering.
 * This is the reverse of fabricToBoardObject — used when loading board:state
 * or applying object:created events from other users.
 */
export function boardObjectToFabric(obj: BoardObject): fabric.Object | null {
  let fabricObj: fabric.Object | null = null;

  switch (obj.type) {
    case 'sticky':
      fabricObj = createStickyNote({
        x: obj.x,
        y: obj.y,
        color: obj.color,
        text: obj.text,
        id: obj.id,
      });
      break;

    case 'shape':
      if (obj.shapeType === 'circle') {
        const circle = createCircle({
          x: obj.x,
          y: obj.y,
          color: obj.color,
          radius: obj.width / 2,
          id: obj.id,
        });
        if (obj.rotation) circle.set('angle', obj.rotation);
        fabricObj = circle;
      } else if (obj.shapeType === 'rectangle') {
        const rect = createRectangle({
          x: obj.x,
          y: obj.y,
          color: obj.color,
          width: obj.width,
          height: obj.height,
          id: obj.id,
        });
        if (obj.rotation) rect.set('angle', obj.rotation);
        fabricObj = rect;
      }
      break;

    case 'text': {
      const textEl = createTextElement({
        x: obj.x,
        y: obj.y,
        text: obj.text,
        fontSize: obj.fontSize,
        color: obj.color,
        id: obj.id,
      });
      if (obj.rotation) textEl.set('angle', obj.rotation);
      // Restore resize scale (IText uses scaleX/Y, not width/height)
      if (obj.scaleX) textEl.set('scaleX', obj.scaleX);
      if (obj.scaleY) textEl.set('scaleY', obj.scaleY);
      fabricObj = textEl;
      break;
    }

    case 'frame':
      fabricObj = createFrame({
        x: obj.x,
        y: obj.y,
        title: obj.title,
        width: obj.width,
        height: obj.height,
        color: obj.color,
        locked: obj.locked,
        id: obj.id,
      });
      break;

    case 'connector':
      fabricObj = createConnector({
        x: obj.x,
        y: obj.y,
        x2: obj.x2,
        y2: obj.y2,
        color: obj.color,
        style: obj.style,
        fromObjectId: obj.fromObjectId,
        toObjectId: obj.toObjectId,
        id: obj.id,
      });
      break;
  }

  // Attach frameId to fabric data for all object types
  if (fabricObj && obj.frameId) {
    fabricObj.data = { ...fabricObj.data, frameId: obj.frameId };
  }

  return fabricObj;
}

/**
 * Darken a hex color by a percentage.
 * Used for the sticky note fold effect.
 */
export function darkenColor(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, ((num >> 16) & 0xff) - Math.round(2.55 * percent));
  const g = Math.max(0, ((num >> 8) & 0xff) - Math.round(2.55 * percent));
  const b = Math.max(0, (num & 0xff) - Math.round(2.55 * percent));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

// ============================================================
// Teleport Flags
// ============================================================

/** Default colors for flag pennants */
export const FLAG_COLORS = [
  '#E6194B', // Red
  '#3CB44B', // Green
  '#4363D8', // Blue
  '#FFE119', // Yellow
  '#F58231', // Orange
  '#911EB4', // Purple
  '#42D4F4', // Cyan
  '#F032E6', // Magenta
] as const;

/**
 * Teleport the viewport so that (x, y) is centered on screen.
 * Works at any zoom level.
 */
export function teleportTo(canvas: fabric.Canvas, x: number, y: number): void {
  const zoom = canvas.getZoom();
  const vpt = canvas.viewportTransform;
  if (!vpt) return;
  vpt[4] = canvas.getWidth() / 2 - x * zoom;
  vpt[5] = canvas.getHeight() / 2 - y * zoom;
  canvas.setViewportTransform(vpt);
  canvas.requestRenderAll();
}

/** Height of the flag pole (canvas units) */
const FLAG_POLE_HEIGHT = 40;

/**
 * Create a Fabric.js Group representing a teleport flag marker on the canvas.
 * The flag resembles a golf-course pin: thin dark pole, wavy pennant blowing
 * in the wind, and a 3D-looking hole at the base.
 *
 * The group's `data` property carries `{ flagId, type: 'teleportFlag' }`.
 * The group is selectable and moveable; on `object:modified` the caller
 * should persist the new position.
 */
export function createFlagMarker(options: {
  x: number;
  y: number;
  color: string;
  flagId: string;
  label: string;
}): fabric.Group {
  // Pole — thin dark vertical line
  const pole = new fabric.Line(
    [0, 0, 0, FLAG_POLE_HEIGHT],
    {
      stroke: '#555555',
      strokeWidth: 1.5,
      selectable: false,
      evented: false,
    },
  );

  // Wavy pennant — bezier path that gives a wind-blown ripple effect.
  // The left edge sits on the pole; the shape billows outward to the right.
  const pennant = new fabric.Path(
    'M 1.5 0 C 7 1, 14 -1, 18 1 C 16 4, 14 6, 18 10 C 12 9, 6 11, 1.5 10 Z',
    {
      fill: options.color,
      selectable: false,
      evented: false,
    },
  );

  // Base hole — dark ellipse so the flag looks planted in the ground
  const hole = new fabric.Ellipse({
    left: -4,
    top: FLAG_POLE_HEIGHT - 2,
    rx: 5,
    ry: 2.5,
    fill: '#111111',
    selectable: false,
    evented: false,
  });

  const group = new fabric.Group([hole, pole, pennant], {
    left: options.x,
    top: options.y,
    hasControls: false,
    hasBorders: false,
    borderColor: '#007AFF',
    lockScalingX: true,
    lockScalingY: true,
    lockRotation: true,
    shadow: undefined,
    data: {
      flagId: options.flagId,
      label: options.label,
      type: 'teleportFlag',
    },
  });

  return group;
}
