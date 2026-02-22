import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeSocket, makeIO, makeBoard, makeCachedBoardState } from '../mocks/factories';
import { WebSocketEvent } from 'shared';

// ─── Service mocks ────────────────────────────────────────────────────────────

vi.mock('../../src/services/boardService', () => ({
  boardService: {
    getBoard: vi.fn(),
    getOrLoadBoardState: vi.fn(),
    flushRedisToPostgres: vi.fn(),
    removeBoardFromRedis: vi.fn(),
  },
}));

vi.mock('../../src/services/presenceService', () => ({
  presenceService: {
    addUser: vi.fn(),
    removeUser: vi.fn(),
    getBoardUsers: vi.fn(),
    updateSessionBoard: vi.fn(),
    removeSession: vi.fn(),
    removeUserFromAllBoards: vi.fn(),
    refreshPresence: vi.fn(),
  },
}));

vi.mock('../../src/services/editLockService', () => ({
  editLockService: {
    getUserLocks: vi.fn(),
    releaseLock: vi.fn(),
    refreshLock: vi.fn(),
    acquireLock: vi.fn(),
  },
}));

vi.mock('../../src/services/teleportFlagService', () => ({
  teleportFlagService: {
    listFlags: vi.fn(),
  },
}));

vi.mock('../../src/services/aiChatService', () => ({
  aiChatService: {
    purgeChat: vi.fn(),
  },
}));

vi.mock('../../src/services/auditService', () => ({
  auditService: {
    log: vi.fn(),
  },
  AuditAction: {
    BOARD_JOIN: 'board.join',
    BOARD_LEAVE: 'board.leave',
  },
}));

