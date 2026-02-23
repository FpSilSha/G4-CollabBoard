import { apiRequest, TEST_USER_1, type TestUser } from './auth';

/**
 * Board management helpers for test setup/teardown.
 * Uses the REST API with test auth tokens.
 */

export interface TestBoard {
  id: string;
  title: string;
  slot: number;
}

/**
 * Create a new board via API. Returns the board object.
 */
export async function createBoard(
  title = 'E2E Test Board',
  user: TestUser = TEST_USER_1
): Promise<TestBoard> {
  const res = await apiRequest('POST', '/boards', user, { title });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to create board: ${res.status} ${body}`);
  }
  const data = await res.json();
  return { id: data.id, title: data.title, slot: data.slot };
}

/**
 * Delete a board via API.
 */
export async function deleteBoard(
  boardId: string,
  user: TestUser = TEST_USER_1
): Promise<void> {
  const res = await apiRequest('DELETE', `/boards/${boardId}`, user);
  // 200 = deleted, 404 = already gone — both are fine in teardown
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to delete board: ${res.status}`);
  }
}

/**
 * List all boards for a user.
 */
export async function listBoards(
  user: TestUser = TEST_USER_1
): Promise<TestBoard[]> {
  const res = await apiRequest('GET', '/boards', user);
  if (!res.ok) {
    throw new Error(`Failed to list boards: ${res.status}`);
  }
  const data = await res.json();
  // API returns { ownedBoards: [...], linkedBoards: [...] }
  const owned = data.ownedBoards || [];
  const linked = data.linkedBoards || [];
  return [...owned, ...linked];
}

/**
 * Delete all boards for a user (cleanup helper).
 */
export async function deleteAllBoards(
  user: TestUser = TEST_USER_1
): Promise<void> {
  const boards = await listBoards(user);
  for (const board of boards) {
    await deleteBoard(board.id, user);
  }
}
