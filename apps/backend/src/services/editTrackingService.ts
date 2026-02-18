import { instrumentedRedis as redis } from '../utils/instrumentedRedis';
import { logger } from '../utils/logger';

/**
 * Tracks which user is actively editing each object on a board.
 *
 * Redis key: edit:{boardId}:{objectId}
 * Value: JSON { userId, userName, startedAt }
 * TTL: 5 minutes (auto-expires if user disconnects without cleanup)
 *
 * Only one user can hold an edit lock per object.
 */

const EDIT_LOCK_TTL_SECONDS = 300; // 5 minutes

export interface EditLock {
  userId: string;
  userName: string;
  startedAt: number;
}

function editLockKey(boardId: string, objectId: string): string {
  return `edit:${boardId}:${objectId}`;
}

export const editTrackingService = {
  /**
   * Attempt to start editing an object.
   *
   * If another user already holds the lock, returns their EditLock
   * (so the caller can emit a conflict:warning).
   * If no lock exists (or the same user already holds it), sets the lock
   * and returns null.
   */
  async startEdit(
    boardId: string,
    objectId: string,
    userId: string,
    userName: string
  ): Promise<EditLock | null> {
    const key = editLockKey(boardId, objectId);
    const existing = await redis.get(key);

    if (existing) {
      const lock: EditLock = JSON.parse(existing);

      // Same user re-selecting the same object — refresh TTL
      if (lock.userId === userId) {
        await redis.expire(key, EDIT_LOCK_TTL_SECONDS);
        return null;
      }

      // Different user holds the lock — conflict
      return lock;
    }

    // No lock exists — claim it
    const newLock: EditLock = { userId, userName, startedAt: Date.now() };
    await redis.setex(key, EDIT_LOCK_TTL_SECONDS, JSON.stringify(newLock));
    return null;
  },

  /**
   * End editing an object.
   * Only clears the lock if it belongs to the requesting user.
   */
  async endEdit(boardId: string, objectId: string, userId: string): Promise<void> {
    const key = editLockKey(boardId, objectId);
    const existing = await redis.get(key);

    if (!existing) return;

    const lock: EditLock = JSON.parse(existing);
    if (lock.userId === userId) {
      await redis.del(key);
    }
  },

  /**
   * Check if another user (excluding `excludeUserId`) is editing an object.
   * Returns their EditLock if so, null otherwise.
   */
  async getActiveEditor(
    boardId: string,
    objectId: string,
    excludeUserId: string
  ): Promise<EditLock | null> {
    const key = editLockKey(boardId, objectId);
    const existing = await redis.get(key);

    if (!existing) return null;

    const lock: EditLock = JSON.parse(existing);
    if (lock.userId === excludeUserId) return null;

    return lock;
  },

  /**
   * Clear all edit locks held by a user on a specific board.
   * Called during disconnect cleanup to release any stale locks.
   */
  async clearUserEdits(boardId: string, userId: string): Promise<void> {
    try {
      const pattern = `edit:${boardId}:*`;
      const keys = await redis.keys(pattern);

      if (keys.length === 0) return;

      for (const key of keys) {
        const existing = await redis.get(key);
        if (!existing) continue;

        const lock: EditLock = JSON.parse(existing);
        if (lock.userId === userId) {
          await redis.del(key);
        }
      }

      logger.debug(`Cleared edit locks for user ${userId} on board ${boardId}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.warn(`Failed to clear edit locks for user ${userId}: ${message}`);
    }
  },
};
