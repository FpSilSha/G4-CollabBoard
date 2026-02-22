import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { presenceService } from '../../src/services/presenceService';
import { instrumentedRedis as redis } from '../../src/utils/instrumentedRedis';

// PRESENCE_TTL from shared is 30 seconds
const PRESENCE_TTL = 30;

// Helper: build a minimal BoardUserInfo
function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'user-1',
    name: 'Alice',
    avatar: 'AL',
    color: '#FF0000',
    ...overrides,
  };
}

// Helper: serialize PresenceData into JSON the way the service stores it
function serializePresence(user: ReturnType<typeof makeUser>, lastHeartbeat = Date.now()) {
  return JSON.stringify({ ...user, lastHeartbeat });
}

// ─── addUser ─────────────────────────────────────────────────────────────────

describe('presenceService.addUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores user data under the correct Redis key with PRESENCE_TTL', async () => {
    vi.mocked(redis.setex).mockResolvedValue('OK');

    const user = makeUser({ userId: 'user-1' });
    await presenceService.addUser('board-abc', user);

    expect(redis.setex).toHaveBeenCalledOnce();
    const [key, ttl, value] = vi.mocked(redis.setex).mock.calls[0];
    expect(key).toBe('presence:board-abc:user-1');
    expect(ttl).toBe(PRESENCE_TTL);

    const stored = JSON.parse(value as string);
    expect(stored.userId).toBe('user-1');
    expect(stored.name).toBe('Alice');
    expect(stored.avatar).toBe('AL');
    expect(stored.color).toBe('#FF0000');
  });

  it('includes a lastHeartbeat timestamp close to now', async () => {
    vi.mocked(redis.setex).mockResolvedValue('OK');

    const before = Date.now();
    await presenceService.addUser('board-abc', makeUser());
    const after = Date.now();

    const [, , value] = vi.mocked(redis.setex).mock.calls[0];
    const stored = JSON.parse(value as string);
    expect(stored.lastHeartbeat).toBeGreaterThanOrEqual(before);
    expect(stored.lastHeartbeat).toBeLessThanOrEqual(after);
  });

  it('constructs the key using boardId and user.userId', async () => {
    vi.mocked(redis.setex).mockResolvedValue('OK');

    await presenceService.addUser('board-XYZ', makeUser({ userId: 'user-99' }));

    const [key] = vi.mocked(redis.setex).mock.calls[0];
    expect(key).toBe('presence:board-XYZ:user-99');
  });
});

// ─── removeUser ──────────────────────────────────────────────────────────────

describe('presenceService.removeUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes the correct Redis key', async () => {
    vi.mocked(redis.del).mockResolvedValue(1);

    await presenceService.removeUser('board-abc', 'user-1');

    expect(redis.del).toHaveBeenCalledWith('presence:board-abc:user-1');
  });

  it('uses boardId and userId to construct the key', async () => {
    vi.mocked(redis.del).mockResolvedValue(1);

    await presenceService.removeUser('board-Z', 'user-42');

    expect(redis.del).toHaveBeenCalledWith('presence:board-Z:user-42');
  });
});

// ─── refreshPresence ─────────────────────────────────────────────────────────

describe('presenceService.refreshPresence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates lastHeartbeat and re-stores with PRESENCE_TTL when key exists', async () => {
    const existing = serializePresence(makeUser({ userId: 'user-1' }), 1000);
    vi.mocked(redis.get).mockResolvedValue(existing);
    vi.mocked(redis.setex).mockResolvedValue('OK');

    const before = Date.now();
    await presenceService.refreshPresence('board-abc', 'user-1');
    const after = Date.now();

    expect(redis.get).toHaveBeenCalledWith('presence:board-abc:user-1');
    expect(redis.setex).toHaveBeenCalledOnce();

    const [key, ttl, value] = vi.mocked(redis.setex).mock.calls[0];
    expect(key).toBe('presence:board-abc:user-1');
    expect(ttl).toBe(PRESENCE_TTL);

    const stored = JSON.parse(value as string);
    // heartbeat should now be current time, not the original 1000
    expect(stored.lastHeartbeat).toBeGreaterThanOrEqual(before);
    expect(stored.lastHeartbeat).toBeLessThanOrEqual(after);
  });

  it('does nothing when the key does not exist in Redis', async () => {
    vi.mocked(redis.get).mockResolvedValue(null);

    await presenceService.refreshPresence('board-abc', 'user-ghost');

    expect(redis.setex).not.toHaveBeenCalled();
  });

  it('preserves all user fields (name, avatar, color) on refresh', async () => {
    const user = makeUser({ userId: 'user-2', name: 'Bob', avatar: 'BO', color: '#00FF00' });
    vi.mocked(redis.get).mockResolvedValue(serializePresence(user));
    vi.mocked(redis.setex).mockResolvedValue('OK');

    await presenceService.refreshPresence('board-abc', 'user-2');

    const [, , value] = vi.mocked(redis.setex).mock.calls[0];
    const stored = JSON.parse(value as string);
    expect(stored.name).toBe('Bob');
    expect(stored.avatar).toBe('BO');
    expect(stored.color).toBe('#00FF00');
  });
});

