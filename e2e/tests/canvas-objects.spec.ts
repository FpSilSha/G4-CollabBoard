import { test, expect } from '../helpers/fixtures';
import { clickCanvas, getCanvasObjectCount, getCanvasObjects, waitForObjectCount } from '../helpers/canvas';

test.describe('Canvas Object Creation', () => {
  test('create a rectangle', async ({ boardPage: page }) => {
    // Select Shape tool (default is rectangle), then click Rectangle in sub-menu
    await page.click('[aria-label="Shape (R)"]');
    await page.waitForSelector('[aria-label="Rectangle"]', { state: 'visible' });
    await page.click('[aria-label="Rectangle"]');

    // Click on canvas to create
    await clickCanvas(page, 0, 0);
    await waitForObjectCount(page, 1);

    const objects = await getCanvasObjects(page);
    expect(objects[0].type).toBe('shape');
    expect(objects[0].shapeType).toBe('rectangle');
  });

  test('create a circle', async ({ boardPage: page }) => {
    await page.click('[aria-label="Shape (R)"]');
    await page.waitForSelector('[aria-label="Circle"]', { state: 'visible' });
    await page.click('[aria-label="Circle"]');

    await clickCanvas(page, 0, 0);
    await waitForObjectCount(page, 1);

    const objects = await getCanvasObjects(page);
    expect(objects[0].type).toBe('shape');
    expect(objects[0].shapeType).toBe('circle');
  });

  test('create a triangle', async ({ boardPage: page }) => {
    await page.click('[aria-label="Shape (R)"]');
    await page.waitForSelector('[aria-label="Triangle"]', { state: 'visible' });
    await page.click('[aria-label="Triangle"]');

    await clickCanvas(page, 0, 0);
    await waitForObjectCount(page, 1);

    const objects = await getCanvasObjects(page);
    expect(objects[0].type).toBe('shape');
    expect(objects[0].shapeType).toBe('triangle');
  });

  test('create a star', async ({ boardPage: page }) => {
    await page.click('[aria-label="Shape (R)"]');
    await page.waitForSelector('[aria-label="Star"]', { state: 'visible' });
    await page.click('[aria-label="Star"]');

    await clickCanvas(page, 0, 0);
    await waitForObjectCount(page, 1);

    const objects = await getCanvasObjects(page);
    expect(objects[0].type).toBe('shape');
    expect(objects[0].shapeType).toBe('star');
  });

  test('create an arrow shape', async ({ boardPage: page }) => {
    await page.click('[aria-label="Shape (R)"]');
    await page.waitForSelector('[aria-label="Arrow"]', { state: 'visible' });
    await page.click('[aria-label="Arrow"]');

    await clickCanvas(page, 0, 0);
    await waitForObjectCount(page, 1);

    const objects = await getCanvasObjects(page);
    expect(objects[0].type).toBe('shape');
    expect(objects[0].shapeType).toBe('arrow');
  });

  test('create a diamond', async ({ boardPage: page }) => {
    await page.click('[aria-label="Shape (R)"]');
    await page.waitForSelector('[aria-label="Diamond"]', { state: 'visible' });
    await page.click('[aria-label="Diamond"]');

    await clickCanvas(page, 0, 0);
    await waitForObjectCount(page, 1);

    const objects = await getCanvasObjects(page);
    expect(objects[0].type).toBe('shape');
    expect(objects[0].shapeType).toBe('diamond');
  });

  test('create a sticky note', async ({ boardPage: page }) => {
    await page.click('[aria-label="Sticky Note (S)"]');

    await clickCanvas(page, 0, 0);
    await waitForObjectCount(page, 1);

    const objects = await getCanvasObjects(page);
    expect(objects[0].type).toBe('sticky');
  });

  test('create a text element', async ({ boardPage: page }) => {
    await page.click('[aria-label="Text (T)"]');

    await clickCanvas(page, 0, 0);
    await waitForObjectCount(page, 1);

    const objects = await getCanvasObjects(page);
    expect(objects[0].type).toBe('text');
  });
});
