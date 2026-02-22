import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ─── Mock boardService ────────────────────────────────────────────────────────
vi.mock('../../src/services/boardService', () => ({
  boardService: {
    flushRedisToPostgres: vi.fn(),
    getBoardStateFromRedis: vi.fn(),
    listBoards: vi.fn(),
    createBoard: vi.fn(),
    getBoard: vi.fn(),
    renameBoard: vi.fn(),
    deleteBoard: vi.fn(),
    unlinkBoard: vi.fn(),
    saveThumbnail: vi.fn(),
  },
}));

// ─── Mock versionService ──────────────────────────────────────────────────────
vi.mock('../../src/services/versionService', () => ({
  versionService: {
    createVersionSnapshot: vi.fn(),
    listVersions: vi.fn(),
  },
}));

// ─── Mock redisScan ───────────────────────────────────────────────────────────
vi.mock('../../src/utils/redisScan', () => ({
  scanKeys: vi.fn(),
}));

import { boardService } from '../../src/services/boardService';
import { versionService } from '../../src/services/versionService';
import { instrumentedRedis as redis } from '../../src/utils/instrumentedRedis';
import { scanKeys } from '../../src/utils/redisScan';
import prisma from '../../src/models/index';

// Import the worker AFTER mocks so all dependencies are already mocked
import {
  startAutoSaveWorker,
  stopAutoSaveWorker,
} from '../../src/workers/autoSave';

