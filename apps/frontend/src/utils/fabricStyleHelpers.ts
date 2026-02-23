import { fabric } from 'fabric';
import {
  STICKY_NOTE_COLORS,
} from 'shared';

/** Default font stack used for text elements and sticky notes. */
export const DEFAULT_SYSTEM_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

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
  if (obj.data?.type === 'connector' || obj.data?.type === 'line') {
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
  text: fabric.Textbox;
} {
  const objects = group.getObjects();
  return {
    base: objects[0] as fabric.Polygon,
    fold: objects[1] as fabric.Polygon,
    text: objects[2] as fabric.Textbox,
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
  const labelBg = objects[1] as fabric.Rect;
  const label = objects[2] as fabric.Text;
  borderRect.set('stroke', newColor);
  borderRect.set('fill', hexToRgba(newColor, 0.06));
  // Label bg stays dark for all frame colors; text stays white
  labelBg.set('fill', 'rgba(0, 0, 0, 0.6)');
  label.set('fill', '#ffffff');
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

/**
 * Convert a hex color to an rgba() string with the given alpha.
 * Used for frame tinted backgrounds and label overlays.
 */
export function hexToRgba(hex: string, alpha: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

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
