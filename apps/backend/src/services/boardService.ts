import prisma from '../models/index';
import { Prisma } from '@prisma/client';
import { MAX_OBJECTS_PER_BOARD, TIER_LIMITS, type CachedBoardState, type BoardObject } from 'shared';
import { instrumentedRedis as redis } from '../utils/instrumentedRedis';
import { metricsService } from './metricsService';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import {
  atomicAddObject,
  atomicUpdateObject,
  atomicRemoveObject,
} from '../utils/redisAtomicOps';

/** Redis key for a board's cached state. */
export function boardStateKey(boardId: string): string {
  return `board:${boardId}:state`;
}

/**
 * Safely parse Prisma's opaque JSON value into a typed BoardObject array.
 * Prisma returns JSON columns as `Prisma.JsonValue` which requires a cast.
 * Validated by Zod schema on write, so the cast here is safe.
 */
function parseBoardObjects(json: Prisma.JsonValue): BoardObject[] {
  if (!Array.isArray(json)) return [];
  return json as unknown as BoardObject[];
}

export const boardService = {
  async listBoards(userId: string, includeDeleted = false) {
    const where: Record<string, unknown> = { ownerId: userId };
    if (!includeDeleted) {
      where.isDeleted = false;
    }

    const ownedBoards = await prisma.board.findMany({
      where,
      orderBy: { slot: 'asc' },
      select: {
        id: true,
        ownerId: true,
        title: true,
        slot: true,
        lastAccessedAt: true,
        isDeleted: true,
        objects: true,
        thumbnail: true,
        version: true,
        thumbnailVersion: true,
        thumbnailUpdatedAt: true,
      },
    });

    // Linked boards — boards this user has visited via link (not owned)
    const linkedRecords = await prisma.linkedBoard.findMany({
      where: { userId },
      include: {
        board: {
          select: {
            id: true,
            ownerId: true,
            title: true,
            slot: true,
            lastAccessedAt: true,
            isDeleted: true,
            objects: true,
            thumbnail: true,
            version: true,
            thumbnailVersion: true,
            thumbnailUpdatedAt: true,
          },
        },
      },
    });

    const linkedBoards = linkedRecords
      .map((lb) => lb.board)
      .filter((b) => !b.isDeleted);

    // Pipeline all Redis reads to avoid N sequential roundtrips
    const allBoards = [...ownedBoards, ...linkedBoards];
    const pipeline = redis.pipeline();
    allBoards.forEach((b) => pipeline.get(boardStateKey(b.id)));
    const results = await pipeline.exec();
    const objectCounts = (results ?? []).map(([err, value]) => {
      if (err || !value) return null;
      try {
        return JSON.parse(value as string) as CachedBoardState;
      } catch {
        return null;
      }
    });

    const mapBoard = (b: typeof ownedBoards[0], isOwned: boolean, cachedState: CachedBoardState | null) => ({
      id: b.id,
      title: b.title,
      slot: b.slot,
      lastAccessedAt: b.lastAccessedAt,
      objectCount: cachedState
        ? cachedState.objects.length
        : Array.isArray(b.objects) ? (b.objects as unknown[]).length : 0,
      isDeleted: b.isDeleted,
      thumbnail: b.thumbnail,
      isOwned,
      ownerId: b.ownerId,
      version: b.version,
      thumbnailVersion: b.thumbnailVersion,
      thumbnailUpdatedAt: b.thumbnailUpdatedAt,
    });

    return {
      ownedBoards: ownedBoards.map((b, i) => mapBoard(b, true, objectCounts[i] ?? null)),
      linkedBoards: linkedBoards.map((b, i) => mapBoard(b, false, objectCounts[ownedBoards.length + i] ?? null)),
    };
  },

  async createBoard(userId: string, title: string) {
    // Enforce tier-based board slot limit
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { subscriptionTier: true },
    });
    if (!user) throw new AppError(404, 'User not found');

    const tierLimits = TIER_LIMITS[user.subscriptionTier];
    const activeBoards = await prisma.board.count({
      where: { ownerId: userId, isDeleted: false },
    });
    if (activeBoards >= tierLimits.BOARD_SLOTS) {
      throw new AppError(403, 'Board limit reached for your subscription tier', 'BOARD_LIMIT');
    }

    // Find next available slot.
    // Include ALL boards (even soft-deleted) because the unique constraint
    // on (ownerId, slot) applies to all rows regardless of isDeleted status.
    const existingSlots = await prisma.board.findMany({
      where: { ownerId: userId },
      select: { slot: true },
      orderBy: { slot: 'asc' },
    });

    const usedSlots = new Set(existingSlots.map((b) => b.slot));
    let nextSlot = 0;
    while (usedSlots.has(nextSlot)) {
      nextSlot++;
    }

    const board = await prisma.board.create({
      data: {
        ownerId: userId,
        title,
        slot: nextSlot,
        objects: [],
      },
    });

    return {
      id: board.id,
      title: board.title,
      slot: board.slot,
      objects: [],
      createdAt: board.createdAt,
    };
  },

  async getBoard(boardId: string, userId: string) {
    const board = await prisma.board.findUnique({
      where: { id: boardId },
    });

    if (!board) {
      throw new AppError(404, 'Board not found');
    }

    // Note: ownership check removed to enable link-based sharing.
    // Any authenticated user can view/join any board via its URL.
    // Ownership is still enforced for deleteBoard.

    if (board.isDeleted) {
      throw new AppError(404, 'Board has been deleted');
    }

    // Update lastAccessedAt
    await prisma.board.update({
      where: { id: boardId },
      data: { lastAccessedAt: new Date() },
    });

    // Auto-link: if user is not the owner, remember this board for their dashboard
    if (board.ownerId !== userId) {
      try {
        await prisma.linkedBoard.upsert({
          where: { userId_boardId: { userId, boardId } },
          create: { userId, boardId },
          update: {}, // no-op if already exists
        });
      } catch {
        // Non-critical — don't fail the board load if linking fails
      }
    }

    return {
      id: board.id,
      title: board.title,
      ownerId: board.ownerId,
      slot: board.slot,
      objects: board.objects as unknown[],
      version: board.version,
      lastAccessedAt: board.lastAccessedAt,
      maxObjectsPerBoard: MAX_OBJECTS_PER_BOARD,
      thumbnailUpdatedAt: board.thumbnailUpdatedAt,
    };
  },

  async renameBoard(boardId: string, userId: string, title: string) {
    const board = await prisma.board.findUnique({
      where: { id: boardId },
    });

    if (!board) {
      throw new AppError(404, 'Board not found');
    }

    if (board.ownerId !== userId) {
      throw new AppError(403, 'You do not have access to this board');
    }

    const updated = await prisma.board.update({
      where: { id: boardId },
      data: { title },
    });

    return {
      id: updated.id,
      title: updated.title,
    };
  },

  async deleteBoard(boardId: string, userId: string) {
    const board = await prisma.board.findUnique({
      where: { id: boardId },
    });

    if (!board) {
      throw new AppError(404, 'Board not found');
    }

    if (board.ownerId !== userId) {
      throw new AppError(403, 'You do not have access to this board');
    }

    const now = new Date();
    const permanentDeletionAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await prisma.board.update({
      where: { id: boardId },
      data: {
        isDeleted: true,
        deletedAt: now,
      },
    });

    return {
      success: true,
      deletedAt: now,
      permanentDeletionAt,
    };
  },

  /**
   * Add a new object to a board's objects JSON array.
   * Reads current objects, appends new one, writes back.
   */
  async addObject(boardId: string, object: Record<string, unknown>) {
    const board = await prisma.board.findUnique({
      where: { id: boardId },
      select: { objects: true },
    });

    if (!board) {
      throw new AppError(404, 'Board not found');
    }

    const objects = Array.isArray(board.objects)
      ? (board.objects as Prisma.JsonArray)
      : [];

    // Check for duplicate ID
    const existing = (objects as Record<string, unknown>[]).find(
      (o) => o.id === object.id
    );
    if (existing) {
      throw new AppError(409, 'Object with this ID already exists', 'DUPLICATE_OBJECT');
    }

    (objects as unknown as unknown[]).push(object);

    await prisma.board.update({
      where: { id: boardId },
      data: { objects: objects as Prisma.InputJsonArray },
    });
  },

  /**
   * Update an existing object within a board's objects JSON array.
   * Finds by object ID, merges updates (LWW), writes back.
   */
  async updateObject(boardId: string, objectId: string, updates: Record<string, unknown>) {
    const board = await prisma.board.findUnique({
      where: { id: boardId },
      select: { objects: true },
    });

    if (!board) {
      throw new AppError(404, 'Board not found');
    }

    const objects = Array.isArray(board.objects)
      ? (board.objects as Record<string, unknown>[])
      : [];

    const index = objects.findIndex((o) => o.id === objectId);

    if (index === -1) {
      throw new AppError(404, 'Object not found on board');
    }

    // Merge updates (LWW — last write wins)
    objects[index] = { ...objects[index], ...updates };

    await prisma.board.update({
      where: { id: boardId },
      data: { objects: objects as Prisma.InputJsonArray },
    });
  },

  /**
   * Remove an object from a board's objects JSON array.
   */
  async removeObject(boardId: string, objectId: string) {
    const board = await prisma.board.findUnique({
      where: { id: boardId },
      select: { objects: true },
    });

    if (!board) {
      throw new AppError(404, 'Board not found');
    }

    const objects = Array.isArray(board.objects)
      ? (board.objects as Record<string, unknown>[])
      : [];

    const filtered = objects.filter((o) => o.id !== objectId);

    if (filtered.length === objects.length) {
      throw new AppError(404, 'Object not found on board');
    }

    await prisma.board.update({
      where: { id: boardId },
      data: { objects: filtered as Prisma.InputJsonArray },
    });
  },

  /**
   * Remove a linked-board record so the board no longer appears
   * in the user's "Linked Boards" tab. Does NOT delete the actual board.
   */
  async unlinkBoard(boardId: string, userId: string) {
    await prisma.linkedBoard.deleteMany({
      where: { userId, boardId },
    });
    return { success: true };
  },

  /**
   * Save a JPEG thumbnail (base64) for a board card preview.
   * Any user who has been on the board can update the thumbnail.
   * Enforces a 5-minute cooldown to prevent churn from rapid join/leave.
   */
  async saveThumbnail(boardId: string, userId: string, thumbnail: string, version?: number) {
    const board = await prisma.board.findUnique({
      where: { id: boardId },
      select: { ownerId: true, thumbnailUpdatedAt: true },
    });

    if (!board) {
      throw new AppError(404, 'Board not found');
    }

    if (board.ownerId !== userId) {
      throw new AppError(403, 'Not authorized to update this thumbnail');
    }

    // Check 5-minute cooldown
    if (board.thumbnailUpdatedAt) {
      const elapsed = Date.now() - board.thumbnailUpdatedAt.getTime();
      if (elapsed < 5 * 60 * 1000) {
        return { success: false, reason: 'cooldown' };
      }
    }

    await prisma.board.update({
      where: { id: boardId },
      data: {
        thumbnail,
        thumbnailUpdatedAt: new Date(),
        ...(version != null ? { thumbnailVersion: version } : {}),
      },
    });
    return { success: true };
  },

  // ============================================================
  // Redis-Backed Board State (Phase 5: Persistence)
  // ============================================================
  //
  // WebSocket object mutations write to Redis instead of Postgres.
  // A background auto-save worker flushes Redis → Postgres every 60s.
  // Redis key: "board:{boardId}:state" → JSON CachedBoardState.

  /**
   * Load a board's state from Postgres into Redis.
   * Called on first board:join when no Redis cache exists.
   */
  async loadBoardToRedis(boardId: string): Promise<CachedBoardState> {
    const board = await prisma.board.findUnique({
      where: { id: boardId },
      select: { objects: true, version: true },
    });

    if (!board) {
      throw new AppError(404, 'Board not found');
    }

    const cachedState: CachedBoardState = {
      objects: parseBoardObjects(board.objects),
      postgresVersion: board.version,
      lastSyncedAt: Date.now(),
    };

    await redis.set(boardStateKey(boardId), JSON.stringify(cachedState));
    logger.debug(`Board ${boardId} loaded into Redis (v${board.version}, ${cachedState.objects.length} objects)`);
    return cachedState;
  },

  /**
   * Read the cached board state from Redis.
   * Returns null if no cache exists (board not yet loaded).
   */
  async getBoardStateFromRedis(boardId: string): Promise<CachedBoardState | null> {
    const rawJson = await redis.get(boardStateKey(boardId));
    if (!rawJson) return null;
    return JSON.parse(rawJson) as CachedBoardState;
  },

  /**
   * Write a CachedBoardState to Redis.
   */
  async saveBoardStateToRedis(boardId: string, state: CachedBoardState): Promise<void> {
    await redis.set(boardStateKey(boardId), JSON.stringify(state));
  },

  /**
   * Get the cached state, loading from Postgres if not yet cached.
   */
  async getOrLoadBoardState(boardId: string): Promise<CachedBoardState> {
    const existingState = await this.getBoardStateFromRedis(boardId);
    if (existingState) return existingState;
    return this.loadBoardToRedis(boardId);
  },

  /**
   * Add a new object to the board's Redis-cached state.
   * Does NOT write to Postgres — auto-save handles that.
   */
  async addObjectInRedis(boardId: string, object: Record<string, unknown>): Promise<void> {
    const key = boardStateKey(boardId);
    let result = await atomicAddObject(key, JSON.stringify(object), MAX_OBJECTS_PER_BOARD);

    if (result === -2) {
      // State not in Redis yet — load from Postgres and retry
      await this.loadBoardToRedis(boardId);
      result = await atomicAddObject(key, JSON.stringify(object), MAX_OBJECTS_PER_BOARD);
    }

    if (result === -1) {
      throw new AppError(409, 'Object with this ID already exists', 'DUPLICATE_OBJECT');
    }
    if (result === -3) {
      throw new AppError(403, `Object limit reached (max ${MAX_OBJECTS_PER_BOARD})`, 'OBJECT_LIMIT');
    }
  },

  /**
   * Update an object in the board's Redis-cached state (LWW merge).
   * Does NOT write to Postgres — auto-save handles that.
   */
  async updateObjectInRedis(
    boardId: string,
    objectId: string,
    updates: Record<string, unknown>
  ): Promise<void> {
    const key = boardStateKey(boardId);
    let result = await atomicUpdateObject(key, objectId, JSON.stringify(updates));

    if (result === -2) {
      await this.loadBoardToRedis(boardId);
      result = await atomicUpdateObject(key, objectId, JSON.stringify(updates));
    }

    if (result === -1) {
      throw new AppError(404, 'Object not found on board');
    }
  },

  /**
   * Remove an object from the board's Redis-cached state.
   * Does NOT write to Postgres — auto-save handles that.
   */
  async removeObjectFromRedis(boardId: string, objectId: string): Promise<void> {
    const key = boardStateKey(boardId);
    let result = await atomicRemoveObject(key, objectId);

    if (result === -2) {
      await this.loadBoardToRedis(boardId);
      result = await atomicRemoveObject(key, objectId);
    }

    if (result === -1) {
      throw new AppError(404, 'Object not found on board');
    }
  },

  /**
   * Flush the Redis-cached board state to Postgres with optimistic locking.
   *
   * Uses `WHERE version = expectedVersion` to detect concurrent writes.
   * On version mismatch: Postgres is authoritative — overwrites Redis with
   * the current Postgres state.
   *
   * Returns { success, newVersion } where success=false means a version
   * conflict was detected and Redis was overwritten with Postgres state.
   */
  async flushRedisToPostgres(boardId: string): Promise<{ success: boolean; newVersion: number }> {
    const cachedState = await this.getBoardStateFromRedis(boardId);
    if (!cachedState) {
      return { success: true, newVersion: 0 };
    }

    const expectedVersion = cachedState.postgresVersion;
    const objectsJson = JSON.stringify(cachedState.objects);

    // Optimistic locking write — only succeeds if version matches
    // Uses $executeRaw because Prisma's update() doesn't support conditional WHERE on version
    metricsService.incrementDbQuery('Board', 'updateRaw');
    const rowsAffected: number = await prisma.$executeRaw`
      UPDATE "Board"
      SET "objects" = ${objectsJson}::jsonb,
          "version" = "version" + 1,
          "updatedAt" = NOW()
      WHERE "id" = ${boardId}
        AND "version" = ${expectedVersion}
    `;

    if (rowsAffected === 0) {
      // Version mismatch — another process wrote to Postgres.
      // Postgres is authoritative: re-read and overwrite Redis.
      logger.warn(`Auto-save version conflict for board ${boardId} (expected v${expectedVersion}). Re-syncing from Postgres.`);

      const currentBoard = await prisma.board.findUnique({
        where: { id: boardId },
        select: { objects: true, version: true },
      });

      if (currentBoard) {
        const refreshedState: CachedBoardState = {
          objects: parseBoardObjects(currentBoard.objects),
          postgresVersion: currentBoard.version,
          lastSyncedAt: Date.now(),
        };
        await this.saveBoardStateToRedis(boardId, refreshedState);
        return { success: false, newVersion: currentBoard.version };
      }

      return { success: false, newVersion: expectedVersion };
    }

    // Success — update Redis with new version number
    const newVersion = expectedVersion + 1;
    cachedState.postgresVersion = newVersion;
    cachedState.lastSyncedAt = Date.now();
    await this.saveBoardStateToRedis(boardId, cachedState);

    logger.debug(`Board ${boardId} flushed to Postgres (v${newVersion})`);
    return { success: true, newVersion };
  },

  /**
   * Remove the board's cached state from Redis.
   * Called after the last user leaves and final flush completes.
   */
  async removeBoardFromRedis(boardId: string): Promise<void> {
    await redis.del(boardStateKey(boardId));
    logger.debug(`Board ${boardId} removed from Redis cache`);
  },
};