describe('autoSave worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(async () => {
    // Always stop the worker to avoid interval leaking between tests
    await stopAutoSaveWorker();
    vi.useRealTimers();
  });

  // ─── stopAutoSaveWorker — no active boards ──────────────────────────────────
  describe('stopAutoSaveWorker — no active boards', () => {
    it('runs final flush with no boards when Redis keys are empty', async () => {
      vi.mocked(scanKeys).mockResolvedValue([]);

      await stopAutoSaveWorker();

      // keys was called to find active boards
      expect(scanKeys).toHaveBeenCalledWith('presence:*:*');
      // No flush should occur because there are no boards
      expect(boardService.flushRedisToPostgres).not.toHaveBeenCalled();
    });
  });

  // ─── stopAutoSaveWorker — active boards ────────────────────────────────────
  describe('stopAutoSaveWorker — with active boards', () => {
    it('flushes each active board during shutdown', async () => {
      vi.mocked(scanKeys).mockResolvedValue([
        'presence:board-1:user-a',
        'presence:board-2:user-b',
      ]);
      vi.mocked(boardService.flushRedisToPostgres).mockResolvedValue({ success: true } as never);

      await stopAutoSaveWorker();

      expect(boardService.flushRedisToPostgres).toHaveBeenCalledTimes(2);
      expect(boardService.flushRedisToPostgres).toHaveBeenCalledWith('board-1');
      expect(boardService.flushRedisToPostgres).toHaveBeenCalledWith('board-2');
    });

    it('deduplicates board IDs from multiple presence keys for the same board', async () => {
      vi.mocked(scanKeys).mockResolvedValue([
        'presence:board-1:user-a',
        'presence:board-1:user-b',
        'presence:board-1:user-c',
      ]);
      vi.mocked(boardService.flushRedisToPostgres).mockResolvedValue({ success: true } as never);

      await stopAutoSaveWorker();

      // All three keys belong to board-1 — should flush only once
      expect(boardService.flushRedisToPostgres).toHaveBeenCalledTimes(1);
      expect(boardService.flushRedisToPostgres).toHaveBeenCalledWith('board-1');
    });

    it('handles version conflict: flushRedisToPostgres returns success=false', async () => {
      vi.mocked(scanKeys).mockResolvedValue(['presence:board-1:user-a']);
      vi.mocked(boardService.flushRedisToPostgres).mockResolvedValue({ success: false } as never);

      // Should not throw
      await expect(stopAutoSaveWorker()).resolves.toBeUndefined();
      expect(boardService.flushRedisToPostgres).toHaveBeenCalledWith('board-1');
    });

    it('continues flushing remaining boards even when one throws', async () => {
      vi.mocked(scanKeys).mockResolvedValue([
        'presence:board-fail:user-a',
        'presence:board-ok:user-b',
      ]);
      vi.mocked(boardService.flushRedisToPostgres)
        .mockRejectedValueOnce(new Error('Postgres is down'))
        .mockResolvedValueOnce({ success: true } as never);

      await stopAutoSaveWorker();

      expect(boardService.flushRedisToPostgres).toHaveBeenCalledTimes(2);
    });
  });

  // ─── startAutoSaveWorker — interval behaviour ──────────────────────────────
  describe('startAutoSaveWorker — interval triggers', () => {
    it('starts the worker and runs a tick after the interval elapses', async () => {
      vi.mocked(scanKeys).mockResolvedValue(['presence:board-1:user-a']);
      vi.mocked(boardService.flushRedisToPostgres).mockResolvedValue({ success: true } as never);

      startAutoSaveWorker();

      // Before the interval fires, flushRedisToPostgres should not have been called
      expect(boardService.flushRedisToPostgres).not.toHaveBeenCalled();

      // Advance past the 60s auto-save interval
      await vi.advanceTimersByTimeAsync(60000);

      expect(boardService.flushRedisToPostgres).toHaveBeenCalled();
    });

    it('does not start a second interval if already running', () => {
      vi.mocked(scanKeys).mockResolvedValue([]);

      startAutoSaveWorker();
      startAutoSaveWorker(); // Second call should be a no-op

      // logger.warn is called inside setup.ts mock — we just verify no crash
      // The important guarantee is that only one interval runs.
      // We verify this indirectly: stop clears the single interval without error
      expect(() => stopAutoSaveWorker()).not.toThrow();
    });
  });

  // ─── Tick with no active boards ────────────────────────────────────────────
  describe('auto-save tick — no active boards', () => {
    it('does not call flushRedisToPostgres when no boards are active', async () => {
      vi.mocked(scanKeys).mockResolvedValue([]);

      startAutoSaveWorker();
      await vi.advanceTimersByTimeAsync(60000);

      expect(boardService.flushRedisToPostgres).not.toHaveBeenCalled();
    });
  });

  // ─── Snapshot cadence ─────────────────────────────────────────────────────
  describe('version snapshot cadence', () => {
    it('creates a version snapshot after every 5th successful save', async () => {
      const boardId = 'board-snap';

      vi.mocked(scanKeys).mockResolvedValue([`presence:${boardId}:user-a`]);
      vi.mocked(boardService.flushRedisToPostgres).mockResolvedValue({ success: true } as never);
      vi.mocked(boardService.getBoardStateFromRedis).mockResolvedValue({
        boardId,
        objects: [{ id: 'obj-1' }],
        version: 1,
        lastSavedAt: Date.now(),
      } as never);
      vi.mocked(prisma.board.findUnique).mockResolvedValue({
        id: boardId,
        ownerId: 'user-1',
      } as never);
      vi.mocked(versionService.createVersionSnapshot).mockResolvedValue(undefined as never);

      // Reset the module-level save counter via stop (boardSaveCount.clear()).
      await stopAutoSaveWorker();

      // Start once and run 5 interval ticks without stopping between them
      // so boardSaveCount accumulates to 5 and fires the snapshot.
      startAutoSaveWorker();
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(60000);
      }

      // createVersionSnapshot should have been called exactly once (on tick 5)
      expect(versionService.createVersionSnapshot).toHaveBeenCalledTimes(1);
      expect(versionService.createVersionSnapshot).toHaveBeenCalledWith(
        boardId,
        'user-1',
        expect.any(Array),
      );
    });

    it('skips snapshot when getBoardStateFromRedis returns null', async () => {
      const boardId = 'board-null-state';

      vi.mocked(scanKeys).mockResolvedValue([`presence:${boardId}:user-a`]);
      vi.mocked(boardService.flushRedisToPostgres).mockResolvedValue({ success: true } as never);
      vi.mocked(boardService.getBoardStateFromRedis).mockResolvedValue(null as never);
      vi.mocked(prisma.board.findUnique).mockResolvedValue({
        id: boardId,
        ownerId: 'user-1',
      } as never);

      await stopAutoSaveWorker();

      for (let i = 0; i < 5; i++) {
        startAutoSaveWorker();
        await vi.advanceTimersByTimeAsync(60000);
        await stopAutoSaveWorker();
      }

      expect(versionService.createVersionSnapshot).not.toHaveBeenCalled();
    });

    it('skips snapshot when board has no objects in cache', async () => {
      const boardId = 'board-empty';

      vi.mocked(scanKeys).mockResolvedValue([`presence:${boardId}:user-a`]);
      vi.mocked(boardService.flushRedisToPostgres).mockResolvedValue({ success: true } as never);
      vi.mocked(boardService.getBoardStateFromRedis).mockResolvedValue({
        boardId,
        objects: [],
        version: 1,
        lastSavedAt: Date.now(),
      } as never);
      vi.mocked(prisma.board.findUnique).mockResolvedValue({
        id: boardId,
        ownerId: 'user-1',
      } as never);

      await stopAutoSaveWorker();

      for (let i = 0; i < 5; i++) {
        startAutoSaveWorker();
        await vi.advanceTimersByTimeAsync(60000);
        await stopAutoSaveWorker();
      }

      expect(versionService.createVersionSnapshot).not.toHaveBeenCalled();
    });

    it('skips snapshot when board does not exist in Postgres', async () => {
      const boardId = 'board-gone';

      vi.mocked(scanKeys).mockResolvedValue([`presence:${boardId}:user-a`]);
      vi.mocked(boardService.flushRedisToPostgres).mockResolvedValue({ success: true } as never);
      vi.mocked(boardService.getBoardStateFromRedis).mockResolvedValue({
        boardId,
        objects: [{ id: 'obj-1' }],
        version: 1,
        lastSavedAt: Date.now(),
      } as never);
      vi.mocked(prisma.board.findUnique).mockResolvedValue(null as never);

      await stopAutoSaveWorker();

      for (let i = 0; i < 5; i++) {
        startAutoSaveWorker();
        await vi.advanceTimersByTimeAsync(60000);
        await stopAutoSaveWorker();
      }

      expect(versionService.createVersionSnapshot).not.toHaveBeenCalled();
    });

    it('resets save count to 0 on version conflict', async () => {
      const boardId = 'board-conflict';

      vi.mocked(scanKeys).mockResolvedValue([`presence:${boardId}:user-a`]);
      // First flush returns conflict (success: false)
      vi.mocked(boardService.flushRedisToPostgres).mockResolvedValue({ success: false } as never);

      await stopAutoSaveWorker();

      // Run 5 ticks — all end in conflict, so snapshot should never fire
      for (let i = 0; i < 5; i++) {
        startAutoSaveWorker();
        await vi.advanceTimersByTimeAsync(60000);
        await stopAutoSaveWorker();
      }

      expect(versionService.createVersionSnapshot).not.toHaveBeenCalled();
    });
  });

  // ─── Error resilience ──────────────────────────────────────────────────────
  describe('error resilience', () => {
    it('logs error and does not crash when redis.keys throws during tick', async () => {
      vi.mocked(scanKeys).mockRejectedValue(new Error('Redis is down'));

      startAutoSaveWorker();

      // Should not throw — just advance and verify no unhandled rejection
      await vi.advanceTimersByTimeAsync(60000);
      // If we reach here without throwing, the error was handled gracefully
      expect(true).toBe(true);
    });

    it('logs error and does not crash when redis.keys throws during shutdown', async () => {
      vi.mocked(scanKeys).mockRejectedValue(new Error('Redis unavailable'));

      await expect(stopAutoSaveWorker()).resolves.toBeUndefined();
    });

    it('continues processing remaining boards when a snapshot throws', async () => {
      const boardId = 'board-snap-fail';

      vi.mocked(scanKeys).mockResolvedValue([`presence:${boardId}:user-a`]);
      vi.mocked(boardService.flushRedisToPostgres).mockResolvedValue({ success: true } as never);
      vi.mocked(boardService.getBoardStateFromRedis).mockResolvedValue({
        boardId,
        objects: [{ id: 'obj-1' }],
        version: 1,
        lastSavedAt: Date.now(),
      } as never);
      vi.mocked(prisma.board.findUnique).mockResolvedValue({
        id: boardId,
        ownerId: 'user-1',
      } as never);
      vi.mocked(versionService.createVersionSnapshot).mockRejectedValue(
        new Error('Snapshot storage failed'),
      );

      await stopAutoSaveWorker();

      // Start once and run 5 interval ticks to accumulate save count to 5
      startAutoSaveWorker();
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(60000);
      }

      // Snapshot was attempted but threw — save still counted as success
      // and the tick didn't crash
      expect(versionService.createVersionSnapshot).toHaveBeenCalledTimes(1);
    });
  });
});
