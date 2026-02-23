import { test as base, expect, type Page } from '@playwright/test';
import { createBoard, deleteBoard, deleteAllBoards } from './board';
import { TEST_USER_1, TEST_USER_2, type TestUser } from './auth';

/**
 * Custom Playwright fixtures for NoteTime E2E tests.
 */

interface NoteTimeFixtures {
  /** Page navigated to the dashboard (past auth gate) */
  authenticatedPage: Page;

  /** Page navigated to a fresh board, cleaned up after the test */
  boardPage: Page & { boardId: string };
}

export const test = base.extend<NoteTimeFixtures>({
  /**
   * Authenticated page — lands on the dashboard.
   * Auth is bypassed via VITE_TEST_MODE=true.
   */
  authenticatedPage: async ({ page }, use) => {
    // Clean up any leftover boards from previous test runs
    await deleteAllBoards(TEST_USER_1);

    // Navigate to dashboard
    await page.goto('/');
    // Wait for the dashboard to load
    await page.waitForSelector('h1:has-text("NoteTime")', { timeout: 15000 });
    await use(page);
  },

  /**
   * Board page — creates a fresh board, navigates to it, and cleans up after.
   * The boardId is available as boardPage.boardId.
   */
  boardPage: async ({ page }, use) => {
    // Clean up leftover boards
    await deleteAllBoards(TEST_USER_1);

    // Create a fresh board via API
    const board = await createBoard('E2E Test Board');

    // Navigate to the board
    await page.goto(`/board/${board.id}`);

    // Wait for the canvas to be ready
    await page.waitForSelector('.upper-canvas', { timeout: 15000 });

    // Wait for the __TEST_FABRIC bridge to be available
    await page.waitForFunction(
      () => !!(window as any).__TEST_FABRIC,
      { timeout: 10000 }
    );

    // Small delay for canvas to fully initialize
    await page.waitForTimeout(500);

    // Attach boardId to the page object for test access
    (page as any).boardId = board.id;

    await use(page as Page & { boardId: string });

    // Teardown: delete the board
    await deleteBoard(board.id);
  },
});

export { expect };
