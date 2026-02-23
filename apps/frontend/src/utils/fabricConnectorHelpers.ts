import { fabric } from 'fabric';
import type { LineEndpointStyle, LineStrokePattern, LineStrokeWeight } from 'shared';
import { generateLocalId } from './idGenerator';

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
  fromAnchor?: { rx: number; ry: number } | null;
  toAnchor?: { rx: number; ry: number } | null;
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
        fromAnchor: options.fromAnchor ?? null,
        toAnchor: options.toAnchor ?? null,
      },
    }
  );

  // Add custom endpoint controls for dragging each end independently
  setupConnectorEndpointControls(line);

  // For arrow style, override _render to draw an arrowhead at p2
  if ((options.style ?? 'line') === 'arrow') {
    setupArrowheadRender(line);
  }

  // If the connector already has anchors (loaded from server), lock movement
  applyConnectorLockState(line);

  return line;
}

/**
 * Apply or remove movement locks on a connector based on its anchor state.
 * When any anchor is set, the connector becomes immovable — only the
 * attached objects' movement can reposition it. The lock button stays
 * visible so the user can unlock.
 */
export function applyConnectorLockState(line: fabric.Line): void {
  const hasAnyAnchor = !!(line.data?.fromAnchor || line.data?.toAnchor);

  if (hasAnyAnchor) {
    line.set({
      lockMovementX: true,
      lockMovementY: true,
    });
    line.setControlVisible('p1', false);
    line.setControlVisible('p2', false);
    line.setControlVisible('lockBtn', true);
  } else {
    line.set({
      lockMovementX: false,
      lockMovementY: false,
    });
    line.setControlVisible('p1', true);
    line.setControlVisible('p2', true);
    line.setControlVisible('lockBtn', true);
  }
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
  // Also clears any edge-lock attachment (drag = detach).
  const makeActionHandler = (endpoint: 'p1' | 'p2') => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return function (_eventData: any, transform: any, x: number, y: number) {
      const lineObj = transform.target as fabric.Line;
      // Guard: only modify if this is actually a Line (not an ActiveSelection)
      if (typeof lineObj.calcLinePoints !== 'function') return false;
      if (endpoint === 'p1') {
        lineObj.set({ x1: x, y1: y });
        // Detach from locked object when manually dragging
        if (lineObj.data) {
          lineObj.data.fromObjectId = '';
          lineObj.data.fromAnchor = null;
        }
      } else {
        lineObj.set({ x2: x, y2: y });
        if (lineObj.data) {
          lineObj.data.toObjectId = '';
          lineObj.data.toAnchor = null;
        }
      }
      return true;
    };
  };

  // --- Lock button at the connector midpoint ---
  const lockRadius = 10;

  // Position handler: midpoint of p1 and p2
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lockPositionHandler = (_dim: any, finalMatrix: any, fabricObj: any) => {
    const lineObj = fabricObj as fabric.Line;
    if (typeof lineObj.calcLinePoints !== 'function') {
      return fabric.util.transformPoint(new fabric.Point(0, 0), finalMatrix);
    }
    const pts = lineObj.calcLinePoints();
    const midX = (pts.x1 + pts.x2) / 2;
    const midY = (pts.y1 + pts.y2) / 2;

    const objectMatrix = lineObj.calcTransformMatrix();
    const viewportMatrix = lineObj.canvas!.viewportTransform!;
    const totalMatrix = fabric.util.multiplyTransformMatrices(viewportMatrix, objectMatrix);
    return fabric.util.transformPoint(new fabric.Point(midX, midY), totalMatrix);
  };

  // Render: padlock icon (green=locked, dark=unlocked)
  const renderLockButton = (
    ctx: CanvasRenderingContext2D,
    left: number,
    top: number,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _styleOverride: any,
    fabricObj: fabric.Object
  ) => {
    const hasAnchor = fabricObj.data?.fromAnchor || fabricObj.data?.toAnchor;
    ctx.save();
    ctx.translate(left, top);

    // Background circle
    ctx.beginPath();
    ctx.arc(0, 0, lockRadius, 0, Math.PI * 2);
    ctx.fillStyle = hasAnchor ? '#4CAF50' : '#222222';
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (hasAnchor) {
      // ---- CLOSED LOCK ----
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.roundRect(-4, 0, 8, 6, 1);
      ctx.fill();

      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, 0, 3.5, Math.PI, 0);
      ctx.stroke();

      ctx.fillStyle = '#4CAF50';
      ctx.beginPath();
      ctx.arc(0, 3, 1.2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // ---- OPEN LOCK ----
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.roundRect(-4, 1, 8, 6, 1);
      ctx.fill();

      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(2, -2, 3.5, Math.PI, -0.15);
      ctx.stroke();

      ctx.fillStyle = '#222222';
      ctx.beginPath();
      ctx.arc(0, 4, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  };

  // IMPORTANT: Create an instance-specific controls object.
  // Fabric.js shares `controls` via the prototype, so mutating it directly
  // would add lockBtn/p1/p2 to ALL objects (including shapes). Spread the
  // existing controls into a new object so only this connector gets them.
  line.controls = { ...line.controls };

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

  // Lock button at midpoint — action handler wired externally in useCanvas
  line.controls.lockBtn = new fabric.Control({
    positionHandler: lockPositionHandler,
    actionHandler: () => false, // placeholder — overridden at setup time
    cursorStyle: 'pointer',
    render: renderLockButton,
    sizeX: lockRadius * 2,
    sizeY: lockRadius * 2,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    actionName: 'lockToEdge' as any,
  });

  // Hide all default controls — only show our custom endpoint + lock controls
  const defaultControls = ['tl', 'tr', 'bl', 'br', 'ml', 'mr', 'mt', 'mb', 'mtr'];
  for (const key of defaultControls) {
    line.setControlVisible(key, false);
  }
}

// ============================================================
// Standalone Line Factory
// ============================================================

/**
 * Creates a Fabric.js Line representing a standalone line (NOT a connector).
 * Supports arrowheads at one or both ends, dashed pattern, and bold/double/triple stroke weight.
 * Double and triple lines are rendered as parallel strokes within a single Fabric.js object.
 */
export function createLine(options: {
  x: number;
  y: number;
  x2: number;
  y2: number;
  color?: string;
  endpointStyle?: LineEndpointStyle;
  strokePattern?: LineStrokePattern;
  strokeWeight?: LineStrokeWeight;
  id?: string;
}): fabric.Line {
  const id = options.id ?? generateLocalId();
  const color = options.color ?? '#FFFFFF';
  const endpointStyle = options.endpointStyle ?? 'none';
  const strokePattern = options.strokePattern ?? 'solid';
  const strokeWeight = options.strokeWeight ?? 'normal';

  const baseStrokeWidth = strokeWeight === 'bold' ? 4 : 2;

  // Padding around the selection border must encompass the parallel line offsets
  const selectionPadding = strokeWeight === 'triple' ? 14 : strokeWeight === 'double' ? 10 : 6;

  const line = new fabric.Line(
    [options.x, options.y, options.x2, options.y2],
    {
      stroke: color,
      strokeWidth: baseStrokeWidth,
      strokeDashArray: strokePattern === 'dashed' ? [12, 8] : undefined,
      fill: '',
      lockScalingX: true,
      lockScalingY: true,
      padding: selectionPadding,
      data: {
        id,
        type: 'line',
        endpointStyle,
        strokePattern,
        strokeWeight,
      },
    }
  );

  // Custom _render for arrowheads and double/triple strokes
  setupLineRender(line);

  // Add draggable endpoint controls (same pattern as connector, but no lock button)
  setupLineEndpointControls(line);

  return line;
}

/**
 * Override _render for standalone lines to support:
 * - Arrowheads at one or both endpoints (on ALL parallel lines for double/triple)
 * - Double/triple parallel lines with wider spacing
 * - Dynamic style reading from data (so style changes via options panel take effect)
 *
 * ALL rendering is done manually — we never call the original _render, because
 * Fabric.js's built-in line render doesn't update strokeWidth/strokeDashArray
 * when data changes at runtime. Instead, we always read from this.data and
 * draw everything ourselves.
 */
function setupLineRender(line: fabric.Line): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (line as any)._render = function (ctx: CanvasRenderingContext2D) {
    const data = this.data ?? {};
    const weight: LineStrokeWeight = data.strokeWeight ?? 'normal';
    const endpoint: LineEndpointStyle = data.endpointStyle ?? 'none';
    const pattern: LineStrokePattern = data.strokePattern ?? 'solid';

    const pts = this.calcLinePoints();
    const p1x = pts.x1;
    const p1y = pts.y1;
    const p2x = pts.x2;
    const p2y = pts.y2;

    const strokeColor = this.stroke || '#FFFFFF';
    // Determine per-strand width based on weight
    const strandWidth = weight === 'bold' ? 4 : 2;

    // Calculate perpendicular offset direction for parallel lines
    const lineAngle = Math.atan2(p2y - p1y, p2x - p1x);
    const perpX = -Math.sin(lineAngle);
    const perpY = Math.cos(lineAngle);

    // Determine which offsets to use based on weight
    let offsets: number[];
    switch (weight) {
      case 'double':
        offsets = [-5, 5];
        break;
      case 'triple':
        offsets = [-8, 0, 8];
        break;
      default:
        offsets = [0]; // normal or bold: single centered line
    }

    // Arrowhead helper — draws a filled triangle at the tip
    const headLength = 12;
    const drawArrowhead = (tipX: number, tipY: number, fromX: number, fromY: number) => {
      const arrowAngle = Math.atan2(tipY - fromY, tipX - fromX);
      ctx.save();
      ctx.translate(tipX, tipY);
      ctx.rotate(arrowAngle);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-headLength, -headLength * 0.4);
      ctx.lineTo(-headLength, headLength * 0.4);
      ctx.closePath();
      ctx.fillStyle = strokeColor;
      ctx.fill();
      ctx.restore();
    };

    // Draw each strand (parallel line) with its own stroke + arrowheads
    ctx.save();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strandWidth;
    ctx.lineCap = 'round';
    if (pattern === 'dashed') {
      ctx.setLineDash([12, 8]);
    } else {
      ctx.setLineDash([]);
    }

    for (const offset of offsets) {
      const ox = perpX * offset;
      const oy = perpY * offset;
      const sx = p1x + ox;
      const sy = p1y + oy;
      const ex = p2x + ox;
      const ey = p2y + oy;

      // Draw the line strand
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      // Draw arrowheads on THIS strand
      if (endpoint === 'arrow-end' || endpoint === 'arrow-both') {
        drawArrowhead(ex, ey, sx, sy);
      }
      if (endpoint === 'arrow-both') {
        drawArrowhead(sx, sy, ex, ey);
      }
    }

    ctx.restore();
  };

  line.objectCaching = false;
}

