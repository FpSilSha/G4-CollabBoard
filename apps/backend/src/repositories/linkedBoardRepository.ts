import prisma from '../models/index';

// ============================================================
// Linked Board Repository Interface
// ============================================================

export interface LinkedBoardRepository {
  findByUser(userId: string, includeBoard?: {
    select: Record<string, boolean>;
  }): Promise<Array<{
    board: Record<string, unknown>;
  }>>;
  upsert(userId: string, boardId: string): Promise<void>;
  deleteMany(where: { userId: string; boardId: string }): Promise<{ count: number }>;
}

// ============================================================
// Prisma Implementation
// ============================================================

export const prismaLinkedBoardRepository: LinkedBoardRepository = {
  async findByUser(userId, includeBoard) {
    const records = await prisma.linkedBoard.findMany({
      where: { userId },
      include: includeBoard ? { board: { select: includeBoard.select } } : undefined,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return records as any;
  },

  async upsert(userId, boardId) {
    await prisma.linkedBoard.upsert({
      where: { userId_boardId: { userId, boardId } },
      create: { userId, boardId },
      update: {},
    });
  },

  async deleteMany(where) {
    return prisma.linkedBoard.deleteMany({ where });
  },
};
