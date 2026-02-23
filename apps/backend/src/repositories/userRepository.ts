import prisma from '../models/index';
import type { User } from '@prisma/client';

// ============================================================
// User Repository Interface
// ============================================================

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(data: {
    id: string;
    email: string;
    name: string;
    avatar: string;
    color: string;
    subscriptionTier: 'FREE' | 'TEAM' | 'ENTERPRISE';
  }): Promise<User>;
  update(id: string, data: Partial<Pick<User, 'email' | 'name' | 'avatar' | 'color'>>): Promise<User>;
}

// ============================================================
// Prisma Implementation
// ============================================================

export const prismaUserRepository: UserRepository = {
  async findById(id) {
    return prisma.user.findUnique({ where: { id } });
  },

  async findByEmail(email) {
    return prisma.user.findUnique({ where: { email } });
  },

  async create(data) {
    return prisma.user.create({ data });
  },

  async update(id, data) {
    return prisma.user.update({ where: { id }, data });
  },
};
