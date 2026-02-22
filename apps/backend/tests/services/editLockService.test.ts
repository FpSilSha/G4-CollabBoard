import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/utils/redisScan', () => ({
  scanKeys: vi.fn(),
}));

import { editLockService } from '../../src/services/editLockService';
import { instrumentedRedis as redis } from '../../src/utils/instrumentedRedis';
import { scanKeys } from '../../src/utils/redisScan';
import { EDIT_LOCK_CONFIG } from 'shared';

const BOARD_ID = 'board-abc';
const OBJECT_ID = 'obj-123';
const USER_ID = 'user-1';
const USER_NAME = 'Alice';

describe('editLockService.acquireLock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls redis.setex with the correct key format and TTL', async () => {
    vi.mocked(redis.setex).mockResolvedValue('OK');
    vi.mocked(scanKeys).mockResolvedValue([]);

    await editLockService.acquireLock(BOARD_ID, OBJECT_ID, USER_ID, USER_NAME);

    const expectedKey = `editlock:${BOARD_ID}:${OBJECT_ID}:${USER_ID}`;
    expect(redis.setex).toHaveBeenCalledWith(
      expectedKey,
      EDIT_LOCK_CONFIG.LOCK_TTL_SECONDS,
      USER_NAME
    );
  });

  it('stores the userName as the lock value', async () => {
    vi.mocked(redis.setex).mockResolvedValue('OK');
    vi.mocked(scanKeys).mockResolvedValue([]);

    await editLockService.acquireLock(BOARD_ID, OBJECT_ID, USER_ID, 'Bob');

    expect(redis.setex).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Number),
      'Bob'
    );
  });

  it('returns empty otherEditors when no other locks exist', async () => {
    vi.mocked(redis.setex).mockResolvedValue('OK');
    vi.mocked(scanKeys).mockResolvedValue([]);

    const result = await editLockService.acquireLock(BOARD_ID, OBJECT_ID, USER_ID, USER_NAME);

    expect(result.otherEditors).toEqual([]);
  });

  it('returns other editors when other users hold locks on the same object', async () => {
    const otherUserId = 'user-2';
    const otherUserKey = `editlock:${BOARD_ID}:${OBJECT_ID}:${otherUserId}`;
    const ownKey = `editlock:${BOARD_ID}:${OBJECT_ID}:${USER_ID}`;

    vi.mocked(redis.setex).mockResolvedValue('OK');
    // keys returns both keys (the one just set and the other user's)
    vi.mocked(scanKeys).mockResolvedValue([ownKey, otherUserKey]);

    const mockPipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [null, USER_NAME],       // value for ownKey
        [null, 'Bob'],           // value for otherUserKey
      ]),
    };
    vi.mocked(redis.pipeline).mockReturnValue(mockPipeline as never);

    const result = await editLockService.acquireLock(BOARD_ID, OBJECT_ID, USER_ID, USER_NAME);

    // Should exclude the requesting user (USER_ID) and return the other editor
    expect(result.otherEditors).toHaveLength(1);
    expect(result.otherEditors[0]).toEqual({ userId: otherUserId, userName: 'Bob' });
  });

  it('uses the correct pattern for scanning object locks', async () => {
    vi.mocked(redis.setex).mockResolvedValue('OK');
    vi.mocked(scanKeys).mockResolvedValue([]);

    await editLockService.acquireLock(BOARD_ID, OBJECT_ID, USER_ID, USER_NAME);

    // keys should have been called with the object pattern
    expect(scanKeys).toHaveBeenCalledWith(`editlock:${BOARD_ID}:${OBJECT_ID}:*`);
  });
});

describe('editLockService.releaseLock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls redis.del with the correct key', async () => {
    vi.mocked(redis.del).mockResolvedValue(1);

    await editLockService.releaseLock(BOARD_ID, OBJECT_ID, USER_ID);

    const expectedKey = `editlock:${BOARD_ID}:${OBJECT_ID}:${USER_ID}`;
    expect(redis.del).toHaveBeenCalledWith(expectedKey);
  });

  it('calls redis.del exactly once', async () => {
    vi.mocked(redis.del).mockResolvedValue(1);

    await editLockService.releaseLock(BOARD_ID, OBJECT_ID, USER_ID);

    expect(redis.del).toHaveBeenCalledTimes(1);
  });
});

describe('editLockService.refreshLock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true and calls setex when lock exists', async () => {
    vi.mocked(redis.get).mockResolvedValue(USER_NAME);
    vi.mocked(redis.setex).mockResolvedValue('OK');

    const result = await editLockService.refreshLock(BOARD_ID, OBJECT_ID, USER_ID);

    expect(result).toBe(true);
    expect(redis.setex).toHaveBeenCalledWith(
      `editlock:${BOARD_ID}:${OBJECT_ID}:${USER_ID}`,
      EDIT_LOCK_CONFIG.LOCK_TTL_SECONDS,
      USER_NAME
    );
  });

  it('returns false when lock does not exist (expired or never set)', async () => {
    vi.mocked(redis.get).mockResolvedValue(null);

    const result = await editLockService.refreshLock(BOARD_ID, OBJECT_ID, USER_ID);

    expect(result).toBe(false);
    expect(redis.setex).not.toHaveBeenCalled();
  });

  it('extends TTL using the configured LOCK_TTL_SECONDS', async () => {
    vi.mocked(redis.get).mockResolvedValue('Charlie');
    vi.mocked(redis.setex).mockResolvedValue('OK');

    await editLockService.refreshLock(BOARD_ID, OBJECT_ID, USER_ID);

    expect(redis.setex).toHaveBeenCalledWith(
      expect.any(String),
      EDIT_LOCK_CONFIG.LOCK_TTL_SECONDS,
      'Charlie'
    );
  });
});

