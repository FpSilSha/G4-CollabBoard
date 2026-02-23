import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the instrumentedRedis module before importing the module under test
vi.mock('../../src/utils/instrumentedRedis', () => ({
  instrumentedRedis: {
    eval: vi.fn(),
  },
  rawRedis: {
    eval: vi.fn(),
  },
}));

import {
  atomicAddObject,
  atomicUpdateObject,
  atomicRemoveObject,
  atomicBatchAddObjects,
  atomicBatchUpdateObjects,
  atomicBatchRemoveObjects,
} from '../../src/utils/redisAtomicOps';
import { instrumentedRedis as redis } from '../../src/utils/instrumentedRedis';

describe('redisAtomicOps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── atomicAddObject ──────────────────────────────────────────────────────
  describe('atomicAddObject', () => {
    it('returns 0 on success', async () => {
      vi.mocked(redis.eval).mockResolvedValue(0 as never);

      const result = await atomicAddObject('board:b1:state', '{"id":"obj-1"}', 2000);

      expect(result).toBe(0);
      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining('cjson.decode'),
        1,
        'board:b1:state',
        '{"id":"obj-1"}',
        '2000'
      );
    });

    it('returns -1 for duplicate ID', async () => {
      vi.mocked(redis.eval).mockResolvedValue(-1 as never);

      const result = await atomicAddObject('board:b1:state', '{"id":"dup"}', 2000);

      expect(result).toBe(-1);
    });

    it('returns -2 when no state exists', async () => {
      vi.mocked(redis.eval).mockResolvedValue(-2 as never);

      const result = await atomicAddObject('board:b1:state', '{"id":"obj-1"}', 2000);

      expect(result).toBe(-2);
    });

    it('returns -3 when object limit reached', async () => {
      vi.mocked(redis.eval).mockResolvedValue(-3 as never);

      const result = await atomicAddObject('board:b1:state', '{"id":"obj-1"}', 100);

      expect(result).toBe(-3);
    });
  });

  // ─── atomicUpdateObject ──────────────────────────────────────────────────
  describe('atomicUpdateObject', () => {
    it('returns 0 on success', async () => {
      vi.mocked(redis.eval).mockResolvedValue(0 as never);

      const result = await atomicUpdateObject('board:b1:state', 'obj-1', '{"x":100}');

      expect(result).toBe(0);
    });

    it('returns -1 when object not found', async () => {
      vi.mocked(redis.eval).mockResolvedValue(-1 as never);

      const result = await atomicUpdateObject('board:b1:state', 'nonexistent', '{"x":100}');

      expect(result).toBe(-1);
    });

    it('returns -2 when no state exists', async () => {
      vi.mocked(redis.eval).mockResolvedValue(-2 as never);

      const result = await atomicUpdateObject('board:b1:state', 'obj-1', '{"x":100}');

      expect(result).toBe(-2);
    });
  });

  // ─── atomicRemoveObject ──────────────────────────────────────────────────
  describe('atomicRemoveObject', () => {
    it('returns 0 on success', async () => {
      vi.mocked(redis.eval).mockResolvedValue(0 as never);

      const result = await atomicRemoveObject('board:b1:state', 'obj-1');

      expect(result).toBe(0);
    });

    it('returns -1 when object not found', async () => {
      vi.mocked(redis.eval).mockResolvedValue(-1 as never);

      const result = await atomicRemoveObject('board:b1:state', 'nonexistent');

      expect(result).toBe(-1);
    });

    it('returns -2 when no state exists', async () => {
      vi.mocked(redis.eval).mockResolvedValue(-2 as never);

      const result = await atomicRemoveObject('board:b1:state', 'obj-1');

      expect(result).toBe(-2);
    });
  });

  // ─── atomicBatchAddObjects ────────────────────────────────────────────────
  describe('atomicBatchAddObjects', () => {
    it('returns count of added objects', async () => {
      vi.mocked(redis.eval).mockResolvedValue(3 as never);

      const result = await atomicBatchAddObjects('board:b1:state', '[{"id":"a"},{"id":"b"},{"id":"c"}]', 2000);

      expect(result).toBe(3);
    });

    it('returns -2 when no state exists', async () => {
      vi.mocked(redis.eval).mockResolvedValue(-2 as never);

      const result = await atomicBatchAddObjects('board:b1:state', '[]', 2000);

      expect(result).toBe(-2);
    });

    it('returns -3 when object limit reached', async () => {
      vi.mocked(redis.eval).mockResolvedValue(-3 as never);

      const result = await atomicBatchAddObjects('board:b1:state', '[{"id":"a"}]', 100);

      expect(result).toBe(-3);
    });
  });

  // ─── atomicBatchUpdateObjects ─────────────────────────────────────────────
  describe('atomicBatchUpdateObjects', () => {
    it('returns count of updated objects', async () => {
      vi.mocked(redis.eval).mockResolvedValue(2 as never);

      const result = await atomicBatchUpdateObjects(
        'board:b1:state',
        '[{"id":"a","x":10},{"id":"b","x":20}]'
      );

      expect(result).toBe(2);
    });

    it('returns -2 when no state exists', async () => {
      vi.mocked(redis.eval).mockResolvedValue(-2 as never);

      const result = await atomicBatchUpdateObjects('board:b1:state', '[]');

      expect(result).toBe(-2);
    });
  });

  // ─── atomicBatchRemoveObjects ─────────────────────────────────────────────
  describe('atomicBatchRemoveObjects', () => {
    it('returns count of removed objects', async () => {
      vi.mocked(redis.eval).mockResolvedValue(2 as never);

      const result = await atomicBatchRemoveObjects('board:b1:state', '["a","b"]');

      expect(result).toBe(2);
    });

    it('returns -2 when no state exists', async () => {
      vi.mocked(redis.eval).mockResolvedValue(-2 as never);

      const result = await atomicBatchRemoveObjects('board:b1:state', '["a"]');

      expect(result).toBe(-2);
    });
  });
});
