import prisma from '../models/index';
import { Prisma } from '@prisma/client';
import { TIER_LIMITS, type SubscriptionTier } from 'shared';
import { AppError } from '../middleware/errorHandler';

export const boardService = {
  async listBoards(userId: string, includeDeleted = false) {
    const where: Record<string, unknown> = { ownerId: userId };
    if (!includeDeleted) {
      where.isDeleted = false;
    }

    const boards = await prisma.board.findMany({
      where,
      orderBy: { slot: 'asc' },
      select: {
        id: true,
        title: true,
        slot: true,
        lastAccessedAt: true,
        isDeleted: true,
        objects: true,
      },
    });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { subscriptionTier: true },
    });

    const tier = (user?.subscriptionTier?.toLowerCase() ?? 'free') as SubscriptionTier;
    const activeCount = boards.filter((b) => !b.isDeleted).length;

    return {
      boards: boards.map((b) => ({
        id: b.id,
        title: b.title,
        slot: b.slot,
        lastAccessedAt: b.lastAccessedAt,
        objectCount: Array.isArray(b.objects) ? (b.objects as unknown[]).length : 0,
        isDeleted: b.isDeleted,
      })),
      slots: {
        used: activeCount,
        total: TIER_LIMITS[tier].BOARD_SLOTS,
        tier,
      },
    };
  },

  async createBoard(userId: string, title: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { subscriptionTier: true },
    });

    if (!user) {
      throw new AppError(404, 'User not found');
    }

    const tier = user.subscriptionTier.toLowerCase() as SubscriptionTier;
    const maxSlots = TIER_LIMITS[tier].BOARD_SLOTS;

    const activeCount = await prisma.board.count({
      where: { ownerId: userId, isDeleted: false },
    });

    if (activeCount >= maxSlots) {
      throw new AppError(403, `Board limit reached. Your ${tier} plan allows ${maxSlots} boards.`, 'BOARD_LIMIT_REACHED');
    }

    // Find next available slot
    const existingSlots = await prisma.board.findMany({
      where: { ownerId: userId, isDeleted: false },
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

    return {
      id: board.id,
      title: board.title,
      slot: board.slot,
      objects: board.objects as unknown[],
      version: board.version,
      lastAccessedAt: board.lastAccessedAt,
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
};
