import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeSocket, makeIO } from '../mocks/factories';
import { WebSocketEvent } from 'shared';

// ─── Service mocks ────────────────────────────────────────────────────────────

vi.mock('../../src/services/presenceService', () => ({
  presenceService: {
    refreshPresence: vi.fn(),
    addUser: vi.fn(),
    removeUser: vi.fn(),
    getBoardUsers: vi.fn(),
  },
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { registerPresenceHandlers } from '../../src/websocket/handlers/presenceHandler';
import { presenceService } from '../../src/services/presenceService';

// ─── Constants ────────────────────────────────────────────────────────────────

const BOARD_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = 'user-1';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  registerPresenceHandlers(io as any, socket as any);
  return function getHandler(event: string): (...args: unknown[]) => Promise<void> {
    const calls = vi.mocked(socket.on).mock.calls;
    const found = calls.find(([ev]) => ev === event);
    if (!found) throw new Error(`No handler for "${event}"`);
    return found[1] as (...args: unknown[]) => Promise<void>;
  };
}

function makeHeartbeatPayload(overrides: Record<string, unknown> = {}) {
  return {
    boardId: BOARD_ID,
    timestamp: Date.now(),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('presenceHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('heartbeat', () => {
    it('calls presenceService.refreshPresence with boardId and userId on valid heartbeat', async () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);
      vi.mocked(presenceService.refreshPresence).mockResolvedValue(undefined as any);

      await getHandler(WebSocketEvent.HEARTBEAT)(makeHeartbeatPayload());

      expect(presenceService.refreshPresence).toHaveBeenCalledWith(BOARD_ID, USER_ID);
    });

    it('silently drops heartbeat when boardId does not match currentBoardId', async () => {
      const socket = makeSocket({
        data: { userId: USER_ID, userName: 'Test User', currentBoardId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
      });
      const getHandler = setupHandler(socket);

      // Payload boardId is BOARD_ID but socket is on a different board
      await getHandler(WebSocketEvent.HEARTBEAT)(makeHeartbeatPayload());

      expect(presenceService.refreshPresence).not.toHaveBeenCalled();
    });

    it('silently drops heartbeat when currentBoardId is undefined', async () => {
      const socket = makeSocket({
        data: { userId: USER_ID, userName: 'Test User', currentBoardId: undefined },
      });
      const getHandler = setupHandler(socket);

      await getHandler(WebSocketEvent.HEARTBEAT)(makeHeartbeatPayload());

      expect(presenceService.refreshPresence).not.toHaveBeenCalled();
    });

    it('silently drops heartbeat when payload is malformed (missing boardId)', async () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);

      await getHandler(WebSocketEvent.HEARTBEAT)({ timestamp: Date.now() });

      expect(presenceService.refreshPresence).not.toHaveBeenCalled();
    });

    it('silently drops heartbeat when boardId is not a valid UUID', async () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);

      await getHandler(WebSocketEvent.HEARTBEAT)({ boardId: 'not-a-uuid', timestamp: Date.now() });

      expect(presenceService.refreshPresence).not.toHaveBeenCalled();
    });

    it('silently drops heartbeat when timestamp is missing', async () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);

      await getHandler(WebSocketEvent.HEARTBEAT)({ boardId: BOARD_ID });

      expect(presenceService.refreshPresence).not.toHaveBeenCalled();
    });

    it('does not emit any board:error regardless of malformed payload', async () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);

      await getHandler(WebSocketEvent.HEARTBEAT)({ completely: 'wrong' });

      expect(socket.emit).not.toHaveBeenCalled();
    });

    it('does not emit board:error when refreshPresence throws (logs error only)', async () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);
      vi.mocked(presenceService.refreshPresence).mockRejectedValue(new Error('Redis unavailable'));

      await expect(getHandler(WebSocketEvent.HEARTBEAT)(makeHeartbeatPayload())).resolves.toBeUndefined();

      expect(socket.emit).not.toHaveBeenCalled();
    });

    it('registers exactly one heartbeat listener', () => {
      const socket = makeJoinedSocket();
      setupHandler(socket);

      const heartbeatCalls = vi.mocked(socket.on).mock.calls.filter(
        ([event]) => event === WebSocketEvent.HEARTBEAT
      );
      expect(heartbeatCalls).toHaveLength(1);
    });

    it('accepts heartbeat when timestamp is a positive integer', async () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);
      vi.mocked(presenceService.refreshPresence).mockResolvedValue(undefined as any);

      await getHandler(WebSocketEvent.HEARTBEAT)({ boardId: BOARD_ID, timestamp: 1 });

      expect(presenceService.refreshPresence).toHaveBeenCalled();
    });

    it('silently drops heartbeat when timestamp is not a positive integer', async () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);

      await getHandler(WebSocketEvent.HEARTBEAT)({ boardId: BOARD_ID, timestamp: -1 });

      expect(presenceService.refreshPresence).not.toHaveBeenCalled();
    });

    it('passes exact boardId and userId to refreshPresence without modification', async () => {
      const socket = makeSocket({
        data: { userId: 'special-user-99', userName: 'Special', currentBoardId: BOARD_ID },
      });
      const getHandler = setupHandler(socket);
      vi.mocked(presenceService.refreshPresence).mockResolvedValue(undefined as any);

      await getHandler(WebSocketEvent.HEARTBEAT)(makeHeartbeatPayload());

      expect(presenceService.refreshPresence).toHaveBeenCalledWith(BOARD_ID, 'special-user-99');
    });
  });
});