/**
 * Adds custom Fabric.js endpoint controls (p1/p2) to a standalone line.
 * Similar to connector endpoint controls but without lock button.
 */
function setupLineEndpointControls(line: fabric.Line): void {
  const endpointRadius = 7;

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

  const makePositionHandler = (endpoint: 'p1' | 'p2') => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return function (_dim: any, finalMatrix: any, fabricObj: any) {
      const lineObj = fabricObj as fabric.Line;
      if (typeof lineObj.calcLinePoints !== 'function') {
        return fabric.util.transformPoint(new fabric.Point(0, 0), finalMatrix);
      }
      const pts = lineObj.calcLinePoints();
      const pt = endpoint === 'p1'
        ? new fabric.Point(pts.x1, pts.y1)
        : new fabric.Point(pts.x2, pts.y2);
      const objectMatrix = lineObj.calcTransformMatrix();
      const viewportMatrix = lineObj.canvas!.viewportTransform!;
      const totalMatrix = fabric.util.multiplyTransformMatrices(viewportMatrix, objectMatrix);
      return fabric.util.transformPoint(pt, totalMatrix);
    };
  };

  const makeActionHandler = (endpoint: 'p1' | 'p2') => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return function (_eventData: any, transform: any, x: number, y: number) {
      const lineObj = transform.target as fabric.Line;
      if (typeof lineObj.calcLinePoints !== 'function') return false;
      if (endpoint === 'p1') {
        lineObj.set({ x1: x, y1: y });
      } else {
        lineObj.set({ x2: x, y2: y });
      }
      return true;
    };
  };

  // Instance-specific controls (don't pollute the prototype)
  line.controls = { ...line.controls };

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

  // Hide all default controls
  const defaultControls = ['tl', 'tr', 'bl', 'br', 'ml', 'mr', 'mt', 'mb', 'mtr'];
  for (const key of defaultControls) {
    line.setControlVisible(key, false);
  }
}
