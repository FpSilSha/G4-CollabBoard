import prisma from '../models/index';
import { Prisma } from '@prisma/client';
import { PERSISTENCE_CONFIG } from 'shared';
import { AppError } from '../middleware/errorHandler';

export const versionService = {
  async listVersions(boardId: string, userId: string) {
    const board = await prisma.board.findUnique({
      where: { id: boardId },
    });

    if (!board) {
      throw new AppError(404, 'Board not found');
    }

    if (board.isDeleted) {
      throw new AppError(404, 'Board has been deleted');
    }

    // Version history is accessible to any authenticated user with board access.

    const versions = await prisma.boardVersion.findMany({
      where: { boardId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        label: true,
        snapshot: true,
      },
    });

    return {
      versions: versions.map((v, index) => ({
        id: v.id,
        versionNumber: versions.length - index,
        createdAt: v.createdAt,
        objectCount: Array.isArray(v.snapshot) ? (v.snapshot as Prisma.JsonArray).length : 0,
      })),
    };
  },

  async createVersionSnapshot(boardId: string, userId: string, objects: unknown[]) {
    // Enforce max versions per board
    const count = await prisma.boardVersion.count({ where: { boardId } });

    if (count >= PERSISTENCE_CONFIG.MAX_VERSIONS_PER_BOARD) {
      // Delete oldest version (FIFO)
      const oldest = await prisma.boardVersion.findFirst({
        where: { boardId },
        orderBy: { createdAt: 'asc' },
      });

      if (oldest) {
        await prisma.boardVersion.delete({ where: { id: oldest.id } });
      }
    }

    return prisma.boardVersion.create({
      data: {
        boardId,
        createdBy: userId,
        snapshot: objects as Prisma.InputJsonArray,
      },
    });
  },
};
