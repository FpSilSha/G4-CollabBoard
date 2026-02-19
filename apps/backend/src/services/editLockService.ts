import { instrumentedRedis as redis } from '../utils/instrumentedRedis';
import { EDIT_LOCK_CONFIG } from 'shared';
import { logger } from '../utils/logger';

/**
 * Lightweight Redis-backed edit lock for sticky note text editing.
 *
 * Key format: `editlock:{boardId}:{objectId}`
 * Value: userId of the lock holder
 * TTL: EDIT_LOCK_CONFIG.LOCK_TTL_SECONDS (20s)
 *
 * Lifecycle:
 *   - Lock acquired when user opens textarea (edit:start)
 *   - Lock released when user closes textarea (edit:end / blur)
 *   - On disconnect while editing, lock persists for TTL (grace period)
 *   - On reconnect within grace period, user reclaims the lock
 *   - After TTL expires, lock auto-releases so others can edit
 *
 * This is NOT a strict mutex — other users' updates are still accepted
 * (LWW). The lock is advisory: it tells other users' clients "someone
 * is editing this sticky" so they can show a visual indicator.
 */

const { LOCK_TTL_SECONDS } = EDIT_LOCK_CONFIG;

function lockKey(boardId: string, objectId: string): string {
  return `editlock:${boardId}:${objectId}`;
}

export const editLockService = {
  /**
   * Acquire an edit lock on an object.
   * Only succeeds if no lock exists or the same user already holds it.
   */
  async acquireLock(
    boardId: string,
    objectId: string,
    userId: string
  ): Promise<{ acquired: boolean; heldBy?: string }> {
    const key = lockKey(boardId, objectId);
    const existing = await redis.get(key);

    if (existing && existing !== userId) {
      return { acquired: false, heldBy: existing };
    }

    // Set lock with TTL — if user disconnects, lock auto-expires
    await redis.setex(key, LOCK_TTL_SECONDS, userId);
    return { acquired: true };
  },

  /**
   * Release an edit lock. Only the lock holder can release it.
   */
  async releaseLock(
    boardId: string,
    objectId: string,
    userId: string
  ): Promise<void> {
    const key = lockKey(boardId, objectId);
    const existing = await redis.get(key);

    if (existing === userId) {
      await redis.del(key);
    }
  },

  /**
   * Check who holds the edit lock on an object (if anyone).
   */
  async getLockHolder(
    boardId: string,
    objectId: string
  ): Promise<string | null> {
    const key = lockKey(boardId, objectId);
    return redis.get(key);
  },

  /**
   * Refresh the TTL on a lock (called on reconnect to reclaim).
   * Only refreshes if the same user holds the lock.
   */
  async refreshLock(
    boardId: string,
    objectId: string,
    userId: string
  ): Promise<boolean> {
    const key = lockKey(boardId, objectId);
    const existing = await redis.get(key);

    if (existing === userId) {
      await redis.setex(key, LOCK_TTL_SECONDS, userId);
      return true;
    }

    return false;
  },

  /**
   * Get all objects locked by a specific user on a board.
   * Used during disconnect to know which objects have active edit locks.
   */
  async getUserLocks(
    boardId: string,
    userId: string
  ): Promise<string[]> {
    const pattern = `editlock:${boardId}:*`;
    const keys = await redis.keys(pattern);

    if (keys.length === 0) return [];

    const pipeline = redis.pipeline();
    keys.forEach((key) => pipeline.get(key));
    const results = await pipeline.exec();

    if (!results) return [];

    const lockedObjectIds: string[] = [];
    for (let i = 0; i < keys.length; i++) {
      const [err, value] = results[i];
      if (!err && value === userId) {
        // Extract objectId from key: editlock:{boardId}:{objectId}
        const objectId = keys[i].substring(`editlock:${boardId}:`.length);
        lockedObjectIds.push(objectId);
      }
    }

    return lockedObjectIds;
  },
};
