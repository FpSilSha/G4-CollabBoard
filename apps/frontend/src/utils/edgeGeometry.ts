import { fabric } from 'fabric';
import type { AnchorPoint } from 'shared';

// ============================================================
// Edge Geometry Module
//
// Core math for connector edge-lock attachment. Handles:
//   - Object geometry extraction (center, dims, rotation, shape type)
//   - Canvas ↔ local coordinate transforms (rotation-aware)
//   - Edge-distance calculation (rectangles + circles)
//   - Point-in-object testing
//   - Anchor ↔ absolute position conversion
//   - Main findEdgeLockTarget() for lock-button click
// ============================================================

/** Distance in canvas pixels for edge snap detection. */
export const EDGE_SNAP_RADIUS = 10;

// ============================================================
// Object Geometry
// ============================================================

export interface ObjectGeometry {
  centerX: number;
  centerY: number;
  halfWidth: number;
  halfHeight: number;
  /** Rotation in degrees. */
  angle: number;
  isCircle: boolean;
  /** Radius for circles only (equals halfWidth). */
  radius?: number;
}

/**
 * Extract usable geometry from a Fabric.js object.
 * Accounts for scaleX/scaleY and object type (circle vs rect vs group).
 */
export function getObjectGeometry(obj: fabric.Object): ObjectGeometry {
  const center = obj.getCenterPoint();
  const scaleX = obj.scaleX ?? 1;
  const scaleY = obj.scaleY ?? 1;
  const angle = obj.angle ?? 0;

  const isCircle = obj.data?.shapeType === 'circle' || obj.type === 'circle';

  if (isCircle) {
    const circle = obj as fabric.Circle;
    const radius = (circle.radius ?? 50) * scaleX;
    return {
      centerX: center.x,
      centerY: center.y,
      halfWidth: radius,
      halfHeight: radius,
      angle,
      isCircle: true,
      radius,
    };
  }

  // Rectangles, groups (stickies, frames), and other shapes
  const halfWidth = ((obj.width ?? 100) * scaleX) / 2;
  const halfHeight = ((obj.height ?? 100) * scaleY) / 2;

  return {
    centerX: center.x,
    centerY: center.y,
    halfWidth,
    halfHeight,
    angle,
    isCircle: false,
  };
}

// ============================================================
// Coordinate Transforms
// ============================================================

/**
 * Transform a canvas-space point into the object's local (unrotated) space.
 * Origin = object center, axes = aligned with object edges.
 */
