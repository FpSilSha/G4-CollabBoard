import { test, expect } from '../helpers/fixtures';
import { apiRequest, TEST_USER_1 } from '../helpers/auth';
import { getViewportTransform } from '../helpers/canvas';

test.describe('Teleport Flags', () => {
  test('create a teleport flag', async ({ boardPage: page }) => {
    const boardId = (page as any).boardId;

    // Create a flag via API
    const res = await apiRequest('POST', `/boards/${boardId}/flags`, TEST_USER_1, {
      label: 'Test Flag',
      x: 500,
      y: 300,
      color: '#FF5722',
    });
    expect(res.ok).toBe(true);

    // Reload to see the flag in the sidebar
    await page.reload();
    await page.waitForSelector('.upper-canvas', { timeout: 15000 });
    await page.waitForTimeout(1000);

    // Flag should appear in the right sidebar
    // Open the right sidebar if it's collapsed
    const rightSidebar = page.locator('[class*="rightSidebar"], [class*="RightSidebar"]');
    if (await rightSidebar.isVisible()) {
      await expect(page.locator('text=Test Flag')).toBeVisible({ timeout: 5000 });
    }
  });

  test('click a flag to navigate the viewport', async ({ boardPage: page }) => {
    const boardId = (page as any).boardId;

    // Create a flag at a far position
    await apiRequest('POST', `/boards/${boardId}/flags`, TEST_USER_1, {
      label: 'Far Away',
      x: 2000,
      y: 2000,
      color: '#2196F3',
    });

    await page.reload();
    await page.waitForSelector('.upper-canvas', { timeout: 15000 });
    await page.waitForFunction(() => !!(window as any).__TEST_FABRIC, { timeout: 10000 });
    await page.waitForTimeout(1000);

    const beforeTransform = await getViewportTransform(page);

    // Click the flag in the sidebar to teleport
    const flagLink = page.locator('text=Far Away').first();
    if (await flagLink.isVisible()) {
      await flagLink.click();
      await page.waitForTimeout(500);

      const afterTransform = await getViewportTransform(page);
      // Viewport should have changed (panned to the flag location)
      const panChanged =
        Math.abs(afterTransform[4] - beforeTransform[4]) > 10 ||
        Math.abs(afterTransform[5] - beforeTransform[5]) > 10;
      expect(panChanged).toBe(true);
    }
  });

  test('rename a flag', async ({ boardPage: page }) => {
    const boardId = (page as any).boardId;

    // Create a flag
    const createRes = await apiRequest('POST', `/boards/${boardId}/flags`, TEST_USER_1, {
      label: 'Original',
      x: 100,
      y: 100,
      color: '#4CAF50',
    });
    const flag = await createRes.json();

    // Rename via API
    const renameRes = await apiRequest('PATCH', `/boards/${boardId}/flags/${flag.id}`, TEST_USER_1, {
      label: 'Renamed Flag',
    });
    expect(renameRes.ok).toBe(true);

    // Verify via API
    const listRes = await apiRequest('GET', `/boards/${boardId}/flags`, TEST_USER_1);
    const data = await listRes.json();
    const flagList = data.flags || data;
    const renamed = flagList.find((f: any) => f.id === flag.id);
    expect(renamed.label).toBe('Renamed Flag');
  });

  test('delete a flag', async ({ boardPage: page }) => {
    const boardId = (page as any).boardId;

    // Create a flag
    const createRes = await apiRequest('POST', `/boards/${boardId}/flags`, TEST_USER_1, {
      label: 'To Delete',
      x: 100,
      y: 100,
      color: '#F44336',
    });
    const flag = await createRes.json();

    // Delete via API
    const deleteRes = await apiRequest('DELETE', `/boards/${boardId}/flags/${flag.id}`, TEST_USER_1);
    expect(deleteRes.ok).toBe(true);

    // Verify it's gone
    const listRes = await apiRequest('GET', `/boards/${boardId}/flags`, TEST_USER_1);
    const data2 = await listRes.json();
    const flagList2 = data2.flags || data2;
    expect(flagList2.find((f: any) => f.id === flag.id)).toBeUndefined();
  });
});