// ─── getBoardUsers ────────────────────────────────────────────────────────────

describe('presenceService.getBoardUsers', () => {
  // getBoardUsers uses redis.pipeline() which returns a pipeline mock.
  // We need to be able to customise pipeline.exec per test.
  let mockPipeline: { get: ReturnType<typeof vi.fn>; exec: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPipeline = {
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(redis.pipeline).mockReturnValue(mockPipeline as never);
  });

  it('returns empty array when no presence keys exist', async () => {
    vi.mocked(redis.keys).mockResolvedValue([]);

    const result = await presenceService.getBoardUsers('board-abc');

    expect(result).toEqual([]);
    expect(redis.pipeline).not.toHaveBeenCalled();
  });

  it('returns empty array when pipeline returns null results', async () => {
    vi.mocked(redis.keys).mockResolvedValue(['presence:board-abc:user-1']);
    mockPipeline.exec.mockResolvedValue(null);

    const result = await presenceService.getBoardUsers('board-abc');

    expect(result).toEqual([]);
  });

  it('returns parsed users from valid pipeline results', async () => {
    const user1 = makeUser({ userId: 'user-1', name: 'Alice' });
    const user2 = makeUser({ userId: 'user-2', name: 'Bob', color: '#0000FF' });
    vi.mocked(redis.keys).mockResolvedValue([
      'presence:board-abc:user-1',
      'presence:board-abc:user-2',
    ]);
    mockPipeline.exec.mockResolvedValue([
      [null, serializePresence(user1)],
      [null, serializePresence(user2)],
    ]);

    const result = await presenceService.getBoardUsers('board-abc');

    expect(result).toHaveLength(2);
    expect(result).toContainEqual({ userId: 'user-1', name: 'Alice', avatar: 'AL', color: '#FF0000' });
    expect(result).toContainEqual({ userId: 'user-2', name: 'Bob', avatar: 'AL', color: '#0000FF' });
  });

  it('skips entries with errors in pipeline results', async () => {
    const user1 = makeUser({ userId: 'user-1' });
    vi.mocked(redis.keys).mockResolvedValue([
      'presence:board-abc:user-1',
      'presence:board-abc:user-bad',
    ]);
    mockPipeline.exec.mockResolvedValue([
      [null, serializePresence(user1)],
      [new Error('Redis error'), null],
    ]);

    const result = await presenceService.getBoardUsers('board-abc');

    expect(result).toHaveLength(1);
    expect(result[0].userId).toBe('user-1');
  });

  it('skips null values in pipeline results', async () => {
    vi.mocked(redis.keys).mockResolvedValue(['presence:board-abc:user-gone']);
    mockPipeline.exec.mockResolvedValue([
      [null, null],
    ]);

    const result = await presenceService.getBoardUsers('board-abc');

    expect(result).toEqual([]);
  });

  it('skips malformed JSON in pipeline results without throwing', async () => {
    vi.mocked(redis.keys).mockResolvedValue(['presence:board-abc:user-corrupt']);
    mockPipeline.exec.mockResolvedValue([
      [null, 'not-valid-json{{{'],
    ]);

    await expect(presenceService.getBoardUsers('board-abc')).resolves.toEqual([]);
  });

  it('uses the correct key pattern for the board', async () => {
    vi.mocked(redis.keys).mockResolvedValue([]);

    await presenceService.getBoardUsers('board-XYZ');

    expect(redis.keys).toHaveBeenCalledWith('presence:board-XYZ:*');
  });

  it('result does not include lastHeartbeat (strips internal field)', async () => {
    const user1 = makeUser({ userId: 'user-1' });
    vi.mocked(redis.keys).mockResolvedValue(['presence:board-abc:user-1']);
    mockPipeline.exec.mockResolvedValue([[null, serializePresence(user1)]]);

    const result = await presenceService.getBoardUsers('board-abc');

    expect(result[0]).not.toHaveProperty('lastHeartbeat');
  });
});

