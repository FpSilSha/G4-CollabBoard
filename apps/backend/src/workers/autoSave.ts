import { instrumentedRedis as redis } from '../utils/instrumentedRedis';
import { scanKeys } from '../utils/redisScan';
import { boardService } from '../services/boardService';
import { versionService } from '../services/versionService';
import prisma from '../models/index';
import { PERSISTENCE_CONFIG } from 'shared';
import { logger } from '../utils/logger';

/**
 * Background auto-save worker.
 *
 * Runs every PERSISTENCE_CONFIG.AUTO_SAVE_INTERVAL_MS (60s) and flushes
 * all active boards from Redis to Postgres using optimistic locking.
 *
 * Every Nth save (VERSION_SNAPSHOT_EVERY_N_SAVES = 5, i.e. every 5 min),
 * creates a version snapshot for the board.
 */

// Track how many times each board has been saved (for version snapshot cadence)
const boardSaveCount = new Map<string, number>();

let autoSaveInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Find all board IDs with at least one connected user.
 * Scans Redis presence keys (format: presence:{boardId}:{userId}).
 */
async function getActiveBoardIds(): Promise<string[]> {
  const presenceKeys = await scanKeys('presence:*:*');
  const uniqueBoardIds = new Set<string>();

  for (const key of presenceKeys) {
    // key format: presence:{boardId}:{userId}
    const segments = key.split(':');
    if (segments.length >= 3) {
      uniqueBoardIds.add(segments[1]);
    }
  }

  return Array.from(uniqueBoardIds);
}

/**
 * Attempt to create a version snapshot for a board.
 * All users now have version history enabled.
 */
async function createSnapshotIfEligible(boardId: string): Promise<void> {
  try {
    const board = await prisma.board.findUnique({
      where: { id: boardId },
      select: { ownerId: true },
    });

    if (!board) return;

    const cachedState = await boardService.getBoardStateFromRedis(boardId);
    if (!cachedState || cachedState.objects.length === 0) return;

    await versionService.createVersionSnapshot(
      boardId,
      board.ownerId,
      cachedState.objects as unknown[]
    );

    logger.info(`Version snapshot created for board ${boardId}`);
  } catch (snapshotError: unknown) {
    const errorMessage = snapshotError instanceof Error ? snapshotError.message : 'Unknown error';
    logger.warn(`Version snapshot failed for board ${boardId}: ${errorMessage}`);
    // Non-fatal: don't fail the save because snapshot failed
  }
}

/**
 * Save a single board from Redis to Postgres.
 * Returns true if the save succeeded, false if skipped or failed.
 */
async function saveBoard(boardId: string): Promise<boolean> {
  try {
    const flushResult = await boardService.flushRedisToPostgres(boardId);

    if (!flushResult.success) {
      // Version conflict: Postgres wins, Redis was overwritten by flushRedisToPostgres.
      // Reset save count since we lost sync with the snapshot cadence.
      boardSaveCount.set(boardId, 0);
      return false;
    }

    // Track save count for version snapshot cadence
    const consecutiveSaves = (boardSaveCount.get(boardId) ?? 0) + 1;
    boardSaveCount.set(boardId, consecutiveSaves);

    // Every Nth save, create a version snapshot
    if (consecutiveSaves % PERSISTENCE_CONFIG.VERSION_SNAPSHOT_EVERY_N_SAVES === 0) {
      await createSnapshotIfEligible(boardId);
    }

    return true;
  } catch (saveError: unknown) {
    const errorMessage = saveError instanceof Error ? saveError.message : 'Unknown error';
    logger.error(`Auto-save failed for board ${boardId}: ${errorMessage}`);
    return false;
  }
}

/**
 * Main auto-save tick. Runs every PERSISTENCE_CONFIG.AUTO_SAVE_INTERVAL_MS.
 */
async function autoSaveTick(): Promise<void> {
  try {
    const activeBoardIds = await getActiveBoardIds();
    if (activeBoardIds.length === 0) return;

    logger.debug(`Auto-save: processing ${activeBoardIds.length} active board(s)`);

    // Process boards in parallel batches to reduce auto-save latency at scale.
    // BATCH_SIZE=10 prevents overwhelming Postgres/Redis with concurrent writes.
    const BATCH_SIZE = 10;
    let successCount = 0;
    for (let i = 0; i < activeBoardIds.length; i += BATCH_SIZE) {
      const batch = activeBoardIds.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch.map(id => saveBoard(id)));
      successCount += results.filter(Boolean).length;
    }

    if (successCount > 0) {
      logger.info(`Auto-save: saved ${successCount}/${activeBoardIds.length} board(s)`);
    }
  } catch (tickError: unknown) {
    const errorMessage = tickError instanceof Error ? tickError.message : 'Unknown error';
    logger.error(`Auto-save tick error: ${errorMessage}`);
  }
}

/**
 * Start the auto-save background worker.
 */
export function startAutoSaveWorker(): void {
  if (autoSaveInterval) {
    logger.warn('Auto-save worker already running');
    return;
  }

  autoSaveInterval = setInterval(autoSaveTick, PERSISTENCE_CONFIG.AUTO_SAVE_INTERVAL_MS);
  logger.info(
    `Auto-save worker started (interval: ${PERSISTENCE_CONFIG.AUTO_SAVE_INTERVAL_MS}ms, ` +
    `snapshots every ${PERSISTENCE_CONFIG.VERSION_SNAPSHOT_EVERY_N_SAVES} saves)`
  );
}

/**
 * Stop the auto-save worker and perform a final flush of all active boards.
 * Called during graceful shutdown.
 */
export async function stopAutoSaveWorker(): Promise<void> {
  if (autoSaveInterval) {
    clearInterval(autoSaveInterval);
    autoSaveInterval = null;
  }

  // Final flush of all active boards before shutdown
  try {
    const activeBoardIds = await getActiveBoardIds();
    for (const boardId of activeBoardIds) {
      await saveBoard(boardId);
    }
    if (activeBoardIds.length > 0) {
      logger.info(`Auto-save worker stopped. Final flush of ${activeBoardIds.length} board(s).`);
    } else {
      logger.info('Auto-save worker stopped. No active boards to flush.');
    }
  } catch (shutdownError: unknown) {
    const errorMessage = shutdownError instanceof Error ? shutdownError.message : 'Unknown error';
    logger.error(`Auto-save final flush error: ${errorMessage}`);
  }

  boardSaveCount.clear();
}
