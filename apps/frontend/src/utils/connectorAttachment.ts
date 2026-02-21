import { fabric } from 'fabric';
import { findFabricObjectById, syncConnectorCoordsAfterMove } from './fabricHelpers';

// ============================================================
// Connector Attachment System
//
// Manages the relationship between connectors and the objects
// they are attached to. When an object moves, all connectors
// attached to it move their respective endpoint(s) to follow.
// When an object is deleted, attached connector endpoints
// become free (detached).
// ============================================================

/** Snap radius in canvas coordinates — connector endpoint must be within this distance to attach. */
export const SNAP_RADIUS = 25;

/**
 * Find the nearest non-connector, non-flag object to a point on the canvas.
 * Returns the object and its center point if within SNAP_RADIUS, else null.
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
    if (!type || type === 'connector' || type === 'flag') continue;
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
 * When an object moves, any connector with fromObjectId or toObjectId
 * matching the object's ID gets its corresponding endpoint moved to
 * the object's new center point.
 *
 * Returns a list of updated connector IDs (for emitting updates to server).
 */
export function updateAttachedConnectors(
  canvas: fabric.Canvas,
  movedObjectId: string,
  newCenter: { x: number; y: number }
): string[] {
  const updatedIds: string[] = [];

  for (const obj of canvas.getObjects()) {
    if (obj.data?.type !== 'connector') continue;
    const line = obj as fabric.Line;
    const fromId = obj.data.fromObjectId as string;
    const toId = obj.data.toObjectId as string;

    let changed = false;

    if (fromId === movedObjectId) {
      // Move start endpoint (x1, y1) to new center
      line.set({ x1: newCenter.x, y1: newCenter.y });
      changed = true;
    }

    if (toId === movedObjectId) {
      // Move end endpoint (x2, y2) to new center
      line.set({ x2: newCenter.x, y2: newCenter.y });
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
 * The connector stays where it is — only the attachment relationship is severed.
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
      changed = true;
    }

    if (toId === deletedObjectId) {
      obj.data.toObjectId = '';
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