describe('editLockService.getObjectEditors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when no keys match the pattern', async () => {
    vi.mocked(scanKeys).mockResolvedValue([]);

    const result = await editLockService.getObjectEditors(BOARD_ID, OBJECT_ID);

    expect(result).toEqual([]);
  });

  it('returns all editors when no excludeUserId provided', async () => {
    const key1 = `editlock:${BOARD_ID}:${OBJECT_ID}:user-1`;
    const key2 = `editlock:${BOARD_ID}:${OBJECT_ID}:user-2`;
    vi.mocked(scanKeys).mockResolvedValue([key1, key2]);

    const mockPipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [null, 'Alice'],
        [null, 'Bob'],
      ]),
    };
    vi.mocked(redis.pipeline).mockReturnValue(mockPipeline as never);

    const result = await editLockService.getObjectEditors(BOARD_ID, OBJECT_ID);

    expect(result).toHaveLength(2);
    expect(result).toContainEqual({ userId: 'user-1', userName: 'Alice' });
    expect(result).toContainEqual({ userId: 'user-2', userName: 'Bob' });
  });

  it('excludes the specified userId from results', async () => {
    const key1 = `editlock:${BOARD_ID}:${OBJECT_ID}:user-1`;
    const key2 = `editlock:${BOARD_ID}:${OBJECT_ID}:user-2`;
    vi.mocked(scanKeys).mockResolvedValue([key1, key2]);

    const mockPipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [null, 'Alice'],
        [null, 'Bob'],
      ]),
    };
    vi.mocked(redis.pipeline).mockReturnValue(mockPipeline as never);

    const result = await editLockService.getObjectEditors(BOARD_ID, OBJECT_ID, 'user-1');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ userId: 'user-2', userName: 'Bob' });
  });

  it('skips entries with errors or null usernames', async () => {
    const key1 = `editlock:${BOARD_ID}:${OBJECT_ID}:user-1`;
    const key2 = `editlock:${BOARD_ID}:${OBJECT_ID}:user-2`;
    vi.mocked(scanKeys).mockResolvedValue([key1, key2]);

    const mockPipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [new Error('Key expired'), null], // error case
        [null, 'Bob'],
      ]),
    };
    vi.mocked(redis.pipeline).mockReturnValue(mockPipeline as never);

    const result = await editLockService.getObjectEditors(BOARD_ID, OBJECT_ID);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ userId: 'user-2', userName: 'Bob' });
  });

  it('returns empty array when pipeline.exec returns null', async () => {
    const key1 = `editlock:${BOARD_ID}:${OBJECT_ID}:user-1`;
    vi.mocked(scanKeys).mockResolvedValue([key1]);

    const mockPipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue(null),
    };
    vi.mocked(redis.pipeline).mockReturnValue(mockPipeline as never);

    const result = await editLockService.getObjectEditors(BOARD_ID, OBJECT_ID);

    expect(result).toEqual([]);
  });
});

describe('editLockService.getUserLocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when no locks exist for the board', async () => {
    vi.mocked(scanKeys).mockResolvedValue([]);

    const result = await editLockService.getUserLocks(BOARD_ID, USER_ID);

    expect(result).toEqual([]);
  });

  it('returns objectIds for keys matching the userId suffix', async () => {
    const matchingKey = `editlock:${BOARD_ID}:${OBJECT_ID}:${USER_ID}`;
    const otherKey = `editlock:${BOARD_ID}:other-obj:user-2`;
    vi.mocked(scanKeys).mockResolvedValue([matchingKey, otherKey]);

    const result = await editLockService.getUserLocks(BOARD_ID, USER_ID);

    expect(result).toHaveLength(1);
    expect(result).toContain(OBJECT_ID);
  });

  it('uses the board lock pattern for redis.keys call', async () => {
    vi.mocked(scanKeys).mockResolvedValue([]);

    await editLockService.getUserLocks(BOARD_ID, USER_ID);

    expect(scanKeys).toHaveBeenCalledWith(`editlock:${BOARD_ID}:*`);
  });
});

describe('editLockService.getAllLocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when no editlock keys exist', async () => {
    vi.mocked(scanKeys).mockResolvedValue([]);

    const result = await editLockService.getAllLocks();

    expect(result).toEqual([]);
  });

  it('returns lock entries with objectId, userId, and userName', async () => {
    const key = `editlock:${BOARD_ID}:${OBJECT_ID}:${USER_ID}`;
    vi.mocked(scanKeys).mockResolvedValue([key]);

    const mockPipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([[null, USER_NAME]]),
    };
    vi.mocked(redis.pipeline).mockReturnValue(mockPipeline as never);

    const result = await editLockService.getAllLocks();

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      objectId: OBJECT_ID,
      userId: USER_ID,
      userName: USER_NAME,
    });
  });

  it('skips entries with fewer than 4 colon-separated parts', async () => {
    vi.mocked(scanKeys).mockResolvedValue(['editlock:bad-key']);

    const mockPipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([[null, 'Someone']]),
    };
    vi.mocked(redis.pipeline).mockReturnValue(mockPipeline as never);

    const result = await editLockService.getAllLocks();

    expect(result).toEqual([]);
  });

  it('scans using the global editlock:* pattern', async () => {
    vi.mocked(scanKeys).mockResolvedValue([]);

    await editLockService.getAllLocks();

    expect(scanKeys).toHaveBeenCalledWith('editlock:*');
  });
});
