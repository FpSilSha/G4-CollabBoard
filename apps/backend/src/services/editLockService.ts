import { instrumentedRedis as redis } from '../utils/instrumentedRedis';
import { EDIT_LOCK_CONFIG } from 'shared';
import { logger } from '../utils/logger';

/**
 * Multi-user Redis-backed edit lock for sticky note text editing.
 *
 * Key format: `editlock:{boardId}:{objectId}:{userId}`
 * Value: userName (for display in warning banners)
 * TTL: EDIT_LOCK_CONFIG.LOCK_TTL_SECONDS (20s)
 *
 * Multiple users CAN hold locks on the same object simultaneously.
 * The lock is purely advisory — LWW determines whose text wins.
 * The lock serves two purposes:
 *   1. Disconnect grace period (each user gets their own TTL)
 *   2. Concurrent edit warnings (show who else is editing)
 *
 * Lifecycle:
 *   - Lock acquired when user opens edit modal (edit:start)
 *   - Lock released when user closes modal (edit:end / confirm / cancel)
 *   - On disconnect while editing, lock persists for TTL (grace period)
 *   - On reconnect within grace period, user reclaims the lock
 *   - After TTL expires, lock auto-releases
 */

const { LOCK_TTL_SECONDS } = EDIT_LOCK_CONFIG;

function userLockKey(boardId: string, objectId: string, userId: string): string {
  return `editlock:${boardId}:${objectId}:${userId}`;
}

function objectLockPattern(boardId: string, objectId: string): string {
  return `editlock:${boardId}:${objectId}:*`;
}

function boardLockPattern(boardId: string): string {
  return `editlock:${boardId}:*`;
}

export const editLockService = {
  /**
   * Acquire an edit lock on an object for a specific user.
   * Always succeeds — multiple users can hold locks simultaneously.
   * Returns the list of OTHER users currently editing this object.
   */
  async acquireLock(
    boardId: string,
    objectId: string,
    userId: string,
    userName: string
  ): Promise<{ otherEditors: Array<{ userId: string; userName: string }> }> {
    const key = userLockKey(boardId, objectId, userId);

    // Set this user's lock with TTL
    await redis.setex(key, LOCK_TTL_SECONDS, userName);

    // Find other users editing this object
    const otherEditors = await this.getObjectEditors(boardId, objectId, userId);

    return { otherEditors };
  },

  /**
   * Release an edit lock for a specific user.
   */
  async releaseLock(
    boardId: string,
    objectId: string,
    userId: string
  ): Promise<void> {
    const key = userLockKey(boardId, objectId, userId);
    await redis.del(key);
  },

  /**
   * Get all users currently editing a specific object (excluding one user).
   */
  async getObjectEditors(
    boardId: string,
    objectId: string,
    excludeUserId?: string
  ): Promise<Array<{ userId: string; userName: string }>> {
    const pattern = objectLockPattern(boardId, objectId);
    const keys = await redis.keys(pattern);

    if (keys.length === 0) return [];

    const pipeline = redis.pipeline();
    keys.forEach((key) => pipeline.get(key));
    const results = await pipeline.exec();

    if (!results) return [];

    const editors: Array<{ userId: string; userName: string }> = [];
    const prefix = `editlock:${boardId}:${objectId}:`;

    for (let i = 0; i < keys.length; i++) {
      const [err, userName] = results[i];
      if (err || !userName) continue;

      const editorUserId = keys[i].substring(prefix.length);
      if (excludeUserId && editorUserId === excludeUserId) continue;

      editors.push({ userId: editorUserId, userName: userName as string });
    }

    return editors;
  },

  /**
   * Refresh the TTL on a user's lock (called on reconnect to reclaim).
   */
  async refreshLock(
    boardId: string,
    objectId: string,
    userId: string
  ): Promise<boolean> {
    const key = userLockKey(boardId, objectId, userId);
    const existing = await redis.get(key);

    if (existing !== null) {
      await redis.setex(key, LOCK_TTL_SECONDS, existing);
      return true;
    }

    return false;
  },

  /**
   * Get all objects locked by a specific user on a board.
   * Used during disconnect/reconnect to know which objects have active edit locks.
   */
  async getUserLocks(
    boardId: string,
    userId: string
  ): Promise<string[]> {
    const pattern = boardLockPattern(boardId);
    const keys = await redis.keys(pattern);

    if (keys.length === 0) return [];

    // Filter keys that end with this user's ID
    // Key format: editlock:{boardId}:{objectId}:{userId}
    const suffix = `:${userId}`;
    const lockedObjectIds: string[] = [];

    for (const key of keys) {
      if (key.endsWith(suffix)) {
        // Extract objectId: remove prefix and suffix
        const withoutPrefix = key.substring(`editlock:${boardId}:`.length);
        const objectId = withoutPrefix.substring(0, withoutPrefix.length - suffix.length);
        lockedObjectIds.push(objectId);
      }
    }

    return lockedObjectIds;
  },

  /**
   * Get all active edit locks for the metrics endpoint.
   * Returns a flat list of { objectId, userId, userName } entries.
   */
  async getAllLocks(): Promise<Array<{ objectId: string; userId: string; userName: string }>> {
    const keys = await redis.keys('editlock:*');
    if (keys.length === 0) return [];

    const pipeline = redis.pipeline();
    keys.forEach((key) => pipeline.get(key));
    const results = await pipeline.exec();

    if (!results) return [];

    const locks: Array<{ objectId: string; userId: string; userName: string }> = [];
    for (let i = 0; i < keys.length; i++) {
      const [err, userName] = results[i];
      if (err || !userName) continue;

      // Key format: editlock:{boardId}:{objectId}:{userId}
      const parts = keys[i].split(':');
      // parts[0] = "editlock", parts[1] = boardId, last = userId, middle = objectId
      if (parts.length < 4) continue;
      const editorUserId = parts[parts.length - 1];
      const objectId = parts.slice(2, parts.length - 1).join(':');

      locks.push({ objectId, userId: editorUserId, userName: userName as string });
    }

    return locks;
  },
};
