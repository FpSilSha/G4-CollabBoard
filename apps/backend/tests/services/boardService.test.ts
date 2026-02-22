import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { boardService } from '../../src/services/boardService';
import prisma from '../../src/models/index';
import { instrumentedRedis as redis } from '../../src/utils/instrumentedRedis';
import { AppError } from '../../src/middleware/errorHandler';
import { makeBoard, makeBoardObject, makeCachedBoardState } from '../mocks/factories';

// The global setup.ts mock for linkedBoard does not include deleteMany.
// Add the missing method here.
beforeAll(() => {
  const linkedBoardMock = prisma.linkedBoard as Record<string, unknown>;
  if (!linkedBoardMock.deleteMany) {
    linkedBoardMock.deleteMany = vi.fn();
  }
});

// Helper: serialize a CachedBoardState the same way boardService does
function serializeState(state: ReturnType<typeof makeCachedBoardState>): string {
  return JSON.stringify(state);
}

describe('boardService.createBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a board with slot 0 when no boards exist', async () => {
    vi.mocked(prisma.board.findMany).mockResolvedValue([]);
    vi.mocked(prisma.board.create).mockResolvedValue(
      makeBoard({ id: 'board-new', slot: 0, title: 'My Board' }) as never
    );

    const result = await boardService.createBoard('user-1', 'My Board');

    expect(prisma.board.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ ownerId: 'user-1', title: 'My Board', slot: 0 }),
    });
    expect(result.slot).toBe(0);
  });

  it('uses next available slot when slots 0 and 1 are taken', async () => {
    vi.mocked(prisma.board.findMany).mockResolvedValue([
      { slot: 0 },
      { slot: 1 },
    ] as never);
    vi.mocked(prisma.board.create).mockResolvedValue(
      makeBoard({ slot: 2 }) as never
    );

    await boardService.createBoard('user-1', 'Board 3');

    expect(prisma.board.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ slot: 2 }),
    });
  });

  it('finds the first gap in slot numbering', async () => {
    // slots 0, 1, 3 exist — gap is at 2
    vi.mocked(prisma.board.findMany).mockResolvedValue([
      { slot: 0 },
      { slot: 1 },
      { slot: 3 },
    ] as never);
    vi.mocked(prisma.board.create).mockResolvedValue(makeBoard({ slot: 2 }) as never);

    await boardService.createBoard('user-1', 'Gap Board');

    expect(prisma.board.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ slot: 2 }),
    });
  });

  it('returns the new board shape with empty objects', async () => {
    vi.mocked(prisma.board.findMany).mockResolvedValue([]);
    vi.mocked(prisma.board.create).mockResolvedValue(
      makeBoard({ id: 'board-abc', title: 'Test', slot: 0 }) as never
    );

    const result = await boardService.createBoard('user-1', 'Test');

    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('title');
    expect(result.objects).toEqual([]);
  });
});

