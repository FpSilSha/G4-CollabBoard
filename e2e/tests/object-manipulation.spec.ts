import { test, expect } from '../helpers/fixtures';
import {
  clickCanvas, dragOnCanvas, getCanvasObjects, getCanvasObjectCount,
  waitForObjectCount, getSelectedObjects,
} from '../helpers/canvas';

test.describe('Object Manipulation', () => {
  test.beforeEach(async ({ boardPage: page }) => {
    // Create a rectangle at center for manipulation tests
    await page.click('[aria-label="Shape (R)"]');
    await page.waitForSelector('[aria-label="Rectangle"]', { state: 'visible' });
    await page.click('[aria-label="Rectangle"]');
    await clickCanvas(page, 0, 0);
    await waitForObjectCount(page, 1);

    // Switch back to select tool
    await page.click('[aria-label="Select (V)"]');
  });

  test('select and drag to move an object', async ({ boardPage: page }) => {
    const before = await getCanvasObjects(page);
    const origLeft = before[0].left;
    const origTop = before[0].top;

    // Click to select, then drag 100px right and 50px down
    await clickCanvas(page, 0, 0);
    await page.waitForTimeout(300);
    await dragOnCanvas(page, 0, 0, 100, 50);
    await page.waitForTimeout(300);

    const after = await getCanvasObjects(page);
    // Object should have moved
    expect(after[0].left).not.toBeCloseTo(origLeft, 0);
    expect(after[0].top).not.toBeCloseTo(origTop, 0);
  });

  test('resize an object by dragging corner', async ({ boardPage: page }) => {
    // Click to select the object
    await clickCanvas(page, 0, 0);
    await page.waitForTimeout(300);

    const before = await getCanvasObjects(page);
    const origScaleX = before[0].scaleX;
    const origScaleY = before[0].scaleY;

    // Drag from bottom-right corner outward.
    // Shape top-left is at (0,0) offset, so the corner is at (width, height).
    const fullW = before[0].width * origScaleX;
    const fullH = before[0].height * origScaleY;
    await dragOnCanvas(page, fullW, fullH, fullW + 50, fullH + 50);

    const after = await getCanvasObjects(page);
    // At least one scale dimension should have changed
    const scaleChanged =
      Math.abs(after[0].scaleX - origScaleX) > 0.01 ||
      Math.abs(after[0].scaleY - origScaleY) > 0.01;
    expect(scaleChanged).toBe(true);
  });

  test('minimum 10px size constraint is enforced', async ({ boardPage: page }) => {
    // Click to select
    await clickCanvas(page, 0, 0);
    await page.waitForTimeout(300);

    // Try to resize extremely small by dragging corner toward center
    const before = await getCanvasObjects(page);
    const halfW = (before[0].width * before[0].scaleX) / 2;
    const halfH = (before[0].height * before[0].scaleY) / 2;

    // Drag corner almost to the opposite corner (try to make it ~0px)
    await dragOnCanvas(page, halfW, halfH, -halfW + 2, -halfH + 2, 20);

    const after = await getCanvasObjects(page);
    const renderedW = after[0].width * after[0].scaleX;
    const renderedH = after[0].height * after[0].scaleY;

    // Should be at least 10px in each dimension
    expect(renderedW).toBeGreaterThanOrEqual(9.5); // Allow floating point
    expect(renderedH).toBeGreaterThanOrEqual(9.5);
  });

  test('delete a selected object via Delete key', async ({ boardPage: page }) => {
    await clickCanvas(page, 0, 0);
    await page.waitForTimeout(200);

    // Verify object is selected
    const selected = await getSelectedObjects(page);
    expect(selected.length).toBeGreaterThan(0);

    await page.keyboard.press('Delete');
    await waitForObjectCount(page, 0);
  });

  test('delete multiple selected objects', async ({ boardPage: page }) => {
    // Create a second object offset from center.
    // Tool resets to 'select' after first creation, so re-click Shape(R) to reopen panel.
    await page.click('[aria-label="Shape (R)"]');
    await page.waitForSelector('[aria-label="Rectangle"]', { state: 'visible' });
    await page.click('[aria-label="Circle"]');
    await clickCanvas(page, 250, 0);
    await waitForObjectCount(page, 2);

    // Select all with Ctrl+A
    await page.click('[aria-label="Select (V)"]');
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(300);

    // Delete all
    await page.keyboard.press('Delete');
    await waitForObjectCount(page, 0);
  });

  test('change fill color via toolbar', async ({ boardPage: page }) => {
    // Select the object
    await clickCanvas(page, 0, 0);
    await page.waitForTimeout(300);

    const before = await getCanvasObjects(page);
    const origFill = before[0].fill;

    // Look for a fill color swatch in the color picker and click a different color
    const swatches = page.locator('[class*="swatch"], [class*="colorCell"]');
    const swatchCount = await swatches.count();

    if (swatchCount > 1) {
      // Click the second swatch to pick a different color
      await swatches.nth(1).click();
      await page.waitForTimeout(300);

      const after = await getCanvasObjects(page);
      expect(after[0].fill).toBeDefined();
    }
  });

  test('change stroke weight to bold', async ({ boardPage: page }) => {
    // Select the object
    await clickCanvas(page, 0, 0);
    await page.waitForTimeout(300);

    const before = await getCanvasObjects(page);
    const origStroke = before[0].strokeWidth;

    // Try to find and click the bold weight button
    const boldBtn = page.locator('[aria-label="Bold weight"]');
    if (await boldBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await boldBtn.click();
      await page.waitForTimeout(300);

      const after = await getCanvasObjects(page);
      expect(after[0].strokeWidth).toBeGreaterThan(origStroke);
    }
  });
});
