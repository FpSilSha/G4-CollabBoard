import prisma from '../models/index';
import type { Board, Prisma } from '@prisma/client';
import { metricsService } from '../services/metricsService';

// ============================================================
// Board Repository Interface
// ============================================================

/** Select fields used by listBoards for owned boards. */
export type BoardListSelect = {
  id: true;
  ownerId: true;
  title: true;
  slot: true;
  lastAccessedAt: true;
  isDeleted: true;
  objects: true;
  thumbnail: true;
  version: true;
  thumbnailVersion: true;
  thumbnailUpdatedAt: true;
};

export interface BoardRepository {
  findById(id: string): Promise<Board | null>;
  findByIdSelect<S extends Prisma.BoardSelect>(id: string, select: S): Promise<Partial<Board> | null>;
  findMany(options: {
    where: Prisma.BoardWhereInput;
    orderBy?: Prisma.BoardOrderByWithRelationInput;
    select?: Prisma.BoardSelect;
  }): Promise<Partial<Board>[]>;
  count(where: Prisma.BoardWhereInput): Promise<number>;
  create(data: {
    ownerId: string;
    title: string;
    slot: number;
    objects: Prisma.InputJsonValue;
  }): Promise<Board>;
  update(id: string, data: Prisma.BoardUpdateInput): Promise<Board>;
  /**
   * Optimistic-locking update: only succeeds when board.version matches expectedVersion.
   * Returns the number of rows affected (0 = version conflict, 1 = success).
   */
  updateWithVersion(
    boardId: string,
    objectsJson: string,
    expectedVersion: number
  ): Promise<number>;
}

// ============================================================
// Prisma Implementation
// ============================================================

export const prismaBoardRepository: BoardRepository = {
  async findById(id) {
    return prisma.board.findUnique({ where: { id } });
  },

  async findByIdSelect(id, select) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return prisma.board.findUnique({ where: { id }, select }) as any;
  },

  async findMany({ where, orderBy, select }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return prisma.board.findMany({ where, orderBy, select }) as any;
  },

  async count(where) {
    return prisma.board.count({ where });
  },

  async create(data) {
    return prisma.board.create({ data });
  },

  async update(id, data) {
    return prisma.board.update({ where: { id }, data });
  },

  async updateWithVersion(boardId, objectsJson, expectedVersion) {
    metricsService.incrementDbQuery('Board', 'updateRaw');
    return prisma.$executeRaw`
      UPDATE "Board"
      SET "objects" = ${objectsJson}::jsonb,
          "version" = "version" + 1,
          "updatedAt" = NOW()
      WHERE "id" = ${boardId}
        AND "version" = ${expectedVersion}
    `;
  },
};