// ─── removeUserFromAllBoards ──────────────────────────────────────────────────

describe('presenceService.removeUserFromAllBoards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array and does not call del when user has no presence keys', async () => {
    vi.mocked(redis.keys).mockResolvedValue([]);

    const result = await presenceService.removeUserFromAllBoards('user-ghost');

    expect(result).toEqual([]);
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('extracts boardIds from matching presence keys', async () => {
    vi.mocked(redis.keys).mockResolvedValue([
      'presence:board-1:user-1',
      'presence:board-2:user-1',
    ]);
    vi.mocked(redis.del).mockResolvedValue(2);

    const result = await presenceService.removeUserFromAllBoards('user-1');

    expect(result).toContain('board-1');
    expect(result).toContain('board-2');
    expect(result).toHaveLength(2);
  });

  it('calls redis.del with all found keys', async () => {
    const keys = ['presence:board-1:user-1', 'presence:board-2:user-1'];
    vi.mocked(redis.keys).mockResolvedValue(keys);
    vi.mocked(redis.del).mockResolvedValue(2);

    await presenceService.removeUserFromAllBoards('user-1');

    expect(redis.del).toHaveBeenCalledWith(...keys);
  });

  it('uses correct pattern to find user keys across all boards', async () => {
    vi.mocked(redis.keys).mockResolvedValue([]);

    await presenceService.removeUserFromAllBoards('user-42');

    expect(redis.keys).toHaveBeenCalledWith('presence:*:user-42');
  });

  it('ignores keys that do not match the expected 3-part format', async () => {
    // Malformed key should not crash and should not be included in boardIds
    vi.mocked(redis.keys).mockResolvedValue([
      'presence:board-1:user-1',
      'presence:boardwithcolons:extra:user-1', // 4 parts — boardId extraction skipped
    ]);
    vi.mocked(redis.del).mockResolvedValue(2);

    const result = await presenceService.removeUserFromAllBoards('user-1');

    expect(result).toContain('board-1');
    // 4-part key should not contribute a boardId (parts.length !== 3)
    expect(result).toHaveLength(1);
  });
});

// ─── setSession ──────────────────────────────────────────────────────────────

describe('presenceService.setSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores session data under the correct key with 24h TTL', async () => {
    vi.mocked(redis.setex).mockResolvedValue('OK');

    await presenceService.setSession('socket-abc', 'user-1', 'board-1');

    expect(redis.setex).toHaveBeenCalledOnce();
    const [key, ttl, value] = vi.mocked(redis.setex).mock.calls[0];
    expect(key).toBe('ws:session:socket-abc');
    expect(ttl).toBe(86400);

    const stored = JSON.parse(value as string);
    expect(stored.userId).toBe('user-1');
    expect(stored.boardId).toBe('board-1');
  });

  it('stores null for boardId when boardId is not provided', async () => {
    vi.mocked(redis.setex).mockResolvedValue('OK');

    await presenceService.setSession('socket-abc', 'user-1');

    const [, , value] = vi.mocked(redis.setex).mock.calls[0];
    const stored = JSON.parse(value as string);
    expect(stored.boardId).toBeNull();
  });

  it('includes a connectedAt timestamp close to now', async () => {
    vi.mocked(redis.setex).mockResolvedValue('OK');

    const before = Date.now();
    await presenceService.setSession('socket-abc', 'user-1');
    const after = Date.now();

    const [, , value] = vi.mocked(redis.setex).mock.calls[0];
    const stored = JSON.parse(value as string);
    expect(stored.connectedAt).toBeGreaterThanOrEqual(before);
    expect(stored.connectedAt).toBeLessThanOrEqual(after);
  });
});