export function canvasToLocal(
  point: { x: number; y: number },
  geo: ObjectGeometry
): { lx: number; ly: number } {
  // Translate so object center is origin
  const dx = point.x - geo.centerX;
  const dy = point.y - geo.centerY;

  // Rotate by negative angle
  const rad = (-geo.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  return {
    lx: dx * cos - dy * sin,
    ly: dx * sin + dy * cos,
  };
}

/**
 * Transform a local-space point back to canvas coordinates.
 */
export function localToCanvas(
  local: { lx: number; ly: number },
  geo: ObjectGeometry
): { x: number; y: number } {
  const rad = (geo.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  return {
    x: geo.centerX + local.lx * cos - local.ly * sin,
    y: geo.centerY + local.lx * sin + local.ly * cos,
  };
}

// ============================================================
// Edge Detection
// ============================================================

/**
 * Find the nearest point on the object's edge to a local-space point.
 * Returns the edge point (in local space) and the distance from the input point.
 *
 * For rectangles: checks all 4 edges as line segments.
 * For circles: projects onto circumference.
 */
export function nearestEdgePoint(
  localPoint: { lx: number; ly: number },
  geo: ObjectGeometry
): { edgeLx: number; edgeLy: number; distance: number } {
  if (geo.isCircle && geo.radius !== undefined) {
    return nearestEdgePointCircle(localPoint, geo.radius);
  }
  return nearestEdgePointRect(localPoint, geo.halfWidth, geo.halfHeight);
}

function nearestEdgePointCircle(
  lp: { lx: number; ly: number },
  radius: number
): { edgeLx: number; edgeLy: number; distance: number } {
  const dist = Math.sqrt(lp.lx * lp.lx + lp.ly * lp.ly);

  if (dist < 0.001) {
    // Point is at center — pick the right edge as default
    return { edgeLx: radius, edgeLy: 0, distance: radius };
  }

  // Project onto circumference
  const edgeLx = (lp.lx / dist) * radius;
  const edgeLy = (lp.ly / dist) * radius;
  const edgeDist = Math.abs(dist - radius);

  return { edgeLx, edgeLy, distance: edgeDist };
}

function nearestEdgePointRect(
  lp: { lx: number; ly: number },
  hw: number,
  hh: number
): { edgeLx: number; edgeLy: number; distance: number } {
  // Define the 4 edges as line segments in local space:
  //   Top:    (-hw, -hh) → (hw, -hh)
  //   Bottom: (-hw,  hh) → (hw,  hh)
  //   Left:   (-hw, -hh) → (-hw, hh)
  //   Right:  ( hw, -hh) → ( hw, hh)

  const edges: Array<{ x1: number; y1: number; x2: number; y2: number }> = [
    { x1: -hw, y1: -hh, x2: hw, y2: -hh }, // Top
    { x1: -hw, y1: hh, x2: hw, y2: hh },   // Bottom
    { x1: -hw, y1: -hh, x2: -hw, y2: hh }, // Left
    { x1: hw, y1: -hh, x2: hw, y2: hh },   // Right
  ];

  let bestDist = Infinity;
  let bestEdgeLx = 0;
  let bestEdgeLy = 0;

  for (const edge of edges) {
    const { px, py, dist } = nearestPointOnSegment(
      lp.lx, lp.ly,
      edge.x1, edge.y1,
      edge.x2, edge.y2
    );
    if (dist < bestDist) {
      bestDist = dist;
      bestEdgeLx = px;
      bestEdgeLy = py;
    }
  }

  return { edgeLx: bestEdgeLx, edgeLy: bestEdgeLy, distance: bestDist };
}

/**
 * Nearest point on a line segment (ax,ay)→(bx,by) to point (px,py).
 */
function nearestPointOnSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number
): { px: number; py: number; dist: number } {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;

  const ab2 = abx * abx + aby * aby;
  if (ab2 < 0.001) {
    // Degenerate segment (point)
    const d = Math.sqrt(apx * apx + apy * apy);
    return { px: ax, py: ay, dist: d };
  }

  let t = (apx * abx + apy * aby) / ab2;
  t = Math.max(0, Math.min(1, t));

  const nearX = ax + t * abx;
  const nearY = ay + t * aby;
  const dx = px - nearX;
  const dy = py - nearY;

  return { px: nearX, py: nearY, dist: Math.sqrt(dx * dx + dy * dy) };
}

// ============================================================
// Point-in-Object Test
// ============================================================

/**
 * Check if a local-space point is inside the object bounds.
 */
export function isPointInsideObject(
  localPoint: { lx: number; ly: number },
  geo: ObjectGeometry
): boolean {
  if (geo.isCircle && geo.radius !== undefined) {
    const dist = Math.sqrt(localPoint.lx * localPoint.lx + localPoint.ly * localPoint.ly);
    return dist <= geo.radius;
  }
  return (
    Math.abs(localPoint.lx) <= geo.halfWidth &&
    Math.abs(localPoint.ly) <= geo.halfHeight
  );
}

// ============================================================
// Anchor Conversion
// ============================================================

/**
 * Convert a local-space point to a normalized anchor.
 * Divides by half-dimensions so edges are at ±1.
 */
export function localToAnchor(
  localPoint: { lx: number; ly: number },
  geo: ObjectGeometry
): AnchorPoint {
  const rx = geo.halfWidth > 0 ? localPoint.lx / geo.halfWidth : 0;
  const ry = geo.halfHeight > 0 ? localPoint.ly / geo.halfHeight : 0;
  return { rx, ry };
}

/**
 * Convert a normalized anchor back to absolute canvas coordinates,
 * applying the object's current geometry (center, dimensions, rotation).
 */
export function anchorToAbsolute(
  anchor: AnchorPoint,
  geo: ObjectGeometry
): { x: number; y: number } {
  // Local-space position
  const localLx = anchor.rx * geo.halfWidth;
  const localLy = anchor.ry * geo.halfHeight;

  // Rotate by object angle and translate to canvas space
  return localToCanvas({ lx: localLx, ly: localLy }, geo);
}

// ============================================================
// Main Lock Target Finder
// ============================================================

export interface EdgeLockResult {
  objectId: string;
  anchor: AnchorPoint;
  absolutePoint: { x: number; y: number };
}

/**
 * Find the best object to lock a connector endpoint to.
 *
 * Priority rules:
 * 1. Edge matches (within EDGE_SNAP_RADIUS) always beat interior matches.
 * 2. Among edge candidates: closest edge distance wins (tie-break: higher z-index).
 * 3. Among interior candidates (point is inside object): highest z-index wins.
 * 4. Returns null if no target found.
 */
export function findEdgeLockTarget(
  canvas: fabric.Canvas,
  x: number,
  y: number,
  excludeIds?: string[]
): EdgeLockResult | null {
  const objects = canvas.getObjects();

  interface Candidate {
    objectId: string;
    geo: ObjectGeometry;
    /** Local-space contact point — edge point for edge matches, original point for interior. */
    contactLx: number;
    contactLy: number;
    /** Edge distance (Infinity for interior-only matches). */
    edgeDistance: number;
    /** Z-index (position in canvas objects array). */
    zIndex: number;
    isEdge: boolean;
  }

  const candidates: Candidate[] = [];

  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    const type = obj.data?.type;

    // Skip connectors, flags, teleport flags, objects without IDs, and excluded IDs
    if (!type || type === 'connector' || type === 'teleportFlag') continue;
    if (!obj.data?.id) continue;
    if (excludeIds && excludeIds.includes(obj.data.id)) continue;

    const geo = getObjectGeometry(obj);
    const local = canvasToLocal({ x, y }, geo);
    const edge = nearestEdgePoint(local, geo);

    if (edge.distance <= EDGE_SNAP_RADIUS) {
      // Edge candidate
      candidates.push({
        objectId: obj.data.id,
        geo,
        contactLx: edge.edgeLx,
        contactLy: edge.edgeLy,
        edgeDistance: edge.distance,
        zIndex: i,
        isEdge: true,
      });
    } else if (isPointInsideObject(local, geo)) {
      // Interior candidate — use the original local point as contact
      candidates.push({
        objectId: obj.data.id,
        geo,
        contactLx: local.lx,
        contactLy: local.ly,
        edgeDistance: Infinity,
        zIndex: i,
        isEdge: false,
      });
    }
  }

  if (candidates.length === 0) return null;

  // Edge candidates beat interior candidates
  const edgeCandidates = candidates.filter((c) => c.isEdge);
  const interiorCandidates = candidates.filter((c) => !c.isEdge);

  let winner: Candidate;

  if (edgeCandidates.length > 0) {
    // Pick closest edge distance; tie-break by highest z-index
    edgeCandidates.sort((a, b) => {
      if (Math.abs(a.edgeDistance - b.edgeDistance) < 0.5) {
        return b.zIndex - a.zIndex; // Higher z-index wins
      }
      return a.edgeDistance - b.edgeDistance; // Closer edge wins
    });
    winner = edgeCandidates[0];
  } else {
    // Pick highest z-index among interior candidates
    interiorCandidates.sort((a, b) => b.zIndex - a.zIndex);
    winner = interiorCandidates[0];
  }

  const anchor = localToAnchor(
    { lx: winner.contactLx, ly: winner.contactLy },
    winner.geo
  );
  const absolutePoint = anchorToAbsolute(anchor, winner.geo);

  return {
    objectId: winner.objectId,
    anchor,
    absolutePoint,
  };
}
