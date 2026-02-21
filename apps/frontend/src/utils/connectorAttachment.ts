import { fabric } from 'fabric';
import { findFabricObjectById } from './fabricHelpers';
import { getObjectGeometry, anchorToAbsolute } from './edgeGeometry';

// ============================================================
// Connector Attachment System
//
// Manages the relationship between connectors and the objects
// they are attached to. When an object moves/rotates/resizes,
// all connectors attached to it move their respective endpoint(s)
// to follow — using anchor points for edge-locked connectors or
// falling back to center tracking for legacy connectors.
//
// When an object is deleted, attached connector endpoints
// become free (detached).
// ============================================================

/** Snap radius in canvas coordinates — connector endpoint must be within this distance to attach. */
export const SNAP_RADIUS = 25;

/**
 * Find the nearest non-connector, non-flag object to a point on the canvas.
 * Returns the object and its center point if within SNAP_RADIUS, else null.
 * Used during drag-to-create connector (center snapping for initial creation).
 */
export function findSnapTarget(
  canvas: fabric.Canvas,
  x: number,
  y: number,
  excludeIds?: string[]
): { object: fabric.Object; center: { x: number; y: number } } | null {
  let closest: fabric.Object | null = null;
  let closestDist = Infinity;

  for (const obj of canvas.getObjects()) {
    // Skip connectors (can't attach to another connector), flags, and preview lines
    const type = obj.data?.type;
    if (!type || type === 'connector' || type === 'teleportFlag') continue;
    if (!obj.data?.id) continue;
    if (excludeIds && excludeIds.includes(obj.data.id)) continue;

    const center = obj.getCenterPoint();
    const dx = center.x - x;
    const dy = center.y - y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < closestDist && dist <= SNAP_RADIUS) {
      closest = obj;
      closestDist = dist;
    }
  }

  if (!closest) return null;

  return {
    object: closest,
    center: closest.getCenterPoint(),
  };
}

/**
 * Get the center point of a Fabric object by its data.id.
 * Returns null if the object is not found on the canvas.
 */
export function getObjectCenter(
  canvas: fabric.Canvas,
  objectId: string
): { x: number; y: number } | null {
  if (!objectId) return null;
  const obj = findFabricObjectById(canvas, objectId);
  if (!obj) return null;
  const center = obj.getCenterPoint();
  return { x: center.x, y: center.y };
}

/**
 * Update all connectors that are attached to a given object.
 *
 * When an object moves, rotates, or resizes, any connector with
 * fromObjectId or toObjectId matching the object's ID gets its
 * corresponding endpoint repositioned:
 *   - If the connector has an anchor (fromAnchor/toAnchor),
 *     computes the new absolute position via anchorToAbsolute(),
 *     which correctly handles rotation and resize.
 *   - If no anchor (legacy center-snap), falls back to center point.
 *
 * Reads the object's current geometry directly from the canvas
 * (no newCenter parameter needed — works for move, rotate, AND resize).
 *
 * Returns a list of updated connector IDs (for emitting updates to server).
 */
export function updateAttachedConnectors(
  canvas: fabric.Canvas,
  movedObjectId: string
): string[] {
  // Find the moved object to get its current geometry
  const movedObj = findFabricObjectById(canvas, movedObjectId);
  if (!movedObj) return [];

  const geo = getObjectGeometry(movedObj);
  const updatedIds: string[] = [];

  for (const obj of canvas.getObjects()) {
    if (obj.data?.type !== 'connector') continue;
    const line = obj as fabric.Line;
    const fromId = obj.data.fromObjectId as string;
    const toId = obj.data.toObjectId as string;

    let changed = false;

    if (fromId === movedObjectId) {
      const fromAnchor = obj.data.fromAnchor;
      if (fromAnchor) {
        // Anchor-aware: resolve through object's current transform
        const pos = anchorToAbsolute(fromAnchor, geo);
        line.set({ x1: pos.x, y1: pos.y });
      } else {
        // Legacy: snap to center
        line.set({ x1: geo.centerX, y1: geo.centerY });
      }
      changed = true;
    }

    if (toId === movedObjectId) {
      const toAnchor = obj.data.toAnchor;
      if (toAnchor) {
        const pos = anchorToAbsolute(toAnchor, geo);
        line.set({ x2: pos.x, y2: pos.y });
      } else {
        line.set({ x2: geo.centerX, y2: geo.centerY });
      }
      changed = true;
    }

    if (changed) {
      line.setCoords();
      updatedIds.push(obj.data.id);
    }
  }

  return updatedIds;
}

/**
 * Detach all connectors that reference a deleted object.
 *
 * When an object is deleted, any connector with fromObjectId or toObjectId
 * matching the deleted object's ID gets that reference cleared (set to '').
 * Anchors are also cleared. The connector stays where it is — only the
 * attachment relationship is severed.
 *
 * Returns a list of updated connector IDs + their updated fromObjectId/toObjectId.
 */
export function detachConnectorsFromObject(
  canvas: fabric.Canvas,
  deletedObjectId: string
): Array<{ connectorId: string; fromObjectId: string; toObjectId: string }> {
  const updates: Array<{ connectorId: string; fromObjectId: string; toObjectId: string }> = [];

  for (const obj of canvas.getObjects()) {
    if (obj.data?.type !== 'connector') continue;
    const fromId = obj.data.fromObjectId as string;
    const toId = obj.data.toObjectId as string;
    let changed = false;

    if (fromId === deletedObjectId) {
      obj.data.fromObjectId = '';
      obj.data.fromAnchor = null;
      changed = true;
    }

    if (toId === deletedObjectId) {
      obj.data.toObjectId = '';
      obj.data.toAnchor = null;
      changed = true;
    }

    if (changed) {
      updates.push({
        connectorId: obj.data.id,
        fromObjectId: obj.data.fromObjectId,
        toObjectId: obj.data.toObjectId,
      });
    }
  }

  return updates;
}

/**
 * Get a snap-ready preview during connector creation.
 * Returns snap info if a valid target is found near the point.
 */
export function getSnapPreview(
  canvas: fabric.Canvas,
  x: number,
  y: number,
  excludeIds?: string[]
): { objectId: string; center: { x: number; y: number } } | null {
  const target = findSnapTarget(canvas, x, y, excludeIds);
  if (!target) return null;
  return {
    objectId: target.object.data.id,
    center: target.center,
  };
}
