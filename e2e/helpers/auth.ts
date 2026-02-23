/**
 * Test auth helpers.
 *
 * In test mode (NODE_ENV=test on backend, VITE_TEST_MODE=true on frontend),
 * auth is bypassed. The backend accepts any Bearer token as a synthetic user
 * identity: `test|<token>`. These helpers provide consistent test user tokens.
 */

const API_URL = 'http://localhost:3001';

export interface TestUser {
  token: string;
  sub: string;      // Auth0-style sub claim
  email: string;
  name: string;
}

/** Default test user (matches the hardcoded token in useSocket.ts test mode) */
export const TEST_USER_1: TestUser = {
  token: 'e2e-user-1',
  sub: 'test|e2e-user-1',
  email: 'e2e-user-1@test.local',
  name: 'Test User e2e-user-1',
};

/** Second test user for multi-user sync tests */
export const TEST_USER_2: TestUser = {
  token: 'e2e-user-2',
  sub: 'test|e2e-user-2',
  email: 'e2e-user-2@test.local',
  name: 'Test User e2e-user-2',
};

/**
 * Make an authenticated API request as a test user.
 */
export async function apiRequest(
  method: string,
  path: string,
  user: TestUser = TEST_USER_1,
  body?: unknown
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${user.token}`,
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  return fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
