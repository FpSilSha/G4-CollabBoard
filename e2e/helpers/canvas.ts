import { Page, expect } from '@playwright/test';

/**
 * Canvas interaction helpers for Playwright E2E tests.
 *
 * Uses two approaches:
 * 1. DOM interactions — clicking/dragging on the `.upper-canvas` element
 * 2. __TEST_FABRIC bridge — querying Fabric.js state via page.evaluate()
 */

/** Serialized canvas object returned from __TEST_FABRIC queries */
export interface CanvasObject {
  id: string;
  type: string;
  shapeType?: string;
  left: number;
  top: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  text?: string;
  angle?: number;
}

/**
 * Get the bounding rect of the upper canvas element (the interactive layer).
 */
async function getCanvasBounds(page: Page) {
  const canvas = page.locator('.upper-canvas');
  await canvas.waitFor({ state: 'visible', timeout: 10000 });
  return canvas.boundingBox();
}

/**
 * Click on the canvas at a position relative to the canvas center.
 * offsetX/offsetY are pixel offsets from center (0,0 = center).
 */
export async function clickCanvas(
  page: Page,
  offsetX = 0,
  offsetY = 0
) {
  const bounds = await getCanvasBounds(page);
  if (!bounds) throw new Error('Canvas not found');
  const x = bounds.x + bounds.width / 2 + offsetX;
  const y = bounds.y + bounds.height / 2 + offsetY;
  await page.mouse.click(x, y);
}

/**
 * Double-click on the canvas at a position relative to center.
 */
export async function doubleClickCanvas(
  page: Page,
  offsetX = 0,
  offsetY = 0
) {
  const bounds = await getCanvasBounds(page);
  if (!bounds) throw new Error('Canvas not found');
  const x = bounds.x + bounds.width / 2 + offsetX;
  const y = bounds.y + bounds.height / 2 + offsetY;
  await page.mouse.dblclick(x, y);
}

/**
 * Drag on the canvas from one position to another.
 * Positions are relative to canvas center.
 */
export async function dragOnCanvas(
  page: Page,
  fromOffsetX: number,
  fromOffsetY: number,
  toOffsetX: number,
  toOffsetY: number,
  steps = 10
) {
  const bounds = await getCanvasBounds(page);
  if (!bounds) throw new Error('Canvas not found');

  const fromX = bounds.x + bounds.width / 2 + fromOffsetX;
  const fromY = bounds.y + bounds.height / 2 + fromOffsetY;
  const toX = bounds.x + bounds.width / 2 + toOffsetX;
  const toY = bounds.y + bounds.height / 2 + toOffsetY;

  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  await page.mouse.move(toX, toY, { steps });
  await page.mouse.up();
}

/**
 * Scroll the mouse wheel on the canvas (for zoom).
 */
export async function scrollCanvas(
  page: Page,
  deltaY: number,
  offsetX = 0,
  offsetY = 0
) {
  const bounds = await getCanvasBounds(page);
  if (!bounds) throw new Error('Canvas not found');
  const x = bounds.x + bounds.width / 2 + offsetX;
  const y = bounds.y + bounds.height / 2 + offsetY;
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, deltaY);
}

/**
 * Get all objects from the Fabric.js canvas via the test bridge.
 */
export async function getCanvasObjects(page: Page): Promise<CanvasObject[]> {
  return page.evaluate(() => {
    const canvas = (window as any).__TEST_FABRIC;
    if (!canvas) return [];
    return canvas.getObjects().map((o: any) => ({
      id: o.data?.id || '',
      type: o.data?.type || o.type || 'unknown',
      shapeType: o.data?.shapeType || undefined,
      left: o.left ?? 0,
      top: o.top ?? 0,
      width: o.width ?? 0,
      height: o.height ?? 0,
      scaleX: o.scaleX ?? 1,
      scaleY: o.scaleY ?? 1,
      fill: o.fill ?? null,
      stroke: o.stroke ?? null,
      strokeWidth: o.strokeWidth ?? 0,
      text: o.data?.text ?? o.text ?? undefined,
      angle: o.angle ?? 0,
    }));
  });
}

/**
 * Get the count of objects on the canvas.
 */
export async function getCanvasObjectCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = (window as any).__TEST_FABRIC;
    return canvas ? canvas.getObjects().length : 0;
  });
}

/**
 * Find a canvas object by its data.id.
 */
export async function getCanvasObjectById(
  page: Page,
  id: string
): Promise<CanvasObject | null> {
  return page.evaluate((objectId) => {
    const canvas = (window as any).__TEST_FABRIC;
    if (!canvas) return null;
    const o = canvas.getObjects().find((obj: any) => obj.data?.id === objectId);
    if (!o) return null;
    return {
      id: o.data?.id || '',
      type: o.data?.type || o.type || 'unknown',
      shapeType: o.data?.shapeType || undefined,
      left: o.left ?? 0,
      top: o.top ?? 0,
      width: o.width ?? 0,
      height: o.height ?? 0,
      scaleX: o.scaleX ?? 1,
      scaleY: o.scaleY ?? 1,
      fill: o.fill ?? null,
      stroke: o.stroke ?? null,
      strokeWidth: o.strokeWidth ?? 0,
      text: o.data?.text ?? o.text ?? undefined,
      angle: o.angle ?? 0,
    };
  }, id);
}

/**
 * Wait until the canvas has exactly the expected number of objects.
 * Useful for waiting for WebSocket sync.
 */
export async function waitForObjectCount(
  page: Page,
  expectedCount: number,
  timeout = 5000
) {
  await expect(async () => {
    const count = await getCanvasObjectCount(page);
    expect(count).toBe(expectedCount);
  }).toPass({ timeout });
}

/**
 * Get the currently selected objects on the canvas.
 */
export async function getSelectedObjects(page: Page): Promise<CanvasObject[]> {
  return page.evaluate(() => {
    const canvas = (window as any).__TEST_FABRIC;
    if (!canvas) return [];
    const active = canvas.getActiveObjects();
    return active.map((o: any) => ({
      id: o.data?.id || '',
      type: o.data?.type || o.type || 'unknown',
      shapeType: o.data?.shapeType || undefined,
      left: o.left ?? 0,
      top: o.top ?? 0,
      width: o.width ?? 0,
      height: o.height ?? 0,
      scaleX: o.scaleX ?? 1,
      scaleY: o.scaleY ?? 1,
      fill: o.fill ?? null,
      stroke: o.stroke ?? null,
      strokeWidth: o.strokeWidth ?? 0,
      text: o.data?.text ?? o.text ?? undefined,
      angle: o.angle ?? 0,
    }));
  });
}

/**
 * Get the current zoom level.
 */
export async function getZoomLevel(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = (window as any).__TEST_FABRIC;
    return canvas ? canvas.getZoom() : 1;
  });
}

/**
 * Get the canvas viewport transform (for checking pan position).
 */
export async function getViewportTransform(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const canvas = (window as any).__TEST_FABRIC;
    return canvas ? Array.from(canvas.viewportTransform || [1, 0, 0, 1, 0, 0]) : [1, 0, 0, 1, 0, 0];
  });
}
