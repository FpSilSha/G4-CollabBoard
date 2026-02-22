import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeSocket, makeIO } from '../mocks/factories';
import { WebSocketEvent } from 'shared';

// ─── Service mocks ────────────────────────────────────────────────────────────

vi.mock('../../src/websocket/wsMetrics', () => ({
  trackedEmit: vi.fn(),
  trackedVolatileEmit: vi.fn(),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { registerCursorHandlers } from '../../src/websocket/handlers/cursorHandler';
import { trackedVolatileEmit } from '../../src/websocket/wsMetrics';

// ─── Constants ────────────────────────────────────────────────────────────────

const BOARD_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = 'user-1';

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeJoinedSocket() {
  return makeSocket({
    data: {
      userId: USER_ID,
      userName: 'Test User',
      currentBoardId: BOARD_ID,
    },
  });
}

function setupHandler(socket: ReturnType<typeof makeSocket>) {
  const io = makeIO();
  registerCursorHandlers(io as any, socket as any);
  return function getHandler(event: string): (...args: unknown[]) => void {
    const calls = vi.mocked(socket.on).mock.calls;
    const found = calls.find(([ev]) => ev === event);
    if (!found) throw new Error(`No handler for "${event}"`);
    return found[1] as (...args: unknown[]) => void;
  };
}

function makeMovedPayload(overrides: Record<string, unknown> = {}) {
  return {
    boardId: BOARD_ID,
    x: 123.5,
    y: 456.7,
    timestamp: Date.now(),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('cursorHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('cursor:move', () => {
    it('calls trackedVolatileEmit with correct payload on valid cursor:move', () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);

      getHandler(WebSocketEvent.CURSOR_MOVE)(makeMovedPayload());

      expect(trackedVolatileEmit).toHaveBeenCalledWith(
        socket,
        BOARD_ID,
        WebSocketEvent.CURSOR_MOVED,
        expect.objectContaining({
          boardId: BOARD_ID,
          userId: USER_ID,
          x: 123.5,
          y: 456.7,
        })
      );
    });

    it('includes the timestamp from the payload in the broadcast', () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);
      const ts = 1700000000000;

      getHandler(WebSocketEvent.CURSOR_MOVE)(makeMovedPayload({ timestamp: ts }));

      const call = vi.mocked(trackedVolatileEmit).mock.calls[0];
      const payload = call[3] as Record<string, unknown>;
      expect(payload.timestamp).toBe(ts);
    });

    it('silently drops cursor:move when currentBoardId is undefined', () => {
      const socket = makeSocket({
        data: { userId: USER_ID, userName: 'Test User', currentBoardId: undefined },
      });
      const getHandler = setupHandler(socket);

      getHandler(WebSocketEvent.CURSOR_MOVE)(makeMovedPayload());

      expect(trackedVolatileEmit).not.toHaveBeenCalled();
    });

    it('silently drops cursor:move when boardId does not match currentBoardId', () => {
      const socket = makeSocket({
        data: { userId: USER_ID, userName: 'Test User', currentBoardId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
      });
      const getHandler = setupHandler(socket);

      // Payload boardId is BOARD_ID, socket is on a different board
      getHandler(WebSocketEvent.CURSOR_MOVE)(makeMovedPayload());

      expect(trackedVolatileEmit).not.toHaveBeenCalled();
    });

    it('silently drops cursor:move when payload is malformed (missing x)', () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);

      getHandler(WebSocketEvent.CURSOR_MOVE)({ boardId: BOARD_ID, y: 100, timestamp: Date.now() });

      expect(trackedVolatileEmit).not.toHaveBeenCalled();
    });

    it('silently drops cursor:move when boardId is not a valid UUID', () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);

      getHandler(WebSocketEvent.CURSOR_MOVE)({ boardId: 'not-a-uuid', x: 1, y: 2, timestamp: Date.now() });

      expect(trackedVolatileEmit).not.toHaveBeenCalled();
    });

    it('silently drops cursor:move when coordinates are out of allowed range', () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);

      // x exceeds max coordinate of 1,000,000
      getHandler(WebSocketEvent.CURSOR_MOVE)(makeMovedPayload({ x: 9999999 }));

      expect(trackedVolatileEmit).not.toHaveBeenCalled();
    });

    it('does not emit any board:error regardless of malformed payload', () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);

      getHandler(WebSocketEvent.CURSOR_MOVE)({ completely: 'wrong' });

      expect(socket.emit).not.toHaveBeenCalled();
    });

    it('registers exactly one cursor:move listener', () => {
      const socket = makeJoinedSocket();
      setupHandler(socket);

      const cursorCalls = vi.mocked(socket.on).mock.calls.filter(
        ([event]) => event === WebSocketEvent.CURSOR_MOVE
      );
      expect(cursorCalls).toHaveLength(1);
    });
  });
});