vi.mock('../../src/websocket/wsMetrics', () => ({
  trackedEmit: vi.fn(),
  trackedVolatileEmit: vi.fn(),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { registerConnectionHandlers } from '../../src/websocket/handlers/connectionHandler';
import { boardService } from '../../src/services/boardService';
import { presenceService } from '../../src/services/presenceService';
import { editLockService } from '../../src/services/editLockService';
import { teleportFlagService } from '../../src/services/teleportFlagService';
import { aiChatService } from '../../src/services/aiChatService';
import { trackedEmit } from '../../src/websocket/wsMetrics';

// ─── Constants ────────────────────────────────────────────────────────────────

const BOARD_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = 'user-1';
const SOCKET_ID = 'socket-abc';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFreshSocket(overrides: Record<string, unknown> = {}) {
  return {
    ...makeSocket(),
    id: SOCKET_ID,
    data: {
      userId: USER_ID,
      userName: 'Test User',
      avatar: 'https://example.com/avatar.png',
      currentBoardId: undefined,
    },
    ...overrides,
  };
}

function setupHandler(socket: ReturnType<typeof makeFreshSocket>, io = makeIO()) {
  // io.fetchSockets returns all remaining sockets (used by disconnect handler)
  (io as any).fetchSockets = vi.fn().mockResolvedValue([]);
  registerConnectionHandlers(io as any, socket as any);
  return {
    io,
    getHandler(event: string): (...args: unknown[]) => Promise<void> {
      const calls = vi.mocked(socket.on).mock.calls;
      const found = calls.find(([ev]) => ev === event);
      if (!found) throw new Error(`No handler for "${event}"`);
      return found[1] as (...args: unknown[]) => Promise<void>;
    },
  };
}

/** Seed all service mocks with minimal happy-path responses */
function seedHappyPath() {
  const board = makeBoard({ id: BOARD_ID });
  const cachedState = makeCachedBoardState({ boardId: BOARD_ID, objects: [] });

  vi.mocked(boardService.getBoard).mockResolvedValue(board as any);
  vi.mocked(boardService.getOrLoadBoardState).mockResolvedValue(cachedState as any);
  vi.mocked(presenceService.getBoardUsers).mockResolvedValue([]);
  vi.mocked(presenceService.addUser).mockResolvedValue(undefined as any);
  vi.mocked(presenceService.updateSessionBoard).mockResolvedValue(undefined as any);
  vi.mocked(teleportFlagService.listFlags).mockResolvedValue({ flags: [] } as any);
  vi.mocked(editLockService.getUserLocks).mockResolvedValue([]);
  vi.mocked(editLockService.releaseLock).mockResolvedValue(undefined as any);
  vi.mocked(presenceService.removeUser).mockResolvedValue(undefined as any);
  vi.mocked(presenceService.removeSession).mockResolvedValue(undefined as any);
  vi.mocked(presenceService.removeUserFromAllBoards).mockResolvedValue(undefined as any);
  vi.mocked(boardService.flushRedisToPostgres).mockResolvedValue({ success: true, newVersion: 2 } as any);
  vi.mocked(boardService.removeBoardFromRedis).mockResolvedValue(undefined as any);
  vi.mocked(aiChatService.purgeChat).mockResolvedValue(undefined as any);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('connectionHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── board:join ─────────────────────────────────────────────────────────────

  describe('board:join', () => {
    it('joins the socket room, calls presence.addUser, and emits board:state to the joiner', async () => {
      const socket = makeFreshSocket();
      const io = makeIO();
      const { getHandler } = setupHandler(socket, io);
      seedHappyPath();

      await getHandler(WebSocketEvent.BOARD_JOIN)({ boardId: BOARD_ID });

      expect(socket.join).toHaveBeenCalledWith(BOARD_ID);
      expect(presenceService.addUser).toHaveBeenCalledWith(
        BOARD_ID,
        expect.objectContaining({ userId: USER_ID })
      );
      // board:state sent to socket
      expect(trackedEmit).toHaveBeenCalledWith(
        socket,
        WebSocketEvent.BOARD_STATE,
        expect.objectContaining({ boardId: BOARD_ID })
      );
    });

    it('sets socket.data.currentBoardId to the joined board', async () => {
      const socket = makeFreshSocket();
      const { getHandler } = setupHandler(socket);
      seedHappyPath();

      await getHandler(WebSocketEvent.BOARD_JOIN)({ boardId: BOARD_ID });

      expect(socket.data.currentBoardId).toBe(BOARD_ID);
    });

    it('broadcasts user:joined to everyone else in the room', async () => {
      const socket = makeFreshSocket();
      const toEmit = { emit: vi.fn() };
      vi.mocked(socket.to).mockReturnValue(toEmit as any);
      const { getHandler } = setupHandler(socket);
      seedHappyPath();

      await getHandler(WebSocketEvent.BOARD_JOIN)({ boardId: BOARD_ID });

      expect(trackedEmit).toHaveBeenCalledWith(
        toEmit,
        WebSocketEvent.USER_JOINED,
        expect.objectContaining({ boardId: BOARD_ID, user: expect.objectContaining({ userId: USER_ID }) })
      );
    });

    it('emits board:error when board is not found (boardService.getBoard throws)', async () => {
      const socket = makeFreshSocket();
      const { getHandler } = setupHandler(socket);
      vi.mocked(boardService.getBoard).mockRejectedValue(new Error('Board not found'));

      await getHandler(WebSocketEvent.BOARD_JOIN)({ boardId: BOARD_ID });

      expect(socket.emit).toHaveBeenCalledWith(
        WebSocketEvent.BOARD_ERROR,
        expect.objectContaining({ message: 'Board not found' })
      );
    });

    it('emits INVALID_PAYLOAD when boardId is not a valid UUID', async () => {
      const socket = makeFreshSocket();
      const { getHandler } = setupHandler(socket);

      await getHandler(WebSocketEvent.BOARD_JOIN)({ boardId: 'not-a-uuid' });

      expect(socket.emit).toHaveBeenCalledWith(
        WebSocketEvent.BOARD_ERROR,
        expect.objectContaining({ code: 'INVALID_PAYLOAD' })
      );
      expect(boardService.getBoard).not.toHaveBeenCalled();
    });

    it('emits INVALID_PAYLOAD when payload is missing boardId entirely', async () => {
      const socket = makeFreshSocket();
      const { getHandler } = setupHandler(socket);

      await getHandler(WebSocketEvent.BOARD_JOIN)({});

      expect(socket.emit).toHaveBeenCalledWith(
        WebSocketEvent.BOARD_ERROR,
        expect.objectContaining({ code: 'INVALID_PAYLOAD' })
      );
    });

    it('loads board state from Redis via boardService.getOrLoadBoardState', async () => {
      const socket = makeFreshSocket();
      const { getHandler } = setupHandler(socket);
      seedHappyPath();

      await getHandler(WebSocketEvent.BOARD_JOIN)({ boardId: BOARD_ID });

      expect(boardService.getOrLoadBoardState).toHaveBeenCalledWith(BOARD_ID);
    });

    it('sends board:state containing all current users and flags', async () => {
      const socket = makeFreshSocket();
      const { getHandler } = setupHandler(socket);
      seedHappyPath();

      const users = [{ userId: 'other-user', name: 'Other', avatar: '', color: '#FF0000' }];
      const flags = [{ id: 'flag-1', label: 'Start', color: '#0000FF', x: 0, y: 0 }];
      vi.mocked(presenceService.getBoardUsers).mockResolvedValue(users as any);
      vi.mocked(teleportFlagService.listFlags).mockResolvedValue({ flags } as any);

      await getHandler(WebSocketEvent.BOARD_JOIN)({ boardId: BOARD_ID });

      expect(trackedEmit).toHaveBeenCalledWith(
        socket,
        WebSocketEvent.BOARD_STATE,
        expect.objectContaining({ users, flags })
      );
    });

    it('emits edit:reclaim to socket when user reconnects with active edit locks', async () => {
      const socket = makeFreshSocket();
      const { getHandler } = setupHandler(socket);
      seedHappyPath();

      const LOCKED_OBJ = 'locked-obj-1';
      vi.mocked(editLockService.getUserLocks).mockResolvedValue([LOCKED_OBJ]);
      vi.mocked(editLockService.refreshLock).mockResolvedValue(undefined as any);

      await getHandler(WebSocketEvent.BOARD_JOIN)({ boardId: BOARD_ID });

      expect(editLockService.refreshLock).toHaveBeenCalledWith(BOARD_ID, LOCKED_OBJ, USER_ID);
      expect(trackedEmit).toHaveBeenCalledWith(
        socket,
        'edit:reclaim',
        expect.objectContaining({ boardId: BOARD_ID, objectIds: [LOCKED_OBJ] })
      );
    });

    it('assigns a presence color from the USER_COLORS palette', async () => {
      const socket = makeFreshSocket();
      const { getHandler } = setupHandler(socket);
      seedHappyPath();

      await getHandler(WebSocketEvent.BOARD_JOIN)({ boardId: BOARD_ID });

      const addUserCall = vi.mocked(presenceService.addUser).mock.calls[0];
      const userInfo = addUserCall[1] as Record<string, unknown>;
      expect(typeof userInfo.color).toBe('string');
      expect(userInfo.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });
  });

  // ── board:leave ────────────────────────────────────────────────────────────

  describe('board:leave', () => {
    it('removes user from presence and broadcasts user:left on voluntary leave', async () => {
      const socket = makeFreshSocket({ data: { userId: USER_ID, userName: 'Test User', avatar: '', currentBoardId: BOARD_ID } });
      const io = makeIO();
      const ioToEmit = { emit: vi.fn() };
      vi.mocked(io.to).mockReturnValue(ioToEmit as any);
      const { getHandler } = setupHandler(socket, io);
      seedHappyPath();

      await getHandler(WebSocketEvent.BOARD_LEAVE)({ boardId: BOARD_ID });

      expect(presenceService.removeUser).toHaveBeenCalledWith(BOARD_ID, USER_ID);
      expect(trackedEmit).toHaveBeenCalledWith(
        ioToEmit,
        WebSocketEvent.USER_LEFT,
        expect.objectContaining({ boardId: BOARD_ID, userId: USER_ID })
      );
    });

    it('leaves the socket.io room on board:leave', async () => {
      const socket = makeFreshSocket({ data: { userId: USER_ID, userName: 'Test User', avatar: '', currentBoardId: BOARD_ID } });
      const { getHandler } = setupHandler(socket);
      seedHappyPath();

      await getHandler(WebSocketEvent.BOARD_LEAVE)({ boardId: BOARD_ID });

      expect(socket.leave).toHaveBeenCalledWith(BOARD_ID);
    });

    it('releases edit locks on voluntary board:leave', async () => {
      const socket = makeFreshSocket({ data: { userId: USER_ID, userName: 'Test User', avatar: '', currentBoardId: BOARD_ID } });
      const { getHandler } = setupHandler(socket);
      seedHappyPath();
      vi.mocked(editLockService.getUserLocks).mockResolvedValue(['obj-locked']);
      vi.mocked(editLockService.releaseLock).mockResolvedValue(undefined as any);

      await getHandler(WebSocketEvent.BOARD_LEAVE)({ boardId: BOARD_ID });

      expect(editLockService.releaseLock).toHaveBeenCalledWith(BOARD_ID, 'obj-locked', USER_ID);
    });

    it('purges AI chat on voluntary board:leave', async () => {
      const socket = makeFreshSocket({ data: { userId: USER_ID, userName: 'Test User', avatar: '', currentBoardId: BOARD_ID } });
      const { getHandler } = setupHandler(socket);
      seedHappyPath();

      await getHandler(WebSocketEvent.BOARD_LEAVE)({ boardId: BOARD_ID });

      expect(aiChatService.purgeChat).toHaveBeenCalledWith(BOARD_ID, USER_ID);
    });

    it('flushes Redis to Postgres when last user leaves', async () => {
      const socket = makeFreshSocket({ data: { userId: USER_ID, userName: 'Test User', avatar: '', currentBoardId: BOARD_ID } });
      const { getHandler } = setupHandler(socket);
      seedHappyPath();
      // No remaining users after leave
      vi.mocked(presenceService.getBoardUsers).mockResolvedValue([]);

      await getHandler(WebSocketEvent.BOARD_LEAVE)({ boardId: BOARD_ID });

      expect(boardService.flushRedisToPostgres).toHaveBeenCalledWith(BOARD_ID);
      expect(boardService.removeBoardFromRedis).toHaveBeenCalledWith(BOARD_ID);
    });

    it('does NOT flush Redis when other users still remain on the board', async () => {
      const socket = makeFreshSocket({ data: { userId: USER_ID, userName: 'Test User', avatar: '', currentBoardId: BOARD_ID } });
      const { getHandler } = setupHandler(socket);
      seedHappyPath();
      // Another user still in the board after leave
      vi.mocked(presenceService.getBoardUsers).mockResolvedValue([
        { userId: 'other-user', name: 'Other', avatar: '', color: '#00FF00' },
      ] as any);

      await getHandler(WebSocketEvent.BOARD_LEAVE)({ boardId: BOARD_ID });

      expect(boardService.flushRedisToPostgres).not.toHaveBeenCalled();
    });

    it('emits INVALID_PAYLOAD on malformed board:leave payload', async () => {
      const socket = makeFreshSocket();
      const { getHandler } = setupHandler(socket);

      await getHandler(WebSocketEvent.BOARD_LEAVE)({ boardId: 'not-a-uuid' });

      expect(socket.emit).toHaveBeenCalledWith(
        WebSocketEvent.BOARD_ERROR,
        expect.objectContaining({ code: 'INVALID_PAYLOAD' })
      );
    });
  });

  // ── disconnect ─────────────────────────────────────────────────────────────

  describe('disconnect', () => {
    it('calls presenceService.removeSession for the disconnected socket', async () => {
      const socket = makeFreshSocket({ data: { userId: USER_ID, userName: 'Test User', avatar: '', currentBoardId: undefined } });
      const io = makeIO();
      (io as any).fetchSockets = vi.fn().mockResolvedValue([]);
      const { getHandler } = setupHandler(socket, io);
      seedHappyPath();

      await getHandler('disconnect')('transport close');

      expect(presenceService.removeSession).toHaveBeenCalledWith(SOCKET_ID);
    });

    it('removes user from all boards when no other sockets remain', async () => {
      const socket = makeFreshSocket({ data: { userId: USER_ID, userName: 'Test User', avatar: '', currentBoardId: undefined } });
      const io = makeIO();
      (io as any).fetchSockets = vi.fn().mockResolvedValue([]); // no remaining sockets
      const { getHandler } = setupHandler(socket, io);
      seedHappyPath();

      await getHandler('disconnect')('transport close');

      expect(presenceService.removeUserFromAllBoards).toHaveBeenCalledWith(USER_ID);
    });

    it('skips removeUserFromAllBoards when another socket for the same user exists', async () => {
      const socket = makeFreshSocket({ data: { userId: USER_ID, userName: 'Test User', avatar: '', currentBoardId: undefined } });
      const io = makeIO();
      const { getHandler } = setupHandler(socket, io);
      // A different socket with the same userId is still connected — override AFTER setupHandler
      const otherSocket = { id: 'socket-other', data: { userId: USER_ID } };
      (io as any).fetchSockets = vi.fn().mockResolvedValue([otherSocket]);
      seedHappyPath();

      await getHandler('disconnect')('transport close');

      expect(presenceService.removeUserFromAllBoards).not.toHaveBeenCalled();
    });

    it('performs board leave cleanup when user had an active board and is last socket', async () => {
      const socket = makeFreshSocket({
        data: { userId: USER_ID, userName: 'Test User', avatar: '', currentBoardId: BOARD_ID },
      });
      const io = makeIO();
      const ioToEmit = { emit: vi.fn() };
      vi.mocked(io.to).mockReturnValue(ioToEmit as any);
      (io as any).fetchSockets = vi.fn().mockResolvedValue([]);
      const { getHandler } = setupHandler(socket, io);
      seedHappyPath();

      await getHandler('disconnect')('transport close');

      expect(presenceService.removeUser).toHaveBeenCalledWith(BOARD_ID, USER_ID);
    });

    it('does NOT release edit locks on disconnect (TTL-based grace period preserved)', async () => {
      const socket = makeFreshSocket({
        data: { userId: USER_ID, userName: 'Test User', avatar: '', currentBoardId: BOARD_ID },
      });
      const io = makeIO();
      const ioToEmit = { emit: vi.fn() };
      vi.mocked(io.to).mockReturnValue(ioToEmit as any);
      (io as any).fetchSockets = vi.fn().mockResolvedValue([]);
      const { getHandler } = setupHandler(socket, io);
      seedHappyPath();
      vi.mocked(editLockService.getUserLocks).mockResolvedValue(['obj-1']);

      await getHandler('disconnect')('transport close');

      // releaseLock should NOT be called on disconnect (only on voluntary leave)
      expect(editLockService.releaseLock).not.toHaveBeenCalled();
    });
  });

  // ── board:request_sync ─────────────────────────────────────────────────────

  describe('board:request_sync', () => {
    it('emits board:sync_response with current state to the requesting socket', async () => {
      const socket = makeFreshSocket({
        data: { userId: USER_ID, userName: 'Test User', avatar: '', currentBoardId: BOARD_ID },
      });
      const { getHandler } = setupHandler(socket);
      seedHappyPath();

      await getHandler(WebSocketEvent.BOARD_REQUEST_SYNC)({ boardId: BOARD_ID });

      expect(trackedEmit).toHaveBeenCalledWith(
        socket,
        WebSocketEvent.BOARD_SYNC_RESPONSE,
        expect.objectContaining({ boardId: BOARD_ID })
      );
    });

    it('emits NOT_IN_BOARD when socket is on a different board', async () => {
      const socket = makeFreshSocket({
        data: { userId: USER_ID, userName: 'Test User', avatar: '', currentBoardId: 'other-board' },
      });
      const { getHandler } = setupHandler(socket);

      await getHandler(WebSocketEvent.BOARD_REQUEST_SYNC)({ boardId: BOARD_ID });

      expect(socket.emit).toHaveBeenCalledWith(
        WebSocketEvent.BOARD_ERROR,
        expect.objectContaining({ code: 'NOT_IN_BOARD' })
      );
    });

    it('emits INVALID_PAYLOAD when payload has no boardId', async () => {
      const socket = makeFreshSocket({
        data: { userId: USER_ID, userName: 'Test User', avatar: '', currentBoardId: BOARD_ID },
      });
      const { getHandler } = setupHandler(socket);

      await getHandler(WebSocketEvent.BOARD_REQUEST_SYNC)({});

      expect(socket.emit).toHaveBeenCalledWith(
        WebSocketEvent.BOARD_ERROR,
        expect.objectContaining({ code: 'INVALID_PAYLOAD' })
      );
    });

    it('emits SYNC_FAILED when boardService throws during sync', async () => {
      const socket = makeFreshSocket({
        data: { userId: USER_ID, userName: 'Test User', avatar: '', currentBoardId: BOARD_ID },
      });
      const { getHandler } = setupHandler(socket);
      seedHappyPath();
      vi.mocked(boardService.getOrLoadBoardState).mockRejectedValue(new Error('Redis unavailable'));

      await getHandler(WebSocketEvent.BOARD_REQUEST_SYNC)({ boardId: BOARD_ID });

      expect(socket.emit).toHaveBeenCalledWith(
        WebSocketEvent.BOARD_ERROR,
        expect.objectContaining({ code: 'SYNC_FAILED' })
      );
    });
  });
});
