import { test, expect } from '../helpers/fixtures';
import {
  clickCanvas, getCanvasObjectCount, getCanvasObjects,
  waitForObjectCount,
} from '../helpers/canvas';

test.describe('Copy/Paste', () => {
  test.beforeEach(async ({ boardPage: page }) => {
    // Create a rectangle
    await page.click('[aria-label="Shape (R)"]');
    await page.waitForSelector('[aria-label="Rectangle"]', { state: 'visible' });
    await page.click('[aria-label="Rectangle"]');
    await clickCanvas(page, 0, 0);
    await waitForObjectCount(page, 1);
    await page.click('[aria-label="Select (V)"]');
  });

  test('copy and paste duplicates an object', async ({ boardPage: page }) => {
    // Select the object
    await clickCanvas(page, 0, 0);
    await page.waitForTimeout(200);

    // Copy + Paste
    await page.keyboard.press('Control+c');
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+v');
    await waitForObjectCount(page, 2);

    const objects = await getCanvasObjects(page);
    expect(objects.length).toBe(2);
    // Both should be shapes (rectangles)
    expect(objects[0].type).toBe('shape');
    expect(objects[1].type).toBe('shape');
  });

  test('Ctrl+A selects all objects', async ({ boardPage: page }) => {
    // Create a second object — need to re-open shape menu
    await page.click('[aria-label="Shape (R)"]');
    await page.waitForSelector('[aria-label="Circle"]', { state: 'visible' });
    await page.click('[aria-label="Circle"]');
    await clickCanvas(page, 250, 0);
    await waitForObjectCount(page, 2);

    // Select all
    await page.click('[aria-label="Select (V)"]');
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(300);

    // Check selected count via Fabric.js
    const selectedCount = await page.evaluate(() => {
      const canvas = (window as any).__TEST_FABRIC;
      return canvas ? canvas.getActiveObjects().length : 0;
    });
    expect(selectedCount).toBe(2);
  });

  test('multi-select delete removes all selected', async ({ boardPage: page }) => {
    // Create second object — need to re-open shape menu
    await page.click('[aria-label="Shape (R)"]');
    await page.waitForSelector('[aria-label="Circle"]', { state: 'visible' });
    await page.click('[aria-label="Circle"]');
    await clickCanvas(page, 250, 0);
    await waitForObjectCount(page, 2);

    // Select all and delete
    await page.click('[aria-label="Select (V)"]');
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(200);
    await page.keyboard.press('Delete');
    await waitForObjectCount(page, 0);
  });

  test('paste preserves object properties', async ({ boardPage: page }) => {
    // Select, copy, paste
    await clickCanvas(page, 0, 0);
    await page.waitForTimeout(200);

    const before = await getCanvasObjects(page);
    const original = before[0];

    await page.keyboard.press('Control+c');
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+v');
    await waitForObjectCount(page, 2);

    const after = await getCanvasObjects(page);
    const pasted = after[1];

    // Properties should match
    expect(pasted.type).toBe(original.type);
    expect(pasted.fill).toBe(original.fill);
    expect(pasted.stroke).toBe(original.stroke);
    expect(pasted.width).toBe(original.width);
    expect(pasted.height).toBe(original.height);
  });
});
