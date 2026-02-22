import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/utils/instrumentedRedis', () => ({
  instrumentedRedis: {
    scan: vi.fn(),
  },
}));

import { scanKeys } from '../../src/utils/redisScan';
import { instrumentedRedis as redis } from '../../src/utils/instrumentedRedis';

describe('scanKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all keys matching pattern in a single batch', async () => {
    vi.mocked(redis.scan).mockResolvedValue(['0', ['key:1', 'key:2', 'key:3']] as never);

    const result = await scanKeys('key:*');

    expect(result).toEqual(['key:1', 'key:2', 'key:3']);
    expect(redis.scan).toHaveBeenCalledWith('0', 'MATCH', 'key:*', 'COUNT', 100);
  });

  it('iterates multiple cursor rounds until cursor returns to 0', async () => {
    vi.mocked(redis.scan)
      .mockResolvedValueOnce(['42', ['key:a', 'key:b']] as never)
      .mockResolvedValueOnce(['99', ['key:c']] as never)
      .mockResolvedValueOnce(['0', ['key:d']] as never);

    const result = await scanKeys('key:*');

    expect(result).toEqual(['key:a', 'key:b', 'key:c', 'key:d']);
    expect(redis.scan).toHaveBeenCalledTimes(3);
  });

  it('returns empty array when no keys match', async () => {
    vi.mocked(redis.scan).mockResolvedValue(['0', []] as never);

    const result = await scanKeys('nonexistent:*');

    expect(result).toEqual([]);
  });

  it('passes the correct pattern argument', async () => {
    vi.mocked(redis.scan).mockResolvedValue(['0', []] as never);

    await scanKeys('editlock:board-1:*');

    expect(redis.scan).toHaveBeenCalledWith('0', 'MATCH', 'editlock:board-1:*', 'COUNT', 100);
  });
});
