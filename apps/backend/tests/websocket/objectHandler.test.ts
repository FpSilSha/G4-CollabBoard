import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeSocket, makeIO, makeBoardObject, makeCachedBoardState } from '../mocks/factories';
import { WebSocketEvent } from 'shared';

// ─── Service mocks ────────────────────────────────────────────────────────────

vi.mock('../../src/services/boardService', () => ({
  boardService: {
    addObjectInRedis: vi.fn(),
    updateObjectInRedis: vi.fn(),
    removeObjectFromRedis: vi.fn(),
    getOrLoadBoardState: vi.fn(),
    saveBoardStateToRedis: vi.fn(),
    getBoard: vi.fn(),
    flushRedisToPostgres: vi.fn(),
    removeBoardFromRedis: vi.fn(),
  },
}));

vi.mock('../../src/services/editLockService', () => ({
  editLockService: {
    acquireLock: vi.fn(),
    releaseLock: vi.fn(),
    refreshLock: vi.fn(),
    getUserLocks: vi.fn(),
  },
}));

vi.mock('../../src/services/auditService', () => ({
  auditService: {
    log: vi.fn(),
  },
  AuditAction: {
    OBJECT_CREATE: 'object.create',
    OBJECT_UPDATE: 'object.update',
    OBJECT_DELETE: 'object.delete',
  },
}));

