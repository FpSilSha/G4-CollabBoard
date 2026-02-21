import type { ViewportBounds } from 'shared';
import type { BoardObject } from 'shared';
import { AI_CONFIG } from 'shared';

// ============================================================
// Viewport Filtering & Spatial Utilities
// ============================================================

/**
 * Check if a board object is within (or overlapping) the viewport bounds.
 * Objects are rectangular regions defined by (x, y, width, height).
 * Connectors use (x, y) as start and (x2, y2) as end — we check both.
 */
export function isObjectInViewport(obj: BoardObject, viewport: ViewportBounds): boolean {
  const vRight = viewport.x + viewport.width;
  const vBottom = viewport.y + viewport.height;

  if (obj.type === 'connector') {
    // Connector: check if either endpoint is in viewport
    const startInView = obj.x >= viewport.x && obj.x <= vRight &&
                        obj.y >= viewport.y && obj.y <= vBottom;
    const endInView = obj.x2 >= viewport.x && obj.x2 <= vRight &&
                      obj.y2 >= viewport.y && obj.y2 <= vBottom;
    return startInView || endInView;
  }

  // All other types have x, y, width, height
  const objWidth = 'width' in obj ? (obj as { width: number }).width : 0;
  const objHeight = 'height' in obj ? (obj as { height: number }).height : 0;

  const objRight = obj.x + objWidth;
  const objBottom = obj.y + objHeight;

  // AABB overlap test
  return obj.x < vRight && objRight > viewport.x &&
         obj.y < vBottom && objBottom > viewport.y;
}

/**
 * Calculate distance from an object's center to the viewport center.
 * Used for sorting objects by proximity when capping results.
 */
export function distanceToViewportCenter(obj: BoardObject, viewport: ViewportBounds): number {
  const vCenterX = viewport.x + viewport.width / 2;
  const vCenterY = viewport.y + viewport.height / 2;

  let objCenterX: number;
  let objCenterY: number;

  if (obj.type === 'connector') {
    // Connector center = midpoint of line
    objCenterX = (obj.x + obj.x2) / 2;
    objCenterY = (obj.y + obj.y2) / 2;
  } else {
    const objWidth = 'width' in obj ? (obj as { width: number }).width : 0;
    const objHeight = 'height' in obj ? (obj as { height: number }).height : 0;
    objCenterX = obj.x + objWidth / 2;
    objCenterY = obj.y + objHeight / 2;
  }

  const dx = objCenterX - vCenterX;
  const dy = objCenterY - vCenterY;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Filter board objects to those within the viewport, applying optional
 * type/color filters. Returns up to AI_VIEWPORT_OBJECT_CAP objects,
 * sorted by distance to viewport center (closest first).
 */
export function getViewportFilteredObjects(
  objects: BoardObject[],
  viewport: ViewportBounds,
  options?: {
    filterByType?: string;
    filterByColor?: string;
    cap?: number;
  }
): BoardObject[] {
  const cap = options?.cap ?? AI_CONFIG.VIEWPORT_OBJECT_CAP;

  let filtered = objects.filter(obj => isObjectInViewport(obj, viewport));

  // Apply optional type filter
  if (options?.filterByType) {
    filtered = filtered.filter(obj => obj.type === options.filterByType);
  }

  // Apply optional color filter (case-insensitive)
  if (options?.filterByColor) {
    const targetColor = options.filterByColor.toUpperCase();
    filtered = filtered.filter(obj => {
      if ('color' in obj) {
        return (obj as { color: string }).color.toUpperCase() === targetColor;
      }
      return false;
    });
  }

  // Sort by distance to viewport center, then cap
  filtered.sort((a, b) =>
    distanceToViewportCenter(a, viewport) - distanceToViewportCenter(b, viewport)
  );

  return filtered.slice(0, cap);
}

/**
 * Summarize a BoardObject for inclusion in LLM tool results.
 * Returns a compact representation with the most useful fields.
 */
export function summarizeObject(obj: BoardObject): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: obj.id,
    type: obj.type,
    x: obj.x,
    y: obj.y,
  };

  switch (obj.type) {
    case 'sticky':
      return {
        ...base,
        text: obj.text,
        color: obj.color,
        width: obj.width,
        height: obj.height,
        frameId: obj.frameId,
      };
    case 'shape':
      return {
        ...base,
        shapeType: obj.shapeType,
        width: obj.width,
        height: obj.height,
        color: obj.color,
        rotation: obj.rotation,
      };
    case 'frame':
      return {
        ...base,
        title: obj.title,
        width: obj.width,
        height: obj.height,
        color: obj.color,
      };
    case 'connector':
      return {
        ...base,
        fromObjectId: obj.fromObjectId,
        toObjectId: obj.toObjectId,
        style: obj.style,
        color: obj.color,
        x2: obj.x2,
        y2: obj.y2,
      };
    case 'text':
      return {
        ...base,
        text: obj.text,
        fontSize: obj.fontSize,
        color: obj.color,
      };
    default:
      return base;
  }
}

/**
 * Get full details of a single object by ID from the board's objects array.
 * Returns null if not found.
 */
export function getObjectById(objects: BoardObject[], objectId: string): BoardObject | null {
  return objects.find(obj => obj.id === objectId) ?? null;
}
