import { AppError } from '../middleware/errorHandler';
import { prismaTeleportFlagRepository, prismaBoardLookup } from '../repositories/teleportFlagRepository';
import type { TeleportFlagRepository, BoardLookup } from '../repositories/teleportFlagRepository';

export function createTeleportFlagService(
  flagRepo: TeleportFlagRepository = prismaTeleportFlagRepository,
  boardLookup: BoardLookup = prismaBoardLookup,
) {
  return {
    async listFlags(boardId: string) {
      const board = await boardLookup.findById(boardId);
      if (!board || board.isDeleted) throw new AppError(404, 'Board not found');

      const flags = await flagRepo.findMany({
        where: { boardId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          boardId: true,
          label: true,
          x: true,
          y: true,
          color: true,
          createdBy: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return { flags };
    },

    async createFlag(
      boardId: string,
      userId: string,
      data: { label: string; x: number; y: number; color: string }
    ) {
      const board = await boardLookup.findById(boardId);
      if (!board || board.isDeleted) throw new AppError(404, 'Board not found');

      const flag = await flagRepo.create({
        boardId,
        createdBy: userId,
        label: data.label,
        x: data.x,
        y: data.y,
        color: data.color,
      });

      return {
        id: flag.id,
        boardId: flag.boardId,
        createdBy: flag.createdBy,
        label: flag.label,
        x: flag.x,
        y: flag.y,
        color: flag.color,
        createdAt: flag.createdAt,
        updatedAt: flag.updatedAt,
      };
    },

    async updateFlag(
      boardId: string,
      flagId: string,
      userId: string,
      data: { label?: string; x?: number; y?: number; color?: string }
    ) {
      const flag = await flagRepo.findById(flagId);
      if (!flag || flag.boardId !== boardId) throw new AppError(404, 'Flag not found');

      if (flag.createdBy !== userId) {
        const board = await boardLookup.findById(boardId);
        if (!board || board.ownerId !== userId) {
          throw new AppError(403, 'Only the flag creator or board owner can update this flag');
        }
      }

      const updated = await flagRepo.update(flagId, data);

      return {
        id: updated.id,
        boardId: updated.boardId,
        createdBy: updated.createdBy,
        label: updated.label,
        x: updated.x,
        y: updated.y,
        color: updated.color,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      };
    },

    async deleteFlag(boardId: string, flagId: string, userId: string) {
      const flag = await flagRepo.findById(flagId);
      if (!flag || flag.boardId !== boardId) throw new AppError(404, 'Flag not found');

      if (flag.createdBy !== userId) {
        const board = await boardLookup.findById(boardId);
        if (!board || board.ownerId !== userId) {
          throw new AppError(403, 'Only the flag creator or board owner can delete this flag');
        }
      }

      await flagRepo.delete(flagId);
      return { success: true };
    },
  };
}

/** Default singleton for production use — consumers import this. */
export const teleportFlagService = createTeleportFlagService();
