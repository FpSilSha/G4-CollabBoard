import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeSocket, makeIO } from '../mocks/factories';
import { WebSocketEvent } from 'shared';

// ─── Service mocks ────────────────────────────────────────────────────────────

vi.mock('../../src/services/editLockService', () => ({
  editLockService: {
    acquireLock: vi.fn(),
    releaseLock: vi.fn(),
    refreshLock: vi.fn(),
    getUserLocks: vi.fn(),
  },
}));

vi.mock('../../src/websocket/wsMetrics', () => ({
  trackedEmit: vi.fn(),
  trackedVolatileEmit: vi.fn(),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { registerEditHandlers } from '../../src/websocket/handlers/editHandler';
import { editLockService } from '../../src/services/editLockService';
import { trackedEmit } from '../../src/websocket/wsMetrics';

// ─── Constants ────────────────────────────────────────────────────────────────

const BOARD_ID = '11111111-1111-1111-1111-111111111111';
const OBJECT_ID = 'sticky-object-1';
const USER_ID = 'user-1';
const USER_NAME = 'Test User';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeJoinedSocket(overrides: Record<string, unknown> = {}) {
  return makeSocket({
    data: {
      userId: USER_ID,
      userName: USER_NAME,
      currentBoardId: BOARD_ID,
    },
    ...overrides,
  });
}

function setupHandler(socket: ReturnType<typeof makeSocket>, io = makeIO()) {
  registerEditHandlers(io as any, socket as any);
  return function getHandler(event: string): (...args: unknown[]) => Promise<void> {
    const calls = vi.mocked(socket.on).mock.calls;
    const found = calls.find(([ev]) => ev === event);
    if (!found) throw new Error(`No handler for "${event}"`);
    return found[1] as (...args: unknown[]) => Promise<void>;
  };
}

function makeEditStartPayload(overrides: Record<string, unknown> = {}) {
  return {
    boardId: BOARD_ID,
    objectId: OBJECT_ID,
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeEditEndPayload(overrides: Record<string, unknown> = {}) {
  return {
    boardId: BOARD_ID,
    objectId: OBJECT_ID,
    timestamp: Date.now(),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('editHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── edit:start ────────────────────────────────────────────────────────────

  describe('edit:start', () => {
    it('calls editLockService.acquireLock with correct arguments', async () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);
      vi.mocked(editLockService.acquireLock).mockResolvedValue({ otherEditors: [] });

      await getHandler(WebSocketEvent.EDIT_START)(makeEditStartPayload());

      expect(editLockService.acquireLock).toHaveBeenCalledWith(
        BOARD_ID,
        OBJECT_ID,
        USER_ID,
        USER_NAME
      );
    });

    it('broadcasts edit:start to other users in the room', async () => {
      const socket = makeJoinedSocket();
      const toEmit = { emit: vi.fn() };
      vi.mocked(socket.to).mockReturnValue(toEmit as any);
      const getHandler = setupHandler(socket);
      vi.mocked(editLockService.acquireLock).mockResolvedValue({ otherEditors: [] });

      await getHandler(WebSocketEvent.EDIT_START)(makeEditStartPayload());

      expect(trackedEmit).toHaveBeenCalledWith(
        toEmit,
        WebSocketEvent.EDIT_START,
        expect.objectContaining({ boardId: BOARD_ID, objectId: OBJECT_ID, userId: USER_ID })
      );
    });

    it('does NOT emit edit:warning when there are no other editors', async () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);
      vi.mocked(editLockService.acquireLock).mockResolvedValue({ otherEditors: [] });

      await getHandler(WebSocketEvent.EDIT_START)(makeEditStartPayload());

      const warningCall = vi.mocked(trackedEmit).mock.calls.find(
        ([, event]) => event === WebSocketEvent.EDIT_WARNING
      );
      expect(warningCall).toBeUndefined();
    });

    it('emits edit:warning to requesting socket when other editors are present', async () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);
      const otherEditors = [{ userId: 'user-2', userName: 'Other User' }];
      vi.mocked(editLockService.acquireLock).mockResolvedValue({ otherEditors });

      await getHandler(WebSocketEvent.EDIT_START)(makeEditStartPayload());

      expect(trackedEmit).toHaveBeenCalledWith(
        socket,
        WebSocketEvent.EDIT_WARNING,
        expect.objectContaining({ boardId: BOARD_ID, objectId: OBJECT_ID, editors: otherEditors })
      );
    });

    it('includes userName and userId in broadcast edit:start payload', async () => {
      const socket = makeJoinedSocket();
      const toEmit = { emit: vi.fn() };
      vi.mocked(socket.to).mockReturnValue(toEmit as any);
      const getHandler = setupHandler(socket);
      vi.mocked(editLockService.acquireLock).mockResolvedValue({ otherEditors: [] });

      await getHandler(WebSocketEvent.EDIT_START)(makeEditStartPayload());

      expect(trackedEmit).toHaveBeenCalledWith(
        toEmit,
        WebSocketEvent.EDIT_START,
        expect.objectContaining({ userId: USER_ID, userName: USER_NAME })
      );
    });

    it('emits NOT_IN_BOARD when socket is on a different board', async () => {
      const socket = makeSocket({
        data: { userId: USER_ID, userName: USER_NAME, currentBoardId: 'other-board' },
      });
      const getHandler = setupHandler(socket);

      await getHandler(WebSocketEvent.EDIT_START)(makeEditStartPayload());

      expect(socket.emit).toHaveBeenCalledWith(
        WebSocketEvent.BOARD_ERROR,
        expect.objectContaining({ code: 'NOT_IN_BOARD' })
      );
      expect(editLockService.acquireLock).not.toHaveBeenCalled();
    });

    it('emits INVALID_PAYLOAD on malformed edit:start payload', async () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);

      await getHandler(WebSocketEvent.EDIT_START)({ boardId: 'not-a-uuid', objectId: OBJECT_ID });

      expect(socket.emit).toHaveBeenCalledWith(
        WebSocketEvent.BOARD_ERROR,
        expect.objectContaining({ code: 'INVALID_PAYLOAD' })
      );
      expect(editLockService.acquireLock).not.toHaveBeenCalled();
    });

    it('emits INVALID_PAYLOAD when objectId is missing', async () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);

      await getHandler(WebSocketEvent.EDIT_START)({ boardId: BOARD_ID, timestamp: Date.now() });

      expect(socket.emit).toHaveBeenCalledWith(
        WebSocketEvent.BOARD_ERROR,
        expect.objectContaining({ code: 'INVALID_PAYLOAD' })
      );
    });

    it('gracefully handles acquireLock error (logs, does not emit board:error)', async () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);
      vi.mocked(editLockService.acquireLock).mockRejectedValue(new Error('Redis failure'));

      // Should not throw
      await expect(getHandler(WebSocketEvent.EDIT_START)(makeEditStartPayload())).resolves.toBeUndefined();

      // No board:error to client (per handler source — it only logs)
      expect(socket.emit).not.toHaveBeenCalledWith(WebSocketEvent.BOARD_ERROR, expect.anything());
    });

    it('emits edit:warning with all concurrent editors when multiple others are editing', async () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);
      const otherEditors = [
        { userId: 'user-2', userName: 'User Two' },
        { userId: 'user-3', userName: 'User Three' },
      ];
      vi.mocked(editLockService.acquireLock).mockResolvedValue({ otherEditors });

      await getHandler(WebSocketEvent.EDIT_START)(makeEditStartPayload());

      expect(trackedEmit).toHaveBeenCalledWith(
        socket,
        WebSocketEvent.EDIT_WARNING,
        expect.objectContaining({ editors: otherEditors })
      );
    });
  });

  // ── edit:end ──────────────────────────────────────────────────────────────

  describe('edit:end', () => {
    it('calls editLockService.releaseLock with correct arguments', async () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);
      vi.mocked(editLockService.releaseLock).mockResolvedValue(undefined as any);

      await getHandler(WebSocketEvent.EDIT_END)(makeEditEndPayload());

      expect(editLockService.releaseLock).toHaveBeenCalledWith(BOARD_ID, OBJECT_ID, USER_ID);
    });

    it('broadcasts edit:end to other users in the room after releasing lock', async () => {
      const socket = makeJoinedSocket();
      const toEmit = { emit: vi.fn() };
      vi.mocked(socket.to).mockReturnValue(toEmit as any);
      const getHandler = setupHandler(socket);
      vi.mocked(editLockService.releaseLock).mockResolvedValue(undefined as any);

      await getHandler(WebSocketEvent.EDIT_END)(makeEditEndPayload());

      expect(trackedEmit).toHaveBeenCalledWith(
        toEmit,
        WebSocketEvent.EDIT_END,
        expect.objectContaining({ boardId: BOARD_ID, objectId: OBJECT_ID, userId: USER_ID })
      );
    });

    it('emits INVALID_PAYLOAD on malformed edit:end payload (non-UUID boardId)', async () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);

      await getHandler(WebSocketEvent.EDIT_END)({ boardId: 'bad', objectId: OBJECT_ID, timestamp: Date.now() });

      expect(socket.emit).toHaveBeenCalledWith(
        WebSocketEvent.BOARD_ERROR,
        expect.objectContaining({ code: 'INVALID_PAYLOAD' })
      );
      expect(editLockService.releaseLock).not.toHaveBeenCalled();
    });

    it('emits INVALID_PAYLOAD when objectId is missing from edit:end', async () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);

      await getHandler(WebSocketEvent.EDIT_END)({ boardId: BOARD_ID, timestamp: Date.now() });

      expect(socket.emit).toHaveBeenCalledWith(
        WebSocketEvent.BOARD_ERROR,
        expect.objectContaining({ code: 'INVALID_PAYLOAD' })
      );
    });

    it('gracefully handles releaseLock error without emitting board:error', async () => {
      const socket = makeJoinedSocket();
      const getHandler = setupHandler(socket);
      vi.mocked(editLockService.releaseLock).mockRejectedValue(new Error('Redis timeout'));

      await expect(getHandler(WebSocketEvent.EDIT_END)(makeEditEndPayload())).resolves.toBeUndefined();

      // Handler only logs errors, does not emit board:error
      expect(socket.emit).not.toHaveBeenCalledWith(WebSocketEvent.BOARD_ERROR, expect.anything());
    });

    it('includes timestamp in the broadcast edit:end payload', async () => {
      const socket = makeJoinedSocket();
      const toEmit = { emit: vi.fn() };
      vi.mocked(socket.to).mockReturnValue(toEmit as any);
      const getHandler = setupHandler(socket);
      vi.mocked(editLockService.releaseLock).mockResolvedValue(undefined as any);

      await getHandler(WebSocketEvent.EDIT_END)(makeEditEndPayload());

      const call = vi.mocked(trackedEmit).mock.calls.find(
        ([, event]) => event === WebSocketEvent.EDIT_END
      );
      expect(call).toBeDefined();
      const payload = call![2] as Record<string, unknown>;
      expect(typeof payload.timestamp).toBe('number');
    });

    it('registers exactly one edit:end listener', () => {
      const socket = makeJoinedSocket();
      setupHandler(socket);

      const editEndCalls = vi.mocked(socket.on).mock.calls.filter(
        ([event]) => event === WebSocketEvent.EDIT_END
      );
      expect(editEndCalls).toHaveLength(1);
    });
  });
});