describe('boardService.getBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws 404 when board does not exist', async () => {
    vi.mocked(prisma.board.findUnique).mockResolvedValue(null);

    await expect(boardService.getBoard('nonexistent', 'user-1')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('throws 404 when board is soft-deleted', async () => {
    vi.mocked(prisma.board.findUnique).mockResolvedValue(
      makeBoard({ isDeleted: true }) as never
    );

    await expect(boardService.getBoard('board-1', 'user-1')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('returns the board data for a valid board', async () => {
    const board = makeBoard({ id: 'board-1', title: 'My Board', ownerId: 'user-1', isDeleted: false });
    vi.mocked(prisma.board.findUnique).mockResolvedValue(board as never);
    vi.mocked(prisma.board.update).mockResolvedValue(board as never);
    vi.mocked(prisma.linkedBoard.upsert).mockResolvedValue({} as never);

    const result = await boardService.getBoard('board-1', 'user-1');

    expect(result.id).toBe('board-1');
    expect(result.title).toBe('My Board');
  });

  it('upserts a linked board record when user is not the owner', async () => {
    const board = makeBoard({ ownerId: 'owner-user', id: 'board-1', isDeleted: false });
    vi.mocked(prisma.board.findUnique).mockResolvedValue(board as never);
    vi.mocked(prisma.board.update).mockResolvedValue(board as never);
    vi.mocked(prisma.linkedBoard.upsert).mockResolvedValue({} as never);

    await boardService.getBoard('board-1', 'visitor-user');

    expect(prisma.linkedBoard.upsert).toHaveBeenCalledWith({
      where: { userId_boardId: { userId: 'visitor-user', boardId: 'board-1' } },
      create: { userId: 'visitor-user', boardId: 'board-1' },
      update: {},
    });
  });

  it('does NOT call linkedBoard.upsert when user is the owner', async () => {
    const board = makeBoard({ ownerId: 'user-1', id: 'board-1', isDeleted: false });
    vi.mocked(prisma.board.findUnique).mockResolvedValue(board as never);
    vi.mocked(prisma.board.update).mockResolvedValue(board as never);

    await boardService.getBoard('board-1', 'user-1');

    expect(prisma.linkedBoard.upsert).not.toHaveBeenCalled();
  });

  it('includes maxObjectsPerBoard in the response', async () => {
    const board = makeBoard({ ownerId: 'user-1', isDeleted: false });
    vi.mocked(prisma.board.findUnique).mockResolvedValue(board as never);
    vi.mocked(prisma.board.update).mockResolvedValue(board as never);

    const result = await boardService.getBoard(board.id, 'user-1');

    expect(result.maxObjectsPerBoard).toBeDefined();
    expect(typeof result.maxObjectsPerBoard).toBe('number');
  });
});

describe('boardService.renameBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws 404 when board does not exist', async () => {
    vi.mocked(prisma.board.findUnique).mockResolvedValue(null);

    await expect(
      boardService.renameBoard('nonexistent', 'user-1', 'New Title')
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 403 when user is not the owner', async () => {
    vi.mocked(prisma.board.findUnique).mockResolvedValue(
      makeBoard({ ownerId: 'other-user' }) as never
    );

    await expect(
      boardService.renameBoard('board-1', 'user-1', 'New Title')
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('updates the title and returns id + title', async () => {
    const board = makeBoard({ ownerId: 'user-1', id: 'board-1' });
    vi.mocked(prisma.board.findUnique).mockResolvedValue(board as never);
    vi.mocked(prisma.board.update).mockResolvedValue({ id: 'board-1', title: 'Renamed' } as never);

    const result = await boardService.renameBoard('board-1', 'user-1', 'Renamed');

    expect(result).toEqual({ id: 'board-1', title: 'Renamed' });
    expect(prisma.board.update).toHaveBeenCalledWith({
      where: { id: 'board-1' },
      data: { title: 'Renamed' },
    });
  });
});

describe('boardService.deleteBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws 404 when board does not exist', async () => {
    vi.mocked(prisma.board.findUnique).mockResolvedValue(null);

    await expect(boardService.deleteBoard('nonexistent', 'user-1')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('throws 403 when user is not the owner', async () => {
    vi.mocked(prisma.board.findUnique).mockResolvedValue(
      makeBoard({ ownerId: 'other-user' }) as never
    );

    await expect(boardService.deleteBoard('board-1', 'user-1')).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('soft-deletes by setting isDeleted=true', async () => {
    const board = makeBoard({ ownerId: 'user-1', id: 'board-1' });
    vi.mocked(prisma.board.findUnique).mockResolvedValue(board as never);
    vi.mocked(prisma.board.update).mockResolvedValue({} as never);

    await boardService.deleteBoard('board-1', 'user-1');

    expect(prisma.board.update).toHaveBeenCalledWith({
      where: { id: 'board-1' },
      data: expect.objectContaining({ isDeleted: true }),
    });
  });

  it('returns success=true, deletedAt, and permanentDeletionAt (30 days later)', async () => {
    const board = makeBoard({ ownerId: 'user-1', id: 'board-1' });
    vi.mocked(prisma.board.findUnique).mockResolvedValue(board as never);
    vi.mocked(prisma.board.update).mockResolvedValue({} as never);

    const result = await boardService.deleteBoard('board-1', 'user-1');

    expect(result.success).toBe(true);
    expect(result.deletedAt).toBeInstanceOf(Date);
    expect(result.permanentDeletionAt).toBeInstanceOf(Date);

    // permanentDeletionAt should be ~30 days after deletedAt
    const diffDays =
      (result.permanentDeletionAt.getTime() - result.deletedAt.getTime()) /
      (1000 * 60 * 60 * 24);
    expect(diffDays).toBeCloseTo(30, 0);
  });
});

describe('boardService.addObject (Postgres)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws 404 when board does not exist', async () => {
    vi.mocked(prisma.board.findUnique).mockResolvedValue(null);

    await expect(
      boardService.addObject('nonexistent', { id: 'obj-1', type: 'sticky' })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 409 when an object with the same ID already exists', async () => {
    const existingObj = makeBoardObject({ id: 'obj-dup' });
    vi.mocked(prisma.board.findUnique).mockResolvedValue(
      makeBoard({ objects: [existingObj] }) as never
    );

    await expect(
      boardService.addObject('board-1', { id: 'obj-dup', type: 'sticky' })
    ).rejects.toMatchObject({ statusCode: 409, code: 'DUPLICATE_OBJECT' });
  });

  it('appends the new object and calls prisma.board.update', async () => {
    const existing = makeBoardObject({ id: 'obj-existing' });
    vi.mocked(prisma.board.findUnique).mockResolvedValue(
      makeBoard({ objects: [existing] }) as never
    );
    vi.mocked(prisma.board.update).mockResolvedValue({} as never);

    const newObj = { id: 'obj-new', type: 'sticky' };
    await boardService.addObject('board-1', newObj);

    const updateCall = vi.mocked(prisma.board.update).mock.calls[0][0];
    const updatedObjects = updateCall.data.objects as unknown[];
    expect(updatedObjects).toHaveLength(2);
    expect(updatedObjects).toContainEqual(expect.objectContaining({ id: 'obj-new' }));
  });
});

describe('boardService.updateObject (Postgres)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws 404 when board does not exist', async () => {
    vi.mocked(prisma.board.findUnique).mockResolvedValue(null);

    await expect(
      boardService.updateObject('nonexistent', 'obj-1', { text: 'hello' })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 404 when object does not exist on the board', async () => {
    vi.mocked(prisma.board.findUnique).mockResolvedValue(
      makeBoard({ objects: [] }) as never
    );

    await expect(
      boardService.updateObject('board-1', 'nonexistent-obj', { text: 'hi' })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('merges updates into the existing object (LWW)', async () => {
    const obj = makeBoardObject({ id: 'obj-1', text: 'original', x: 100 });
    vi.mocked(prisma.board.findUnique).mockResolvedValue(
      makeBoard({ objects: [obj] }) as never
    );
    vi.mocked(prisma.board.update).mockResolvedValue({} as never);

    await boardService.updateObject('board-1', 'obj-1', { text: 'updated' });

    const updateCall = vi.mocked(prisma.board.update).mock.calls[0][0];
    const objects = updateCall.data.objects as Record<string, unknown>[];
    const updatedObj = objects.find((o) => o.id === 'obj-1');
    expect(updatedObj?.text).toBe('updated');
    expect(updatedObj?.x).toBe(100); // original field preserved
  });
});

describe('boardService.removeObject (Postgres)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws 404 when board does not exist', async () => {
    vi.mocked(prisma.board.findUnique).mockResolvedValue(null);

    await expect(
      boardService.removeObject('nonexistent', 'obj-1')
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 404 when object does not exist on board', async () => {
    vi.mocked(prisma.board.findUnique).mockResolvedValue(
      makeBoard({ objects: [] }) as never
    );

    await expect(
      boardService.removeObject('board-1', 'nonexistent-obj')
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('removes the matching object and writes back the rest', async () => {
    const obj1 = makeBoardObject({ id: 'obj-1' });
    const obj2 = makeBoardObject({ id: 'obj-2' });
    vi.mocked(prisma.board.findUnique).mockResolvedValue(
      makeBoard({ objects: [obj1, obj2] }) as never
    );
    vi.mocked(prisma.board.update).mockResolvedValue({} as never);

    await boardService.removeObject('board-1', 'obj-1');

    const updateCall = vi.mocked(prisma.board.update).mock.calls[0][0];
    const remaining = updateCall.data.objects as Record<string, unknown>[];
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('obj-2');
  });
});

// ============================================================
// Redis-Backed Board State Methods
// ============================================================

describe('boardService.getBoardStateFromRedis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when no cache exists in Redis', async () => {
    vi.mocked(redis.get).mockResolvedValue(null);

    const result = await boardService.getBoardStateFromRedis('board-1');

    expect(result).toBeNull();
    expect(redis.get).toHaveBeenCalledWith('board:board-1:state');
  });

  it('parses and returns the CachedBoardState from Redis JSON', async () => {
    const state = makeCachedBoardState({
      boardId: 'board-1',
      objects: [makeBoardObject({ id: 'obj-1' })],
    });
    vi.mocked(redis.get).mockResolvedValue(JSON.stringify(state));

    const result = await boardService.getBoardStateFromRedis('board-1');

    expect(result).toEqual(state);
  });

  it('uses the correct Redis key format (board:{boardId}:state)', async () => {
    vi.mocked(redis.get).mockResolvedValue(null);

    await boardService.getBoardStateFromRedis('test-board-xyz');

    expect(redis.get).toHaveBeenCalledWith('board:test-board-xyz:state');
  });
});

describe('boardService.saveBoardStateToRedis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('serializes the state to JSON and calls redis.set', async () => {
    vi.mocked(redis.set).mockResolvedValue('OK');

    const state = makeCachedBoardState({ boardId: 'board-1' });
    await boardService.saveBoardStateToRedis('board-1', state as never);

    expect(redis.set).toHaveBeenCalledWith(
      'board:board-1:state',
      JSON.stringify(state)
    );
  });
});

describe('boardService.loadBoardToRedis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws 404 when board does not exist in Postgres', async () => {
    vi.mocked(prisma.board.findUnique).mockResolvedValue(null);

    await expect(boardService.loadBoardToRedis('nonexistent')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('writes the board state to Redis and returns it', async () => {
    const obj = makeBoardObject({ id: 'obj-1' });
    vi.mocked(prisma.board.findUnique).mockResolvedValue({
      objects: [obj],
      version: 3,
    } as never);
    vi.mocked(redis.set).mockResolvedValue('OK');

    const result = await boardService.loadBoardToRedis('board-1');

    expect(redis.set).toHaveBeenCalledWith(
      'board:board-1:state',
      expect.stringContaining('"postgresVersion":3')
    );
    expect(result.postgresVersion).toBe(3);
    expect(result.objects).toHaveLength(1);
  });

  it('initializes lastSyncedAt to a recent timestamp', async () => {
    vi.mocked(prisma.board.findUnique).mockResolvedValue({
      objects: [],
      version: 1,
    } as never);
    vi.mocked(redis.set).mockResolvedValue('OK');

    const before = Date.now();
    const result = await boardService.loadBoardToRedis('board-1');
    const after = Date.now();

    expect(result.lastSyncedAt).toBeGreaterThanOrEqual(before);
    expect(result.lastSyncedAt).toBeLessThanOrEqual(after);
  });
});

describe('boardService.addObjectInRedis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('appends the object to the cached state and saves it back', async () => {
    const existingObj = makeBoardObject({ id: 'obj-existing' });
    const state = makeCachedBoardState({ objects: [existingObj] });
    vi.mocked(redis.get).mockResolvedValue(serializeState(state));
    vi.mocked(redis.set).mockResolvedValue('OK');

    const newObj = { id: 'obj-new', type: 'sticky', x: 200, y: 200 };
    await boardService.addObjectInRedis('board-1', newObj);

    const setCall = vi.mocked(redis.set).mock.calls[0];
    const savedState = JSON.parse(setCall[1] as string);
    expect(savedState.objects).toHaveLength(2);
    expect(savedState.objects.some((o: { id: string }) => o.id === 'obj-new')).toBe(true);
  });

  it('throws 409 AppError when object with same ID already exists in cache', async () => {
    const existingObj = makeBoardObject({ id: 'dup-obj' });
    const state = makeCachedBoardState({ objects: [existingObj] });
    vi.mocked(redis.get).mockResolvedValue(serializeState(state));

    await expect(
      boardService.addObjectInRedis('board-1', { id: 'dup-obj', type: 'sticky' })
    ).rejects.toMatchObject({ statusCode: 409, code: 'DUPLICATE_OBJECT' });
  });

  it('loads from Postgres and adds object when Redis cache is empty', async () => {
    // First redis.get returns null (no cache), triggers loadBoardToRedis
    vi.mocked(redis.get)
      .mockResolvedValueOnce(null) // getBoardStateFromRedis: no cache
      .mockResolvedValueOnce(null); // after load, getBoardStateFromRedis again is not called; loadBoardToRedis writes directly
    vi.mocked(prisma.board.findUnique).mockResolvedValue({
      objects: [],
      version: 1,
    } as never);
    vi.mocked(redis.set).mockResolvedValue('OK');

    const newObj = { id: 'obj-fresh', type: 'sticky' };
    await boardService.addObjectInRedis('board-1', newObj);

    // redis.set should have been called at least once (once for load, once for add)
    expect(redis.set).toHaveBeenCalled();
    const lastSetCall = vi.mocked(redis.set).mock.calls[vi.mocked(redis.set).mock.calls.length - 1];
    const savedState = JSON.parse(lastSetCall[1] as string);
    expect(savedState.objects.some((o: { id: string }) => o.id === 'obj-fresh')).toBe(true);
  });
});

describe('boardService.updateObjectInRedis', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('merges updates into the existing object (LWW)', async () => {
    const obj = makeBoardObject({ id: 'obj-1', text: 'original', x: 50 });
    const state = makeCachedBoardState({ objects: [obj] });
    vi.mocked(redis.get).mockResolvedValue(serializeState(state));
    vi.mocked(redis.set).mockResolvedValue('OK');

    await boardService.updateObjectInRedis('board-1', 'obj-1', { text: 'updated' });

    const setCall = vi.mocked(redis.set).mock.calls[0];
    const savedState = JSON.parse(setCall[1] as string);
    const updatedObj = savedState.objects.find((o: { id: string }) => o.id === 'obj-1');
    expect(updatedObj.text).toBe('updated');
    expect(updatedObj.x).toBe(50); // original field preserved
  });

  it('throws 404 AppError when object does not exist in cached state', async () => {
    const state = makeCachedBoardState({ objects: [] });
    vi.mocked(redis.get).mockResolvedValue(serializeState(state));

    await expect(
      boardService.updateObjectInRedis('board-1', 'nonexistent-obj', { text: 'hi' })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('saves the updated state back to Redis', async () => {
    const obj = makeBoardObject({ id: 'obj-1' });
    const state = makeCachedBoardState({ objects: [obj] });
    vi.mocked(redis.get).mockResolvedValue(serializeState(state));
    vi.mocked(redis.set).mockResolvedValue('OK');

    await boardService.updateObjectInRedis('board-1', 'obj-1', { color: '#FF0000' });

    expect(redis.set).toHaveBeenCalledWith(
      'board:board-1:state',
      expect.any(String)
    );
  });
});

describe('boardService.removeObjectFromRedis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('removes the object from the cached state', async () => {
    const obj1 = makeBoardObject({ id: 'obj-1' });
    const obj2 = makeBoardObject({ id: 'obj-2' });
    const state = makeCachedBoardState({ objects: [obj1, obj2] });
    vi.mocked(redis.get).mockResolvedValue(serializeState(state));
    vi.mocked(redis.set).mockResolvedValue('OK');

    await boardService.removeObjectFromRedis('board-1', 'obj-1');

    const setCall = vi.mocked(redis.set).mock.calls[0];
    const savedState = JSON.parse(setCall[1] as string);
    expect(savedState.objects).toHaveLength(1);
    expect(savedState.objects[0].id).toBe('obj-2');
  });

  it('throws 404 AppError when object is not in cached state', async () => {
    const obj = makeBoardObject({ id: 'obj-1' });
    const state = makeCachedBoardState({ objects: [obj] });
    vi.mocked(redis.get).mockResolvedValue(serializeState(state));

    await expect(
      boardService.removeObjectFromRedis('board-1', 'nonexistent')
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('saves the updated (smaller) state back to Redis', async () => {
    const obj = makeBoardObject({ id: 'obj-to-remove' });
    const state = makeCachedBoardState({ objects: [obj] });
    vi.mocked(redis.get).mockResolvedValue(serializeState(state));
    vi.mocked(redis.set).mockResolvedValue('OK');

    await boardService.removeObjectFromRedis('board-1', 'obj-to-remove');

    expect(redis.set).toHaveBeenCalledWith(
      'board:board-1:state',
      expect.any(String)
    );
    const setCall = vi.mocked(redis.set).mock.calls[0];
    const savedState = JSON.parse(setCall[1] as string);
    expect(savedState.objects).toHaveLength(0);
  });
});

describe('boardService.unlinkBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls linkedBoard.deleteMany with correct userId and boardId', async () => {
    vi.mocked(prisma.linkedBoard.deleteMany).mockResolvedValue({ count: 1 } as never);

    await boardService.unlinkBoard('board-1', 'user-1');

    expect(prisma.linkedBoard.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', boardId: 'board-1' },
    });
  });

  it('returns success: true', async () => {
    vi.mocked(prisma.linkedBoard.deleteMany).mockResolvedValue({ count: 1 } as never);

    const result = await boardService.unlinkBoard('board-1', 'user-1');

    expect(result).toEqual({ success: true });
  });
});

describe('boardService.saveThumbnail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('saves thumbnail when no cooldown restriction exists', async () => {
    vi.mocked(prisma.board.findUnique).mockResolvedValue(
      { thumbnailUpdatedAt: null } as never
    );
    vi.mocked(prisma.board.update).mockResolvedValue({} as never);

    const result = await boardService.saveThumbnail('board-1', 'data:image/jpeg;base64,...');

    expect(result).toEqual({ success: true });
    expect(prisma.board.update).toHaveBeenCalledWith({
      where: { id: 'board-1' },
      data: expect.objectContaining({ thumbnail: 'data:image/jpeg;base64,...' }),
    });
  });

  it('returns cooldown reason when thumbnail was updated less than 5 minutes ago', async () => {
    const recentUpdate = new Date(Date.now() - 2 * 60 * 1000); // 2 minutes ago
    vi.mocked(prisma.board.findUnique).mockResolvedValue(
      { thumbnailUpdatedAt: recentUpdate } as never
    );

    const result = await boardService.saveThumbnail('board-1', 'data:...');

    expect(result).toEqual({ success: false, reason: 'cooldown' });
    expect(prisma.board.update).not.toHaveBeenCalled();
  });

  it('saves thumbnail when last update was more than 5 minutes ago', async () => {
    const oldUpdate = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
    vi.mocked(prisma.board.findUnique).mockResolvedValue(
      { thumbnailUpdatedAt: oldUpdate } as never
    );
    vi.mocked(prisma.board.update).mockResolvedValue({} as never);

    const result = await boardService.saveThumbnail('board-1', 'data:image/jpeg;base64,...');

    expect(result).toEqual({ success: true });
  });

  it('stores the thumbnailVersion when provided', async () => {
    vi.mocked(prisma.board.findUnique).mockResolvedValue(
      { thumbnailUpdatedAt: null } as never
    );
    vi.mocked(prisma.board.update).mockResolvedValue({} as never);

    await boardService.saveThumbnail('board-1', 'data:...', 42);

    const updateCall = vi.mocked(prisma.board.update).mock.calls[0][0];
    expect(updateCall.data).toMatchObject({ thumbnailVersion: 42 });
  });

  it('does not set thumbnailVersion when version is not provided', async () => {
    vi.mocked(prisma.board.findUnique).mockResolvedValue(
      { thumbnailUpdatedAt: null } as never
    );
    vi.mocked(prisma.board.update).mockResolvedValue({} as never);

    await boardService.saveThumbnail('board-1', 'data:...');

    const updateCall = vi.mocked(prisma.board.update).mock.calls[0][0];
    expect(updateCall.data).not.toHaveProperty('thumbnailVersion');
  });
});

describe('AppError shape', () => {
  it('has the correct statusCode and message', () => {
    const err = new AppError(404, 'Not found');
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Not found');
    expect(err.name).toBe('AppError');
  });

  it('stores the optional error code', () => {
    const err = new AppError(409, 'Duplicate', 'DUPLICATE_OBJECT');
    expect(err.code).toBe('DUPLICATE_OBJECT');
  });

  it('is an instance of Error', () => {
    const err = new AppError(500, 'Something went wrong');
    expect(err).toBeInstanceOf(Error);
  });
});
