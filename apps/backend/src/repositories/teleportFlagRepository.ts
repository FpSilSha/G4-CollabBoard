import prisma from '../models/index';
import type { TeleportFlag, Prisma } from '@prisma/client';

// ============================================================
// Teleport Flag Repository Interface
// ============================================================

export interface TeleportFlagRepository {
  findById(id: string): Promise<TeleportFlag | null>;
  findMany(options: {
    where: Prisma.TeleportFlagWhereInput;
    orderBy?: Prisma.TeleportFlagOrderByWithRelationInput;
    select?: Prisma.TeleportFlagSelect;
  }): Promise<TeleportFlag[]>;
  create(data: {
    boardId: string;
    createdBy: string;
    label: string;
    x: number;
    y: number;
    color: string;
  }): Promise<TeleportFlag>;
  update(id: string, data: Partial<Pick<TeleportFlag, 'label' | 'x' | 'y' | 'color'>>): Promise<TeleportFlag>;
  delete(id: string): Promise<TeleportFlag>;
}

// ============================================================
// Board Lookup (for authorization checks)
// ============================================================

export interface BoardLookup {
  findById(id: string): Promise<{ id: string; ownerId: string; isDeleted: boolean } | null>;
}

export const prismaBoardLookup: BoardLookup = {
  async findById(id) {
    return prisma.board.findUnique({
      where: { id },
      select: { id: true, ownerId: true, isDeleted: true },
    });
  },
};

// ============================================================
// Prisma Implementation
// ============================================================

export const prismaTeleportFlagRepository: TeleportFlagRepository = {
  async findById(id) {
    return prisma.teleportFlag.findUnique({ where: { id } });
  },

  async findMany({ where, orderBy, select }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return prisma.teleportFlag.findMany({ where, orderBy, select } as any);
  },

  async create(data) {
    return prisma.teleportFlag.create({ data });
  },

  async update(id, data) {
    return prisma.teleportFlag.update({ where: { id }, data });
  },

  async delete(id) {
    return prisma.teleportFlag.delete({ where: { id } });
  },
};
