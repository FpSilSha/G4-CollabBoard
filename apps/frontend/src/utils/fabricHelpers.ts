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
// Color Utility
// ============================================================

// ============================================================
// Conversion: BoardObject -> Fabric Object (for rendering server state)
// ============================================================

/**
 * Converts a BoardObject (from server) into a Fabric.js object for rendering.
 * This is the reverse of fabricToBoardObject — used when loading board:state
 * or applying object:created events from other users.
 */
export function boardObjectToFabric(obj: BoardObject): fabric.Object | null {
  switch (obj.type) {
    case 'sticky':
      return createStickyNote({
        x: obj.x,
        y: obj.y,
        color: obj.color,
        text: obj.text,
        id: obj.id,
      });

    case 'shape':
      if (obj.shapeType === 'circle') {
        return createCircle({
          x: obj.x,
          y: obj.y,
          color: obj.color,
          radius: obj.width / 2,
          id: obj.id,
        });
      }
      if (obj.shapeType === 'rectangle') {
        const rect = createRectangle({
          x: obj.x,
          y: obj.y,
          color: obj.color,
          width: obj.width,
          height: obj.height,
          id: obj.id,
        });
        if (obj.rotation) rect.set('angle', obj.rotation);
        return rect;
      }
      return null;

    // frame, connector, text — not yet supported in Phase 3/4 canvas
    default:
      return null;
  }
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
