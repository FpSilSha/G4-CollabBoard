import prisma from '../models/index';
import { logger } from '../utils/logger';

// ============================================================
// Audit Action Constants
// ============================================================

export const AuditAction = {
  // Auth
  AUTH_LOGIN: 'auth.login',
  AUTH_FAILURE: 'auth.failure',

  // Board
  BOARD_CREATE: 'board.create',
  BOARD_VIEW: 'board.view',
  BOARD_UPDATE: 'board.update',
  BOARD_DELETE: 'board.delete',
  BOARD_JOIN: 'board.join',
  BOARD_LEAVE: 'board.leave',

  // Object
  OBJECT_CREATE: 'object.create',
  OBJECT_UPDATE: 'object.update',
  OBJECT_DELETE: 'object.delete',

  // Rate Limit
  RATE_LIMIT_EXCEEDED: 'rate_limit.exceeded',

  // Subscription
  SUBSCRIPTION_CHANGE: 'subscription.change',

  // AI
  AI_EXECUTE: 'ai.execute',
} as const;

export type AuditActionType = (typeof AuditAction)[keyof typeof AuditAction];

// ============================================================
// Types
// ============================================================

interface AuditEntry {
  userId: string;
  action: AuditActionType;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

// ============================================================
// Audit Service
// ============================================================

export const auditService = {
  /**
   * Write an audit log entry. Fire-and-forget (non-blocking).
   * Failures are logged but never thrown to avoid impacting
   * the primary operation.
   */
  log(entry: AuditEntry): void {
    prisma.auditLog
      .create({
        data: {
          userId: entry.userId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          metadata: entry.metadata ? JSON.parse(JSON.stringify(entry.metadata)) : undefined,
          ipAddress: entry.ipAddress ?? null,
          userAgent: entry.userAgent ?? null,
        },
      })
      .catch((err: Error) => {
        logger.error(`Audit log write failed: ${err.message}`);
      });
  },

  /**
   * Purge audit logs older than 90 days.
   */
  async purgeExpired(): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);

    const result = await prisma.auditLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });

    logger.info(`Purged ${result.count} audit logs older than 90 days`);
    return result.count;
  },

  /**
   * Query recent AI errors from audit logs.
   * Returns failed AI executions with full metadata, ordered by most recent.
   */
  async getAIErrors(options?: {
    limit?: number;
    offset?: number;
  }): Promise<{
    errors: Array<{
      id: string;
      userId: string;
      boardId: string;
      command: string;
      errorCode: string;
      errorMessage: string;
      operationCount: number;
      turnsUsed: number;
      inputTokens: number;
      outputTokens: number;
      costCents: number;
      model: string;
      traceId: string | null;
      timestamp: string;
    }>;
    total: number;
  }> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    // Count total matching errors
    const total = await prisma.auditLog.count({
      where: {
        action: 'ai.execute',
        metadata: {
          path: ['success'],
          equals: false,
        },
      },
    });

    // Fetch error records
    const records = await prisma.auditLog.findMany({
      where: {
        action: 'ai.execute',
        metadata: {
          path: ['success'],
          equals: false,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    const errors = records.map((record) => {
      const meta = (record.metadata as Record<string, unknown>) ?? {};
      return {
        id: record.id,
        userId: record.userId,
        boardId: record.entityId,
        command: (meta.command as string) ?? '',
        errorCode: (meta.errorCode as string) ?? 'UNKNOWN',
        errorMessage: (meta.errorMessage as string) ?? '',
        operationCount: (meta.operationCount as number) ?? 0,
        turnsUsed: (meta.turnsUsed as number) ?? 0,
        inputTokens: (meta.inputTokens as number) ?? 0,
        outputTokens: (meta.outputTokens as number) ?? 0,
        costCents: (meta.costCents as number) ?? 0,
        model: (meta.model as string) ?? '',
        traceId: (meta.traceId as string) ?? null,
        timestamp: record.createdAt.toISOString(),
      };
    });

    return { errors, total };
  },

  /**
   * Purge all audit logs for a specific user (GDPR deletion).
   */
  async purgeForUser(userId: string): Promise<number> {
    const result = await prisma.auditLog.deleteMany({
      where: { userId },
    });

    logger.info(`Purged ${result.count} audit logs for user ${userId}`);
    return result.count;
  },
};

// ============================================================
// Helpers
// ============================================================

/**
 * Extract client IP from an Express request.
 * Handles X-Forwarded-For (Railway, Vercel proxy).
 */
export function getClientIp(req: { headers: Record<string, string | string[] | undefined>; socket: { remoteAddress?: string } }): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

/**
 * Extract client IP from a Socket.io handshake.
 */
export function getSocketIp(socket: { handshake: { address: string; headers: Record<string, string | string[] | undefined> } }): string {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return socket.handshake.address || 'unknown';
}
