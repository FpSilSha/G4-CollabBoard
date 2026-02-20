import prisma from '../models/index';
import { AppError } from '../middleware/errorHandler';

export const teleportFlagService = {
  async listFlags(boardId: string) {
    const board = await prisma.board.findUnique({ where: { id: boardId } });
    if (!board || board.isDeleted) throw new AppError(404, 'Board not found');

    const flags = await prisma.teleportFlag.findMany({
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
    const board = await prisma.board.findUnique({ where: { id: boardId } });
    if (!board || board.isDeleted) throw new AppError(404, 'Board not found');

    const flag = await prisma.teleportFlag.create({
      data: {
        boardId,
        createdBy: userId,
        label: data.label,
        x: data.x,
        y: data.y,
        color: data.color,
      },
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
    data: { label?: string; x?: number; y?: number; color?: string }
  ) {
    const flag = await prisma.teleportFlag.findUnique({ where: { id: flagId } });
    if (!flag || flag.boardId !== boardId) throw new AppError(404, 'Flag not found');

    const updated = await prisma.teleportFlag.update({
      where: { id: flagId },
      data,
    });

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

  async deleteFlag(boardId: string, flagId: string) {
    const flag = await prisma.teleportFlag.findUnique({ where: { id: flagId } });
    if (!flag || flag.boardId !== boardId) throw new AppError(404, 'Flag not found');

    await prisma.teleportFlag.delete({ where: { id: flagId } });
    return { success: true };
  },
};
