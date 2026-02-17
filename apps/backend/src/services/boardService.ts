import prisma from '../models/index';
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

    if (board.ownerId !== userId) {
      throw new AppError(403, 'You do not have access to this board');
    }

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
};
