import { fabric } from 'fabric';
import {
  STICKY_NOTE_COLORS,
  SHAPE_COLORS,
  OBJECT_DEFAULTS,
  STICKY_SIZE_PRESETS,
} from 'shared';
import type { StickySizeKey } from 'shared';
import { generateLocalId } from './idGenerator';
import { darkenColor } from './fabricStyleHelpers';

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
  size?: StickySizeKey;
  width?: number;
  height?: number;
}): fabric.Group {
  const id = options.id ?? generateLocalId();
  const color = options.color ?? STICKY_NOTE_COLORS[0];
  const sizeKey = options.size ?? 'medium';
  const preset = STICKY_SIZE_PRESETS[sizeKey];
  const w = options.width ?? preset.width;
  const h = options.height ?? preset.height;
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

  // 3. Text display inside the sticky — Textbox enables word wrapping
  const textObj = new fabric.Textbox(options.text ?? '', {
    left: padding,
    top: padding,
    width: w - padding * 2,
    fontSize: OBJECT_DEFAULTS.STICKY_FONT_SIZE,
    fill: '#000000',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    selectable: false,
    evented: false,
    // Default Textbox wraps at word boundaries (spaces) — whole words
    // move to the next line. splitByGrapheme was breaking mid-word.
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
    // Disable scaling — sticky notes use preset sizes (S/M/L).
    // Prevents stretch desync between users (child polygons don't resize
    // with the group).
    lockScalingX: true,
    lockScalingY: true,
    hasControls: false,
    // Data applied to the entire group — syncs as one unit
    data: {
      id,
      type: 'sticky',
      text: options.text ?? '',
      size: sizeKey,
    },
  });

  return group;
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
  const circle = new fabric.Circle({
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

  // Override drawBorders to render a circular selection border instead of rectangular
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (circle as any).drawBorders = function (
    ctx: CanvasRenderingContext2D,
    styleOverride?: Record<string, unknown>
  ): fabric.Object {
    const borderColor = (styleOverride?.borderColor as string) || this.borderColor || '#007AFF';
    const borderWidth = (this.borderScaleFactor || 2);
    const padding = this.padding || 4;

    // Get the rendered radius accounting for scale
    const scaleX = this.scaleX || 1;
    const scaleY = this.scaleY || 1;
    const rx = this.radius! * scaleX + padding + borderWidth / 2;
    const ry = this.radius! * scaleY + padding + borderWidth / 2;

    ctx.save();
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = borderWidth;
    ctx.setLineDash([4, 3]);

    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
    return this;
  };

  return circle;
}

/**
 * Creates a Fabric.js Polygon representing an equilateral-ish triangle.
 */
export function createTriangle(options: {
  x: number;
  y: number;
  width?: number;
  height?: number;
  color?: string;
  id?: string;
}): fabric.Polygon {
  const id = options.id ?? generateLocalId();
  const w = options.width ?? OBJECT_DEFAULTS.SHAPE_WIDTH;
  const h = options.height ?? OBJECT_DEFAULTS.SHAPE_HEIGHT;

  const points = [
    { x: w / 2, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];

  return new fabric.Polygon(points, {
    left: options.x,
    top: options.y,
    fill: options.color ?? SHAPE_COLORS[0],
    stroke: '#000000',
    strokeWidth: 1,
    strokeLineJoin: 'round',
    data: {
      id,
      type: 'shape',
      shapeType: 'triangle',
    },
  });
}

/**
 * Creates a Fabric.js Polygon representing a thick directional arrow shape.
 * This is a shape (not a connector) — a filled polygon with shaft + arrowhead.
 */
export function createArrow(options: {
  x: number;
  y: number;
  width?: number;
  height?: number;
  color?: string;
  id?: string;
}): fabric.Polygon {
  const id = options.id ?? generateLocalId();
  const w = options.width ?? 150;
  const h = options.height ?? 80;
  const headStart = w * 0.6;
  const shaftHalf = h * 0.25;

  const points = [
    { x: 0, y: h / 2 - shaftHalf },
    { x: headStart, y: h / 2 - shaftHalf },
    { x: headStart, y: 0 },
    { x: w, y: h / 2 },
    { x: headStart, y: h },
    { x: headStart, y: h / 2 + shaftHalf },
    { x: 0, y: h / 2 + shaftHalf },
  ];

  return new fabric.Polygon(points, {
    left: options.x,
    top: options.y,
    fill: options.color ?? SHAPE_COLORS[0],
    stroke: '#000000',
    strokeWidth: 1,
    strokeLineJoin: 'round',
    data: {
      id,
      type: 'shape',
      shapeType: 'arrow',
    },
  });
}

/**
 * Creates a Fabric.js Polygon representing a 5-point star.
 */
export function createStar(options: {
  x: number;
  y: number;
  width?: number;
  height?: number;
  color?: string;
  id?: string;
}): fabric.Polygon {
  const id = options.id ?? generateLocalId();
  const size = options.width ?? 150;
  const outerR = size / 2;
  const innerR = outerR * 0.38;
  const cx = outerR;
  const cy = outerR;

  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    // Rotate -90° (- π/2) so the top point faces up
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    points.push({
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    });
  }

  return new fabric.Polygon(points, {
    left: options.x,
    top: options.y,
    fill: options.color ?? SHAPE_COLORS[0],
    stroke: '#000000',
    strokeWidth: 1,
    strokeLineJoin: 'round',
    data: {
      id,
      type: 'shape',
      shapeType: 'star',
    },
  });
}

/**
 * Creates a Fabric.js Polygon representing a diamond (rotated square).
 * Four points: top, right, bottom, left.
 */
export function createDiamond(options: {
  x: number;
  y: number;
  width?: number;
  height?: number;
  color?: string;
  id?: string;
}): fabric.Polygon {
  const id = options.id ?? generateLocalId();
  const w = options.width ?? 200;  // wider than tall for flowchart-style diamonds
  const h = options.height ?? 140;

  const points = [
    { x: w / 2, y: 0 },   // top
    { x: w, y: h / 2 },   // right
    { x: w / 2, y: h },   // bottom
    { x: 0, y: h / 2 },   // left
  ];

  return new fabric.Polygon(points, {
    left: options.x,
    top: options.y,
    fill: options.color ?? SHAPE_COLORS[0],
    stroke: '#000000',
    strokeWidth: 1,
    strokeLineJoin: 'round',
    data: {
      id,
      type: 'shape',
      shapeType: 'diamond',
    },
  });
}

// ============================================================
// Text Element Factory
// ============================================================

import { DEFAULT_SYSTEM_FONT } from './fabricStyleHelpers';

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
  fontFamily?: string;
  id?: string;
}): fabric.IText {
  const id = options.id ?? generateLocalId();
  const textObj = new fabric.IText(options.text ?? 'Text', {
    left: options.x,
    top: options.y,
    fontSize: options.fontSize ?? 24,
    fill: options.color ?? '#000000',
    fontFamily: options.fontFamily ?? DEFAULT_SYSTEM_FONT,
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
// Teleport Flag Factory
// ============================================================

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
