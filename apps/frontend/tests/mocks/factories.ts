/**
 * Test data factories for frontend unit tests.
 */

export function makeBoardObject(overrides: Record<string, unknown> = {}) {
  return {
    id: 'obj-' + Math.random().toString(36).slice(2, 8),
    type: 'sticky' as const,
    x: 100,
    y: 100,
    width: 200,
    height: 200,
    color: '#FFEB3B',
    text: 'Test sticky',
    frameId: null,
    locked: false,
    createdBy: 'user-1',
    lastEditedBy: 'user-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
    ...overrides,
  };
}

export function makeRemoteCursor(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'user-2',
    name: 'Remote User',
    color: '#FF0000',
    x: 500,
    y: 300,
    lastUpdate: Date.now(),
    ...overrides,
  };
}

export function makeBoardUserInfo(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'user-2',
    name: 'Remote User',
    color: '#FF0000',
    avatar: 'R',
    ...overrides,
  };
}