vi.mock('../../src/websocket/wsMetrics', () => ({
  trackedEmit: vi.fn(),
  trackedVolatileEmit: vi.fn(),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { registerObjectHandlers } from '../../src/websocket/handlers/objectHandler';
import { boardService } from '../../src/services/boardService';
import { editLockService } from '../../src/services/editLockService';
import { trackedEmit } from '../../src/websocket/wsMetrics';
import { AppError } from '../../src/middleware/errorHandler';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const BOARD_ID = '11111111-1111-1111-1111-111111111111';
const OBJECT_ID = '22222222-2222-2222-2222-222222222222';
const USER_ID = 'user-1';

/** Build a socket whose currentBoardId matches BOARD_ID */
function makeJoinedSocket(overrides: Record<string, unknown> = {}) {
  return makeSocket({
    data: {
      userId: USER_ID,
      userName: 'Test User',
      currentBoardId: BOARD_ID,
    },
    ...overrides,
  });
}

/** Register the handler, return a function to extract a named event callback */
function setupHandler(socket: ReturnType<typeof makeSocket>, io = makeIO()) {
  registerObjectHandlers(io as any, socket as any);
  return function getHandler(event: string): (...args: unknown[]) => Promise<void> {
    const calls = vi.mocked(socket.on).mock.calls;
    const found = calls.find(([ev]) => ev === event);
    if (!found) throw new Error(`No handler registered for "${event}"`);
    return found[1] as (...args: unknown[]) => Promise<void>;
  };
}

/** Valid object:create payload */
function makeCreatePayload(overrides: Record<string, unknown> = {}) {
  return {
    boardId: BOARD_ID,
    object: {
      id: OBJECT_ID,
      type: 'sticky',
      x: 100,
      y: 100,
      ...overrides,
    },
    timestamp: Date.now(),
  };
}

/** Valid object:update payload */
function makeUpdatePayload(overrides: Record<string, unknown> = {}) {
  return {
    boardId: BOARD_ID,
    objectId: OBJECT_ID,
    updates: { x: 200, y: 300 },
    timestamp: Date.now(),
    ...overrides,
  };
}

/** Valid object:delete payload */
function makeDeletePayload(overrides: Record<string, unknown> = {}) {
  return {
    boardId: BOARD_ID,
    objectId: OBJECT_ID,
    timestamp: Date.now(),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('objectHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── object:create ──────────────────────────────────────────────────────────

  describe('object:create', () => {
    it('calls boardService.addObjectInRedis and broadcasts on valid payload', async () => {
      const socket = makeJoinedSocket();
      const io = makeIO();
      const toEmit = { emit: vi.fn() };
      vi.mocked(io.to).mockReturnValue(toEmit as any);

      const getHandler = setupHandler(socket, io);
      vi.mocked(boardService.addObjectInRedis).mockResolvedValue(undefined as any);

      await getHandler(WebSocketEvent.OBJECT_CREATE)(makeCreatePayload());

      expect(boardService.addObjectInRedis).toHaveBeenCalledWith(
        BOARD_ID,
        expect.objectContaining({ id: OBJECT_ID, createdBy: USER_ID, lastEditedBy: USER_ID })
      );
      expect(trackedEmit).toHaveBeenCalledWith(
        toEmit,
        WebSocketEvent.OBJECT_CREATED,
        expect.objectContaining({ boardId: BOARD_ID, userId: USER_ID })
      );
    });

    it('emits board:error with INVALID_PAYLOAD on bad payload', async () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);

      await getHandler(WebSocketEvent.OBJECT_CREATE)({ boardId: 'not-a-uuid' });

      expect(socket.emit).toHaveBeenCalledWith(
        WebSocketEvent.BOARD_ERROR,
        expect.objectContaining({ code: 'INVALID_PAYLOAD' })
      );
      expect(boardService.addObjectInRedis).not.toHaveBeenCalled();
    });

    it('emits board:error with NOT_IN_BOARD when socket is on a different board', async () => {
      const socket = makeSocket({
        data: { userId: USER_ID, userName: 'Test User', currentBoardId: 'other-board-id' },
      });
      const getHandler = setupHandler(socket);

      await getHandler(WebSocketEvent.OBJECT_CREATE)(makeCreatePayload());

      expect(socket.emit).toHaveBeenCalledWith(
        WebSocketEvent.BOARD_ERROR,
        expect.objectContaining({ code: 'NOT_IN_BOARD' })
      );
      expect(boardService.addObjectInRedis).not.toHaveBeenCalled();
    });

    it('emits board:error with CREATE_FAILED when boardService throws', async () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);
      vi.mocked(boardService.addObjectInRedis).mockRejectedValue(new Error('Redis down'));

      await getHandler(WebSocketEvent.OBJECT_CREATE)(makeCreatePayload());

      expect(socket.emit).toHaveBeenCalledWith(
        WebSocketEvent.BOARD_ERROR,
        expect.objectContaining({ code: 'CREATE_FAILED', message: 'Redis down' })
      );
    });

    it('attaches server-authoritative timestamps and createdBy fields', async () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);
      vi.mocked(boardService.addObjectInRedis).mockResolvedValue(undefined as any);

      const before = Date.now();
      await getHandler(WebSocketEvent.OBJECT_CREATE)(makeCreatePayload());
      const after = Date.now();

      const call = vi.mocked(boardService.addObjectInRedis).mock.calls[0];
      const savedObject = call[1] as Record<string, unknown>;
      expect(savedObject.createdBy).toBe(USER_ID);
      expect(savedObject.lastEditedBy).toBe(USER_ID);
      // timestamps should be ISO strings within the test window
      const createdAt = Date.parse(savedObject.createdAt as string);
      expect(createdAt).toBeGreaterThanOrEqual(before);
      expect(createdAt).toBeLessThanOrEqual(after);
    });
  });

  // ── object:update ──────────────────────────────────────────────────────────

  describe('object:update', () => {
    it('calls boardService.updateObjectInRedis and broadcasts to room on valid payload', async () => {
      const socket = makeJoinedSocket();
      const toEmit = { emit: vi.fn() };
      vi.mocked(socket.to).mockReturnValue(toEmit as any);
      const getHandler = setupHandler(socket);
      vi.mocked(boardService.updateObjectInRedis).mockResolvedValue(undefined as any);

      await getHandler(WebSocketEvent.OBJECT_UPDATE)(makeUpdatePayload());

      expect(boardService.updateObjectInRedis).toHaveBeenCalledWith(
        BOARD_ID,
        OBJECT_ID,
        expect.objectContaining({ x: 200, y: 300, lastEditedBy: USER_ID })
      );
      expect(trackedEmit).toHaveBeenCalledWith(
        toEmit,
        WebSocketEvent.OBJECT_UPDATED,
        expect.objectContaining({ boardId: BOARD_ID, objectId: OBJECT_ID })
      );
    });

    it('emits INVALID_PAYLOAD on bad payload (missing boardId)', async () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);

      await getHandler(WebSocketEvent.OBJECT_UPDATE)({ objectId: OBJECT_ID });

      expect(socket.emit).toHaveBeenCalledWith(
        WebSocketEvent.BOARD_ERROR,
        expect.objectContaining({ code: 'INVALID_PAYLOAD' })
      );
      expect(boardService.updateObjectInRedis).not.toHaveBeenCalled();
    });

    it('emits NOT_IN_BOARD when socket is on a different board', async () => {
      const socket = makeSocket({
        data: { userId: USER_ID, userName: 'Test User', currentBoardId: 'wrong-board' },
      });
      const getHandler = setupHandler(socket);

      await getHandler(WebSocketEvent.OBJECT_UPDATE)(makeUpdatePayload());

      expect(socket.emit).toHaveBeenCalledWith(
        WebSocketEvent.BOARD_ERROR,
        expect.objectContaining({ code: 'NOT_IN_BOARD' })
      );
    });

    it('silently ignores AppError 404 (object already deleted race condition)', async () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);
      vi.mocked(boardService.updateObjectInRedis).mockRejectedValue(
        new AppError(404, 'Object not found')
      );

      await getHandler(WebSocketEvent.OBJECT_UPDATE)(makeUpdatePayload());

      // No board:error should be emitted
      expect(socket.emit).not.toHaveBeenCalledWith(
        WebSocketEvent.BOARD_ERROR,
        expect.anything()
      );
    });

    it('emits UPDATE_FAILED for non-404 errors', async () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);
      vi.mocked(boardService.updateObjectInRedis).mockRejectedValue(new Error('Unexpected failure'));

      await getHandler(WebSocketEvent.OBJECT_UPDATE)(makeUpdatePayload());

      expect(socket.emit).toHaveBeenCalledWith(
        WebSocketEvent.BOARD_ERROR,
        expect.objectContaining({ code: 'UPDATE_FAILED' })
      );
    });

    it('refreshes edit lock when update includes text field', async () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);
      vi.mocked(boardService.updateObjectInRedis).mockResolvedValue(undefined as any);
      vi.mocked(editLockService.refreshLock).mockResolvedValue(undefined as any);

      await getHandler(WebSocketEvent.OBJECT_UPDATE)(
        makeUpdatePayload({ updates: { text: 'new text' } })
      );

      expect(editLockService.refreshLock).toHaveBeenCalledWith(BOARD_ID, OBJECT_ID, USER_ID);
    });

    it('does NOT refresh edit lock when update does not include text', async () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);
      vi.mocked(boardService.updateObjectInRedis).mockResolvedValue(undefined as any);

      await getHandler(WebSocketEvent.OBJECT_UPDATE)(makeUpdatePayload({ updates: { x: 50 } }));

      expect(editLockService.refreshLock).not.toHaveBeenCalled();
    });

    it('emits INVALID_UPDATES when updates contain an invalid field value', async () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);

      // color must be a valid hex string; empty string fails regex
      await getHandler(WebSocketEvent.OBJECT_UPDATE)(
        makeUpdatePayload({ updates: { color: 'not-a-color' } })
      );

      expect(socket.emit).toHaveBeenCalledWith(
        WebSocketEvent.BOARD_ERROR,
        expect.objectContaining({ code: 'INVALID_UPDATES' })
      );
      expect(boardService.updateObjectInRedis).not.toHaveBeenCalled();
    });
  });

  // ── object:delete ──────────────────────────────────────────────────────────

  describe('object:delete', () => {
    it('calls boardService.removeObjectFromRedis and broadcasts to room', async () => {
      const socket = makeJoinedSocket();
      const toEmit = { emit: vi.fn() };
      vi.mocked(socket.to).mockReturnValue(toEmit as any);
      const getHandler = setupHandler(socket);
      vi.mocked(boardService.removeObjectFromRedis).mockResolvedValue(undefined as any);

      await getHandler(WebSocketEvent.OBJECT_DELETE)(makeDeletePayload());

      expect(boardService.removeObjectFromRedis).toHaveBeenCalledWith(BOARD_ID, OBJECT_ID);
      expect(trackedEmit).toHaveBeenCalledWith(
        toEmit,
        WebSocketEvent.OBJECT_DELETED,
        expect.objectContaining({ boardId: BOARD_ID, objectId: OBJECT_ID, userId: USER_ID })
      );
    });

    it('emits INVALID_PAYLOAD on bad delete payload', async () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);

      await getHandler(WebSocketEvent.OBJECT_DELETE)({ objectId: OBJECT_ID /* missing boardId */ });

      expect(socket.emit).toHaveBeenCalledWith(
        WebSocketEvent.BOARD_ERROR,
        expect.objectContaining({ code: 'INVALID_PAYLOAD' })
      );
      expect(boardService.removeObjectFromRedis).not.toHaveBeenCalled();
    });

    it('emits NOT_IN_BOARD when socket is on a different board', async () => {
      const socket = makeSocket({
        data: { userId: USER_ID, userName: 'Test User', currentBoardId: 'different-board' },
      });
      const getHandler = setupHandler(socket);

      await getHandler(WebSocketEvent.OBJECT_DELETE)(makeDeletePayload());

      expect(socket.emit).toHaveBeenCalledWith(
        WebSocketEvent.BOARD_ERROR,
        expect.objectContaining({ code: 'NOT_IN_BOARD' })
      );
    });

    it('silently ignores AppError 404 (already deleted by concurrent batch delete)', async () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);
      vi.mocked(boardService.removeObjectFromRedis).mockRejectedValue(
        new AppError(404, 'Object not found')
      );

      await getHandler(WebSocketEvent.OBJECT_DELETE)(makeDeletePayload());

      expect(socket.emit).not.toHaveBeenCalledWith(
        WebSocketEvent.BOARD_ERROR,
        expect.anything()
      );
    });

    it('emits DELETE_FAILED for non-404 errors', async () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);
      vi.mocked(boardService.removeObjectFromRedis).mockRejectedValue(new Error('Store error'));

      await getHandler(WebSocketEvent.OBJECT_DELETE)(makeDeletePayload());

      expect(socket.emit).toHaveBeenCalledWith(
        WebSocketEvent.BOARD_ERROR,
        expect.objectContaining({ code: 'DELETE_FAILED' })
      );
    });
  });

  // ── objects:batch_update ───────────────────────────────────────────────────

  describe('objects:batch_update', () => {
    it('applies position updates and broadcasts to room', async () => {
      const socket = makeJoinedSocket();
      const toEmit = { emit: vi.fn() };
      vi.mocked(socket.to).mockReturnValue(toEmit as any);
      const getHandler = setupHandler(socket);

      const obj = makeBoardObject({ id: OBJECT_ID });
      const cachedState = makeCachedBoardState({ objects: [obj] });
      vi.mocked(boardService.getOrLoadBoardState).mockResolvedValue(cachedState as any);
      vi.mocked(boardService.saveBoardStateToRedis).mockResolvedValue(undefined as any);

      await getHandler(WebSocketEvent.OBJECTS_BATCH_UPDATE)({
        boardId: BOARD_ID,
        moves: [{ objectId: OBJECT_ID, x: 500, y: 600 }],
        timestamp: Date.now(),
      });

      expect(boardService.getOrLoadBoardState).toHaveBeenCalledWith(BOARD_ID);
      expect(boardService.saveBoardStateToRedis).toHaveBeenCalledWith(
        BOARD_ID,
        expect.objectContaining({ objects: expect.any(Array) })
      );
      expect(trackedEmit).toHaveBeenCalledWith(
        toEmit,
        WebSocketEvent.OBJECTS_BATCH_UPDATE,
        expect.objectContaining({ boardId: BOARD_ID, userId: USER_ID })
      );
    });

    it('emits INVALID_PAYLOAD when moves array is empty', async () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);

      await getHandler(WebSocketEvent.OBJECTS_BATCH_UPDATE)({
        boardId: BOARD_ID,
        moves: [],
        timestamp: Date.now(),
      });

      expect(socket.emit).toHaveBeenCalledWith(
        WebSocketEvent.BOARD_ERROR,
        expect.objectContaining({ code: 'INVALID_PAYLOAD' })
      );
    });

    it('skips objects not found in board state without error', async () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);

      const cachedState = makeCachedBoardState({ objects: [] });
      vi.mocked(boardService.getOrLoadBoardState).mockResolvedValue(cachedState as any);
      vi.mocked(boardService.saveBoardStateToRedis).mockResolvedValue(undefined as any);

      // Move a non-existent object — should not throw
      await getHandler(WebSocketEvent.OBJECTS_BATCH_UPDATE)({
        boardId: BOARD_ID,
        moves: [{ objectId: 'nonexistent', x: 100, y: 200 }],
        timestamp: Date.now(),
      });

      expect(boardService.saveBoardStateToRedis).toHaveBeenCalled();
      expect(socket.emit).not.toHaveBeenCalledWith(
        WebSocketEvent.BOARD_ERROR,
        expect.anything()
      );
    });
  });

  // ── objects:batch_create ───────────────────────────────────────────────────

  describe('objects:batch_create', () => {
    it('adds objects to board state and broadcasts to all users (including sender)', async () => {
      const socket = makeJoinedSocket();
      const io = makeIO();
      const toEmit = { emit: vi.fn() };
      vi.mocked(io.to).mockReturnValue(toEmit as any);
      const getHandler = setupHandler(socket, io);

      const cachedState = makeCachedBoardState({ objects: [] });
      vi.mocked(boardService.getOrLoadBoardState).mockResolvedValue(cachedState as any);
      vi.mocked(boardService.saveBoardStateToRedis).mockResolvedValue(undefined as any);

      const newObjId = '33333333-3333-3333-3333-333333333333';
      await getHandler(WebSocketEvent.OBJECTS_BATCH_CREATE)({
        boardId: BOARD_ID,
        objects: [{ id: newObjId, type: 'sticky', x: 10, y: 20 }],
        timestamp: Date.now(),
      });

      expect(boardService.saveBoardStateToRedis).toHaveBeenCalled();
      expect(trackedEmit).toHaveBeenCalledWith(
        toEmit,
        WebSocketEvent.OBJECTS_BATCH_CREATED,
        expect.objectContaining({ boardId: BOARD_ID, userId: USER_ID })
      );
    });

    it('emits INVALID_PAYLOAD when objects array is empty', async () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);

      await getHandler(WebSocketEvent.OBJECTS_BATCH_CREATE)({
        boardId: BOARD_ID,
        objects: [],
        timestamp: Date.now(),
      });

      expect(socket.emit).toHaveBeenCalledWith(
        WebSocketEvent.BOARD_ERROR,
        expect.objectContaining({ code: 'INVALID_PAYLOAD' })
      );
    });

    it('emits NOT_IN_BOARD when socket is on a different board', async () => {
      const socket = makeSocket({
        data: { userId: USER_ID, userName: 'Test User', currentBoardId: 'other-board' },
      });
      const getHandler = setupHandler(socket);

      await getHandler(WebSocketEvent.OBJECTS_BATCH_CREATE)({
        boardId: BOARD_ID,
        objects: [{ id: OBJECT_ID, type: 'sticky' }],
        timestamp: Date.now(),
      });

      expect(socket.emit).toHaveBeenCalledWith(
        WebSocketEvent.BOARD_ERROR,
        expect.objectContaining({ code: 'NOT_IN_BOARD' })
      );
    });
  });

  // ── objects:batch_delete ───────────────────────────────────────────────────

  describe('objects:batch_delete', () => {
    it('removes objects from board state and broadcasts to room (excluding sender)', async () => {
      const socket = makeJoinedSocket();
      const toEmit = { emit: vi.fn() };
      vi.mocked(socket.to).mockReturnValue(toEmit as any);
      const getHandler = setupHandler(socket);

      const obj1 = makeBoardObject({ id: 'aaa-111' });
      const obj2 = makeBoardObject({ id: 'bbb-222' });
      const cachedState = makeCachedBoardState({ objects: [obj1, obj2] });
      vi.mocked(boardService.getOrLoadBoardState).mockResolvedValue(cachedState as any);
      vi.mocked(boardService.saveBoardStateToRedis).mockResolvedValue(undefined as any);

      await getHandler(WebSocketEvent.OBJECTS_BATCH_DELETE)({
        boardId: BOARD_ID,
        objectIds: ['aaa-111'],
        timestamp: Date.now(),
      });

      // Only obj2 should remain
      const saveCall = vi.mocked(boardService.saveBoardStateToRedis).mock.calls[0];
      const savedState = saveCall[1] as ReturnType<typeof makeCachedBoardState>;
      expect(savedState.objects).toHaveLength(1);
      expect((savedState.objects[0] as { id: string }).id).toBe('bbb-222');

      expect(trackedEmit).toHaveBeenCalledWith(
        toEmit,
        WebSocketEvent.OBJECTS_BATCH_DELETED,
        expect.objectContaining({ objectIds: ['aaa-111'] })
      );
    });

    it('emits INVALID_PAYLOAD when objectIds array is empty', async () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);

      await getHandler(WebSocketEvent.OBJECTS_BATCH_DELETE)({
        boardId: BOARD_ID,
        objectIds: [],
        timestamp: Date.now(),
      });

      expect(socket.emit).toHaveBeenCalledWith(
        WebSocketEvent.BOARD_ERROR,
        expect.objectContaining({ code: 'INVALID_PAYLOAD' })
      );
    });

    it('emits NOT_IN_BOARD when socket is on a different board', async () => {
      const socket = makeSocket({
        data: { userId: USER_ID, userName: 'Test User', currentBoardId: 'wrong-board' },
      });
      const getHandler = setupHandler(socket);

      await getHandler(WebSocketEvent.OBJECTS_BATCH_DELETE)({
        boardId: BOARD_ID,
        objectIds: [OBJECT_ID],
        timestamp: Date.now(),
      });

      expect(socket.emit).toHaveBeenCalledWith(
        WebSocketEvent.BOARD_ERROR,
        expect.objectContaining({ code: 'NOT_IN_BOARD' })
      );
    });
  });
});
