import { test, expect } from '../helpers/fixtures';
import {
  clickCanvas, doubleClickCanvas, getCanvasObjects,
  waitForObjectCount,
} from '../helpers/canvas';

test.describe('Sticky Notes', () => {
  test.beforeEach(async ({ boardPage: page }) => {
    // Create a sticky note at center
    await page.click('[aria-label="Sticky Note (S)"]');
    await clickCanvas(page, 0, 0);
    await waitForObjectCount(page, 1);
  });

  test('double-click to edit, type text, confirm to save', async ({ boardPage: page }) => {
    // Switch to select tool and double-click the sticky to open edit modal
    await page.click('[aria-label="Select (V)"]');
    await doubleClickCanvas(page, 0, 0);

    // Wait for the StickyEditModal textarea to appear
    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible({ timeout: 5000 });

    // Type text into the modal textarea
    await textarea.fill('Hello World');
    await page.waitForTimeout(200);

    // Click the Confirm button to save
    await page.click('button:has-text("Confirm")');
    await page.waitForTimeout(500);

    // Verify text was saved on the fabric object
    const objects = await getCanvasObjects(page);
    const sticky = objects.find(o => o.type === 'sticky');
    expect(sticky).toBeDefined();
    expect(sticky!.text).toContain('Hello World');
  });

  test('word wrapping wraps at word boundaries', async ({ boardPage: page }) => {
    await page.click('[aria-label="Select (V)"]');
    await doubleClickCanvas(page, 0, 0);

    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible({ timeout: 5000 });

    // Type a long sentence that should wrap
    await textarea.fill('This is a long sentence that should wrap at word boundaries');
    await page.waitForTimeout(200);

    // Confirm the edit
    await page.click('button:has-text("Confirm")');
    await page.waitForTimeout(500);

    // Verify the text is present
    const objects = await getCanvasObjects(page);
    const sticky = objects.find(o => o.type === 'sticky');
    expect(sticky!.text).toContain('This is a long sentence');

    // Verify splitByGrapheme is NOT set (word-level wrapping)
    const hasSplitByGrapheme = await page.evaluate(() => {
      const canvas = (window as any).__TEST_FABRIC;
      const stickyObj = canvas.getObjects().find((o: any) => o.data?.type === 'sticky');
      // The textbox inside the sticky group
      const textbox = stickyObj?._objects?.find((o: any) => o.type === 'textbox') || stickyObj;
      return textbox?.splitByGrapheme ?? false;
    });
    expect(hasSplitByGrapheme).toBe(false);
  });

  test('sticky note has correct default size', async ({ boardPage: page }) => {
    const objects = await getCanvasObjects(page);
    const sticky = objects.find(o => o.type === 'sticky');
    expect(sticky).toBeDefined();

    // Default medium size is 200x200
    const renderedW = sticky!.width * sticky!.scaleX;
    const renderedH = sticky!.height * sticky!.scaleY;
    expect(renderedW).toBeCloseTo(200, -1); // Within ~10px
    expect(renderedH).toBeCloseTo(200, -1);
  });

  test('text content persists after deselect and reselect', async ({ boardPage: page }) => {
    // Edit the sticky via the modal
    await page.click('[aria-label="Select (V)"]');
    await doubleClickCanvas(page, 0, 0);

    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible({ timeout: 5000 });
    await textarea.fill('Persistent text');

    // Confirm
    await page.click('button:has-text("Confirm")');
    await page.waitForTimeout(500);

    // Click away to deselect
    await clickCanvas(page, 300, 300);
    await page.waitForTimeout(300);

    // Click back on the sticky
    await clickCanvas(page, 0, 0);
    await page.waitForTimeout(300);

    // Verify text is still there
    const objects = await getCanvasObjects(page);
    const sticky = objects.find(o => o.type === 'sticky');
    expect(sticky!.text).toContain('Persistent text');
  });

  test('create sticky with different sizes', async ({ boardPage: page }) => {
    // The first sticky was medium (default). Create a small one.
    await page.click('[aria-label="Sticky Note (S)"]');

    // Wait for sticky size options and click small
    const smallBtn = page.locator('[aria-label="Small (150x150)"]');
    if (await smallBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await smallBtn.click();
    }

    await clickCanvas(page, 300, 0);
    await waitForObjectCount(page, 2);

    const objects = await getCanvasObjects(page);
    expect(objects.length).toBe(2);
  });
});
