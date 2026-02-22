/**
 * Test data factories for backend unit tests.
 * Creates realistic mock objects matching production shapes.
 */
import { vi } from 'vitest';

// ─── Board ───────────────────────────────────────────────────────────────────
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

export function makeBoard(overrides: Record<string, unknown> = {}) {
  return {
    id: 'board-' + Math.random().toString(36).slice(2, 8),
    title: 'Test Board',
    ownerId: 'user-1',
    slot: 0,
    isDeleted: false,
    objects: [],
    thumbnail: null,
    version: 1,
    thumbnailVersion: -1,
    thumbnailUpdatedAt: null,
    lastAccessedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function makeCachedBoardState(overrides: Record<string, unknown> = {}) {
  return {
    boardId: 'board-test',
    objects: [] as ReturnType<typeof makeBoardObject>[],
    version: 1,
    lastSavedAt: Date.now(),
    ...overrides,
  };
}

// ─── Express req/res mocks ───────────────────────────────────────────────────
export function makeReq(overrides: Record<string, unknown> = {}) {
  return {
    params: {},
    body: {},
    query: {},
    headers: {},
    user: { sub: 'auth0|user-1', name: 'Test User', email: 'test@example.com' },
    ...overrides,
  } as unknown as import('express').Request;
}

export function makeRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    getHeader: vi.fn(),
  };
  return res as unknown as import('express').Response;
}

export function makeNext() {
  return vi.fn() as unknown as import('express').NextFunction;
}

// ─── Socket.io mocks ─────────────────────────────────────────────────────────
export function makeSocket(overrides: Record<string, unknown> = {}) {
  return {
    id: 'socket-' + Math.random().toString(36).slice(2, 8),
    join: vi.fn(),
    leave: vi.fn(),
    emit: vi.fn(),
    to: vi.fn(() => ({ emit: vi.fn() })),
    on: vi.fn(),
    off: vi.fn(),
    disconnect: vi.fn(),
    rooms: new Set<string>(),
    data: {
      userId: 'user-1',
      userName: 'Test User',
      userColor: '#FF0000',
      boardId: 'board-test',
    },
    ...overrides,
  };
}

export function makeIO() {
  return {
    to: vi.fn(() => ({ emit: vi.fn() })),
    emit: vi.fn(),
    sockets: { sockets: new Map() },
  };
}

// ─── AI mocks ────────────────────────────────────────────────────────────────
export function makeAIMessage(overrides: Record<string, unknown> = {}) {
  return {
    role: 'assistant' as const,
    content: [{ type: 'text', text: 'I created 2 sticky notes.' }],
    usage: { input_tokens: 100, output_tokens: 50 },
    stop_reason: 'end_turn',
    model: 'claude-haiku-4-5-20241022',
    ...overrides,
  };
}
