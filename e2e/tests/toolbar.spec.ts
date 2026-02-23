import { test, expect } from '../helpers/fixtures';

test.describe('Toolbar', () => {
  test('clicking shape tool shows active state', async ({ boardPage: page }) => {
    const shapeBtn = page.locator('[aria-label="Shape (R)"]');
    await shapeBtn.click();
    await expect(shapeBtn).toHaveClass(/active/);
  });

  test('shape options panel appears when shape tool is selected', async ({ boardPage: page }) => {
    await page.click('[aria-label="Shape (R)"]');
    await page.waitForTimeout(300);

    // Shape sub-buttons should be visible
    await expect(page.locator('[aria-label="Rectangle"]')).toBeVisible();
    await expect(page.locator('[aria-label="Circle"]')).toBeVisible();
    await expect(page.locator('[aria-label="Triangle"]')).toBeVisible();
  });

  test('switching between tools updates active state', async ({ boardPage: page }) => {
    // Click sticky tool
    const stickyBtn = page.locator('[aria-label="Sticky Note (S)"]');
    await stickyBtn.click();
    await expect(stickyBtn).toHaveClass(/active/);

    // Click text tool — sticky should lose active
    const textBtn = page.locator('[aria-label="Text (T)"]');
    await textBtn.click();
    await expect(textBtn).toHaveClass(/active/);
    await expect(stickyBtn).not.toHaveClass(/active/);

    // Click select tool — text should lose active
    const selectBtn = page.locator('[aria-label="Select (V)"]');
    await selectBtn.click();
    await expect(selectBtn).toHaveClass(/active/);
    await expect(textBtn).not.toHaveClass(/active/);
  });

  test('line options panel appears when line tool is selected', async ({ boardPage: page }) => {
    await page.click('[aria-label="Line (N)"]');
    await page.waitForTimeout(300);

    // Line endpoint buttons should appear
    await expect(page.locator('[aria-label="No arrowheads"]')).toBeVisible();
    await expect(page.locator('[aria-label="Arrow at end"]')).toBeVisible();
  });

  test('shape sub-tool buttons switch correctly', async ({ boardPage: page }) => {
    await page.click('[aria-label="Shape (R)"]');
    await page.waitForSelector('[aria-label="Circle"]', { state: 'visible' });

    // Click circle
    const circleBtn = page.locator('[aria-label="Circle"]');
    await circleBtn.click();
    await expect(circleBtn).toHaveClass(/active/);

    // Click star
    const starBtn = page.locator('[aria-label="Star"]');
    await starBtn.click();
    await expect(starBtn).toHaveClass(/active/);
    await expect(circleBtn).not.toHaveClass(/active/);
  });
});
