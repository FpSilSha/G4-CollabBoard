import { Prisma } from '@prisma/client';
import { PERSISTENCE_CONFIG } from 'shared';
import { AppError } from '../middleware/errorHandler';
import { prismaVersionRepository, prismaVersionBoardLookup } from '../repositories/versionRepository';
import type { VersionRepository, VersionBoardLookup } from '../repositories/versionRepository';

export function createVersionService(
  versionRepo: VersionRepository = prismaVersionRepository,
  boardLookup: VersionBoardLookup = prismaVersionBoardLookup,
) {
  return {
    async listVersions(boardId: string, _userId: string) {
      const board = await boardLookup.findById(boardId);

      if (!board) {
        throw new AppError(404, 'Board not found');
      }

      if (board.isDeleted) {
        throw new AppError(404, 'Board has been deleted');
      }

      // Version history is accessible to any authenticated user with board access.

      const versions = await versionRepo.findMany({
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
      const count = await versionRepo.countByBoard(boardId);

      if (count >= PERSISTENCE_CONFIG.MAX_VERSIONS_PER_BOARD) {
        // Delete oldest version (FIFO)
        const oldest = await versionRepo.findOldest(boardId);

        if (oldest) {
          await versionRepo.deleteById(oldest.id);
        }
      }

      return versionRepo.create({
        boardId,
        createdBy: userId,
        snapshot: objects as Prisma.InputJsonArray,
      });
    },
  };
}

/** Default singleton for production use — consumers import this. */
export const versionService = createVersionService();
