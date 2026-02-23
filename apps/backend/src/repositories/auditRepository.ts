import prisma from '../models/index';
import type { AuditLog, Prisma } from '@prisma/client';

// ============================================================
// Audit Repository Interface
// ============================================================

export interface AuditRepository {
  create(data: {
    userId: string;
    action: string;
    entityType: string;
    entityId: string;
    metadata?: Prisma.InputJsonValue;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<AuditLog>;
  deleteMany(where: Prisma.AuditLogWhereInput): Promise<{ count: number }>;
  count(where: Prisma.AuditLogWhereInput): Promise<number>;
  findMany(options: {
    where: Prisma.AuditLogWhereInput;
    orderBy?: Prisma.AuditLogOrderByWithRelationInput;
    take?: number;
    skip?: number;
  }): Promise<AuditLog[]>;
}

// ============================================================
// Prisma Implementation
// ============================================================

export const prismaAuditRepository: AuditRepository = {
  async create(data) {
    return prisma.auditLog.create({ data });
  },

  async deleteMany(where) {
    return prisma.auditLog.deleteMany({ where });
  },

  async count(where) {
    return prisma.auditLog.count({ where });
  },

  async findMany({ where, orderBy, take, skip }) {
    return prisma.auditLog.findMany({ where, orderBy, take, skip });
  },
};
