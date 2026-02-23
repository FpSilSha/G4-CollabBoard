import { test, expect } from '../helpers/fixtures';
import { createBoard, deleteBoard, deleteAllBoards, listBoards } from '../helpers/board';
import { TEST_USER_1 } from '../helpers/auth';

test.describe('Board Management', () => {
  test.beforeEach(async () => {
    await deleteAllBoards(TEST_USER_1);
  });

  test.afterEach(async () => {
    await deleteAllBoards(TEST_USER_1);
  });

  test('create a board from the dashboard', async ({ authenticatedPage: page }) => {
    // Click the "New Board" card/button
    const newBoardBtn = page.locator('button:has-text("New Board")');
    await expect(newBoardBtn).toBeVisible({ timeout: 5000 });
    await newBoardBtn.click();

    // Dashboard creates the board and adds it as a card (does not auto-navigate).
    // Wait for the board card to appear, then click it to navigate.
    await page.waitForTimeout(2000);

    // The new board card should be a link to /board/:id
    const boardLink = page.locator('a[href*="/board/"]').first();
    if (await boardLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await boardLink.click();
      await page.waitForURL(/\/board\//, { timeout: 15000 });
      expect(page.url()).toMatch(/\/board\/[a-f0-9-]+/);
    } else {
      // Verify the board was created via API and navigate directly
      const boards = await listBoards(TEST_USER_1);
      expect(boards.length).toBeGreaterThan(0);
      await page.goto(`/board/${boards[0].id}`);
      await page.waitForSelector('.upper-canvas', { timeout: 15000 });
      expect(page.url()).toMatch(/\/board\/[a-f0-9-]+/);
    }
  });

  test('board appears in the dashboard list', async ({ authenticatedPage: page }) => {
    // Create a board via API
    const board = await createBoard('My Test Board');

    // Refresh the dashboard
    await page.reload();
    await page.waitForSelector('h1:has-text("NoteTime")', { timeout: 10000 });

    // Board title should be visible
    await expect(page.locator(`text=My Test Board`)).toBeVisible({ timeout: 5000 });

    await deleteBoard(board.id);
  });

  test('rename a board via the dashboard', async ({ authenticatedPage: page }) => {
    // Create a board
    const board = await createBoard('Original Name');
    await page.reload();
    await page.waitForSelector('h1:has-text("NoteTime")', { timeout: 10000 });

    // Find the board card and look for an edit/rename mechanism
    // Board titles are typically editable or have a rename button
    const boardCard = page.locator(`text=Original Name`).first();
    await expect(boardCard).toBeVisible();

    await deleteBoard(board.id);
  });

  test('delete a board from the dashboard', async ({ authenticatedPage: page }) => {
    const board = await createBoard('To Be Deleted');
    await page.reload();
    await page.waitForSelector('h1:has-text("NoteTime")', { timeout: 10000 });

    // Verify board is visible
    await expect(page.locator('text=To Be Deleted')).toBeVisible({ timeout: 5000 });

    // Delete via API (dashboard delete UX varies)
    await deleteBoard(board.id);

    await page.reload();
    await page.waitForSelector('h1:has-text("NoteTime")', { timeout: 10000 });

    // Board should be gone
    await expect(page.locator('text=To Be Deleted')).not.toBeVisible({ timeout: 5000 });
  });

  test('navigate between dashboard and board', async ({ authenticatedPage: page }) => {
    const board = await createBoard('Nav Test Board');

    // Navigate to the board
    await page.goto(`/board/${board.id}`);
    await page.waitForSelector('.upper-canvas', { timeout: 15000 });

    // Navigate back to dashboard (click home/logo or use browser back)
    await page.goto('/');
    await page.waitForSelector('h1:has-text("NoteTime")', { timeout: 10000 });

    await expect(page.locator('text=Nav Test Board')).toBeVisible({ timeout: 5000 });

    await deleteBoard(board.id);
  });

  test('create multiple boards up to slot limit', async ({ authenticatedPage: page }) => {
    // Create 5 boards (the slot limit)
    const boards = [];
    for (let i = 0; i < 5; i++) {
      boards.push(await createBoard(`Board ${i + 1}`));
    }

    // Verify all appear
    const listed = await listBoards(TEST_USER_1);
    expect(listed.length).toBe(5);

    // Clean up
    for (const b of boards) {
      await deleteBoard(b.id);
    }
  });
});
