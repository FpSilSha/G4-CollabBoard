import prisma from '../models/index';
import type { Board, BoardVersion, Prisma } from '@prisma/client';

// ============================================================
// Version Repository Interface
// ============================================================

export interface VersionRepository {
  countByBoard(boardId: string): Promise<number>;
  findOldest(boardId: string): Promise<BoardVersion | null>;
  deleteById(id: string): Promise<BoardVersion>;
  create(data: {
    boardId: string;
    createdBy: string;
    snapshot: Prisma.InputJsonArray;
  }): Promise<BoardVersion>;
  findMany(options: {
    where: Prisma.BoardVersionWhereInput;
    orderBy?: Prisma.BoardVersionOrderByWithRelationInput;
    select?: Prisma.BoardVersionSelect;
  }): Promise<BoardVersion[]>;
}

export interface VersionBoardLookup {
  findById(id: string): Promise<Pick<Board, 'id' | 'isDeleted'> | null>;
}

// ============================================================
// Prisma Implementation
// ============================================================

export const prismaVersionRepository: VersionRepository = {
  async countByBoard(boardId) {
    return prisma.boardVersion.count({ where: { boardId } });
  },

  async findOldest(boardId) {
    return prisma.boardVersion.findFirst({
      where: { boardId },
      orderBy: { createdAt: 'asc' },
    });
  },

  async deleteById(id) {
    return prisma.boardVersion.delete({ where: { id } });
  },

  async create(data) {
    return prisma.boardVersion.create({ data });
  },

  async findMany({ where, orderBy, select }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return prisma.boardVersion.findMany({ where, orderBy, select } as any);
  },
};

export const prismaVersionBoardLookup: VersionBoardLookup = {
  async findById(id) {
    return prisma.board.findUnique({
      where: { id },
      select: { id: true, isDeleted: true },
    });
  },
};