// ─── getSession ──────────────────────────────────────────────────────────────

describe('presenceService.getSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when no session exists in Redis', async () => {
    vi.mocked(redis.get).mockResolvedValue(null);

    const result = await presenceService.getSession('socket-unknown');

    expect(result).toBeNull();
    expect(redis.get).toHaveBeenCalledWith('ws:session:socket-unknown');
  });

  it('returns parsed session data when key exists', async () => {
    const sessionData = { userId: 'user-1', boardId: 'board-abc', connectedAt: 12345 };
    vi.mocked(redis.get).mockResolvedValue(JSON.stringify(sessionData));

    const result = await presenceService.getSession('socket-xyz');

    expect(result).toMatchObject({ userId: 'user-1', boardId: 'board-abc' });
  });

  it('returns session with null boardId when no board is set', async () => {
    const sessionData = { userId: 'user-2', boardId: null, connectedAt: 67890 };
    vi.mocked(redis.get).mockResolvedValue(JSON.stringify(sessionData));

    const result = await presenceService.getSession('socket-xyz');

    expect(result?.boardId).toBeNull();
    expect(result?.userId).toBe('user-2');
  });
});

// ─── updateSessionBoard ───────────────────────────────────────────────────────

describe('presenceService.updateSessionBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates boardId in the session and re-stores with 24h TTL', async () => {
    const existing = JSON.stringify({ userId: 'user-1', boardId: 'old-board', connectedAt: 1000 });
    vi.mocked(redis.get).mockResolvedValue(existing);
    vi.mocked(redis.setex).mockResolvedValue('OK');

    await presenceService.updateSessionBoard('socket-abc', 'new-board');

    expect(redis.setex).toHaveBeenCalledOnce();
    const [key, ttl, value] = vi.mocked(redis.setex).mock.calls[0];
    expect(key).toBe('ws:session:socket-abc');
    expect(ttl).toBe(86400);
    const stored = JSON.parse(value as string);
    expect(stored.boardId).toBe('new-board');
  });

  it('sets boardId to null when passed null', async () => {
    const existing = JSON.stringify({ userId: 'user-1', boardId: 'some-board', connectedAt: 1000 });
    vi.mocked(redis.get).mockResolvedValue(existing);
    vi.mocked(redis.setex).mockResolvedValue('OK');

    await presenceService.updateSessionBoard('socket-abc', null);

    const [, , value] = vi.mocked(redis.setex).mock.calls[0];
    const stored = JSON.parse(value as string);
    expect(stored.boardId).toBeNull();
  });

  it('does nothing when session key does not exist', async () => {
    vi.mocked(redis.get).mockResolvedValue(null);

    await presenceService.updateSessionBoard('socket-ghost', 'board-1');

    expect(redis.setex).not.toHaveBeenCalled();
  });

  it('preserves userId and connectedAt when updating boardId', async () => {
    const existing = JSON.stringify({ userId: 'user-5', boardId: 'old', connectedAt: 99999 });
    vi.mocked(redis.get).mockResolvedValue(existing);
    vi.mocked(redis.setex).mockResolvedValue('OK');

    await presenceService.updateSessionBoard('socket-abc', 'new-board');

    const [, , value] = vi.mocked(redis.setex).mock.calls[0];
    const stored = JSON.parse(value as string);
    expect(stored.userId).toBe('user-5');
    expect(stored.connectedAt).toBe(99999);
  });
});

// ─── removeSession ────────────────────────────────────────────────────────────

describe('presenceService.removeSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes the session key from Redis', async () => {
    vi.mocked(redis.del).mockResolvedValue(1);

    await presenceService.removeSession('socket-abc');

    expect(redis.del).toHaveBeenCalledWith('ws:session:socket-abc');
  });

  it('uses the correct key format for the socket', async () => {
    vi.mocked(redis.del).mockResolvedValue(0);

    await presenceService.removeSession('socket-XYZ-99');

    expect(redis.del).toHaveBeenCalledWith('ws:session:socket-XYZ-99');
  });
});
