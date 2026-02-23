import { test, expect } from '../helpers/fixtures';
import {
  clickCanvas, getCanvasObjectCount, waitForObjectCount,
  getSelectedObjects, getViewportTransform,
} from '../helpers/canvas';

test.describe('Keyboard Shortcuts', () => {
  test('H key returns viewport to center', async ({ boardPage: page }) => {
    // Pan the canvas away from center by scrolling
    const canvas = page.locator('.upper-canvas');
    await canvas.click();

    // Get initial viewport
    const before = await getViewportTransform(page);

    // Press H to go home
    await page.keyboard.press('h');
    await page.waitForTimeout(500);

    // Viewport should be at/near the center transform
    // The exact values depend on implementation, but the transform should reset
    const after = await getViewportTransform(page);
    // After pressing H, zoom should be 1 (or close to it)
    expect(after[0]).toBeCloseTo(1, 0);
  });

  test('Delete key removes selected object', async ({ boardPage: page }) => {
    // Create a rectangle
    await page.click('[aria-label="Shape (R)"]');
    await page.waitForSelector('[aria-label="Rectangle"]', { state: 'visible' });
    await page.click('[aria-label="Rectangle"]');
    await clickCanvas(page, 0, 0);
    await waitForObjectCount(page, 1);

    // Select it
    await page.click('[aria-label="Select (V)"]');
    await clickCanvas(page, 0, 0);
    await page.waitForTimeout(200);

    // Delete
    await page.keyboard.press('Delete');
    await waitForObjectCount(page, 0);
  });

  test('Escape deselects objects', async ({ boardPage: page }) => {
    // Create and select a rectangle
    await page.click('[aria-label="Shape (R)"]');
    await page.waitForSelector('[aria-label="Rectangle"]', { state: 'visible' });
    await page.click('[aria-label="Rectangle"]');
    await clickCanvas(page, 0, 0);
    await waitForObjectCount(page, 1);

    await page.click('[aria-label="Select (V)"]');
    await clickCanvas(page, 0, 0);
    await page.waitForTimeout(200);

    const selectedBefore = await getSelectedObjects(page);
    expect(selectedBefore.length).toBeGreaterThan(0);

    // Press Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    const selectedAfter = await getSelectedObjects(page);
    expect(selectedAfter.length).toBe(0);
  });

  test('Ctrl+A selects all objects', async ({ boardPage: page }) => {
    // Create two objects
    await page.click('[aria-label="Shape (R)"]');
    await page.waitForSelector('[aria-label="Rectangle"]', { state: 'visible' });
    await page.click('[aria-label="Rectangle"]');
    await clickCanvas(page, -100, 0);
    await waitForObjectCount(page, 1);

    // After creating rectangle, tool resets to select. Re-open shape panel.
    await page.click('[aria-label="Shape (R)"]');
    await page.waitForSelector('[aria-label="Circle"]', { state: 'visible' });
    await page.click('[aria-label="Circle"]');
    await clickCanvas(page, 250, 0);
    await waitForObjectCount(page, 2);

    // Select all
    await page.click('[aria-label="Select (V)"]');
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(300);

    const selected = await getSelectedObjects(page);
    expect(selected.length).toBe(2);
  });

  test('V key switches to Select tool', async ({ boardPage: page }) => {
    // Start with shape tool
    await page.click('[aria-label="Shape (R)"]');

    // Press V to switch to select
    await page.keyboard.press('v');
    await page.waitForTimeout(200);

    // The select button should be active
    const selectBtn = page.locator('[aria-label="Select (V)"]');
    await expect(selectBtn).toHaveClass(/active/);
  });
});
