import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { auditService, AuditAction, getClientIp, getSocketIp } from '../../src/services/auditService';
import prisma from '../../src/models/index';

// The global setup.ts mock for auditLog only includes create and createMany.
// We add the remaining methods used by auditService here.
beforeAll(() => {
  const auditLogMock = prisma.auditLog as Record<string, unknown>;
  if (!auditLogMock.deleteMany) {
    auditLogMock.deleteMany = vi.fn();
  }
  if (!auditLogMock.findMany) {
    auditLogMock.findMany = vi.fn();
  }
  if (!auditLogMock.count) {
    auditLogMock.count = vi.fn();
  }
});

describe('auditService.log', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls prisma.auditLog.create with the correct fields', async () => {
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    auditService.log({
      userId: 'user-1',
      action: AuditAction.BOARD_CREATE,
      entityType: 'board',
      entityId: 'board-123',
      metadata: { title: 'My Board' },
      ipAddress: '127.0.0.1',
      userAgent: 'Mozilla/5.0',
    });

    // Allow the fire-and-forget promise to resolve
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        action: 'board.create',
        entityType: 'board',
        entityId: 'board-123',
        metadata: { title: 'My Board' },
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0',
      },
    });
  });

  it('passes null for ipAddress and userAgent when not provided', async () => {
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    auditService.log({
      userId: 'user-1',
      action: AuditAction.AUTH_LOGIN,
      entityType: 'user',
      entityId: 'user-1',
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ipAddress: null,
        userAgent: null,
      }),
    });
  });

  it('passes undefined metadata when metadata is not provided', async () => {
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    auditService.log({
      userId: 'user-2',
      action: AuditAction.OBJECT_CREATE,
      entityType: 'object',
      entityId: 'obj-456',
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const call = vi.mocked(prisma.auditLog.create).mock.calls[0][0];
    expect(call.data.metadata).toBeUndefined();
  });

  it('does not throw when prisma.auditLog.create rejects (fire-and-forget)', async () => {
    vi.mocked(prisma.auditLog.create).mockRejectedValue(new Error('DB connection failed'));

    // Should NOT throw synchronously or asynchronously to the caller
    expect(() => {
      auditService.log({
        userId: 'user-1',
        action: AuditAction.BOARD_VIEW,
        entityType: 'board',
        entityId: 'board-xyz',
      });
    }).not.toThrow();

    // Give the rejection handler time to run — still should not propagate
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it('is synchronous (does not return a promise)', () => {
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = auditService.log({
      userId: 'user-1',
      action: AuditAction.AI_EXECUTE,
      entityType: 'board',
      entityId: 'board-1',
    });

    // log() returns void (not a promise)
    expect(result).toBeUndefined();
  });
});

// Typed helpers for the patched auditLog mock methods
// (not in the global setup.ts shape, so we cast through unknown)
function auditLogDeleteMany() {
  return (prisma.auditLog as unknown as { deleteMany: ReturnType<typeof vi.fn> }).deleteMany;
}
function auditLogFindMany() {
  return (prisma.auditLog as unknown as { findMany: ReturnType<typeof vi.fn> }).findMany;
}
function auditLogCount() {
  return (prisma.auditLog as unknown as { count: ReturnType<typeof vi.fn> }).count;
}

describe('auditService.purgeExpired', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls prisma.auditLog.deleteMany with a date 90 days in the past', async () => {
    auditLogDeleteMany().mockResolvedValue({ count: 5 });

    const before = new Date();
    before.setDate(before.getDate() - 90);

    await auditService.purgeExpired();

    expect(auditLogDeleteMany()).toHaveBeenCalledTimes(1);
    const [call] = auditLogDeleteMany().mock.calls;
    const cutoff: Date = call[0]!.where!.createdAt!.lt as Date;

    // The cutoff should be approximately 90 days ago (within 1 second)
    expect(Math.abs(cutoff.getTime() - before.getTime())).toBeLessThan(1000);
  });

  it('returns the count of deleted records', async () => {
    auditLogDeleteMany().mockResolvedValue({ count: 12 });

    const count = await auditService.purgeExpired();

    expect(count).toBe(12);
  });

  it('returns 0 when no records were deleted', async () => {
    auditLogDeleteMany().mockResolvedValue({ count: 0 });

    const count = await auditService.purgeExpired();

    expect(count).toBe(0);
  });
});

describe('auditService.getAIErrors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockAuditRecord = {
    id: 'audit-1',
    userId: 'user-1',
    entityId: 'board-abc',
    action: 'ai.execute',
    entityType: 'board',
    createdAt: new Date('2025-01-15T10:00:00Z'),
    metadata: {
      success: false,
      command: 'create 3 sticky notes',
      errorCode: 'BUDGET_EXCEEDED',
      errorMessage: 'Monthly budget exceeded',
      operationCount: 0,
      turnsUsed: 1,
      inputTokens: 500,
      outputTokens: 100,
      costCents: 3,
      model: 'claude-haiku-4-5',
      traceId: 'trace-xyz',
    },
  };

  it('calls prisma.auditLog.count and findMany with correct filters', async () => {
    vi.mocked(prisma.auditLog.count).mockResolvedValue(1 as never);
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([mockAuditRecord] as never);

    await auditService.getAIErrors();

    expect(prisma.auditLog.count).toHaveBeenCalledWith({
      where: {
        action: 'ai.execute',
        metadata: { path: ['success'], equals: false },
      },
    });
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          action: 'ai.execute',
          metadata: { path: ['success'], equals: false },
        },
        orderBy: { createdAt: 'desc' },
      })
    );
  });

  it('returns correctly shaped error entries from audit records', async () => {
    vi.mocked(prisma.auditLog.count).mockResolvedValue(1 as never);
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([mockAuditRecord] as never);

    const result = await auditService.getAIErrors();

    expect(result.total).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toEqual({
      id: 'audit-1',
      userId: 'user-1',
      boardId: 'board-abc',
      command: 'create 3 sticky notes',
      errorCode: 'BUDGET_EXCEEDED',
      errorMessage: 'Monthly budget exceeded',
      operationCount: 0,
      turnsUsed: 1,
      inputTokens: 500,
      outputTokens: 100,
      costCents: 3,
      model: 'claude-haiku-4-5',
      traceId: 'trace-xyz',
      timestamp: '2025-01-15T10:00:00.000Z',
    });
  });

  it('uses default limit=50 and offset=0 when options not provided', async () => {
    vi.mocked(prisma.auditLog.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([] as never);

    await auditService.getAIErrors();

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50, skip: 0 })
    );
  });

  it('respects custom limit and offset options', async () => {
    vi.mocked(prisma.auditLog.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([] as never);

    await auditService.getAIErrors({ limit: 10, offset: 20 });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10, skip: 20 })
    );
  });

  it('returns empty errors array and total=0 when no records found', async () => {
    vi.mocked(prisma.auditLog.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([] as never);

    const result = await auditService.getAIErrors();

    expect(result.total).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it('uses fallback values when metadata fields are missing', async () => {
    const minimalRecord = {
      id: 'audit-2',
      userId: 'user-2',
      entityId: 'board-xyz',
      action: 'ai.execute',
      entityType: 'board',
      createdAt: new Date('2025-02-01T00:00:00Z'),
      metadata: { success: false }, // missing all other fields
    };
    vi.mocked(prisma.auditLog.count).mockResolvedValue(1 as never);
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([minimalRecord] as never);

    const result = await auditService.getAIErrors();

    expect(result.errors[0].command).toBe('');
    expect(result.errors[0].errorCode).toBe('UNKNOWN');
    expect(result.errors[0].errorMessage).toBe('');
    expect(result.errors[0].operationCount).toBe(0);
    expect(result.errors[0].turnsUsed).toBe(0);
    expect(result.errors[0].traceId).toBeNull();
  });
});

describe('auditService.purgeForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls deleteMany with the correct userId filter', async () => {
    vi.mocked(prisma.auditLog.deleteMany).mockResolvedValue({ count: 3 } as never);

    await auditService.purgeForUser('user-99');

    expect(prisma.auditLog.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-99' },
    });
  });

  it('returns the count of deleted records', async () => {
    vi.mocked(prisma.auditLog.deleteMany).mockResolvedValue({ count: 7 } as never);

    const count = await auditService.purgeForUser('user-99');

    expect(count).toBe(7);
  });
});

describe('getClientIp', () => {
  it('extracts IP from X-Forwarded-For header (first in list)', () => {
    const req = {
      headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2, 10.0.0.3' },
      socket: { remoteAddress: '127.0.0.1' },
    };
    expect(getClientIp(req)).toBe('10.0.0.1');
  });

  it('returns remoteAddress when X-Forwarded-For is not set', () => {
    const req = {
      headers: {},
      socket: { remoteAddress: '192.168.1.100' },
    };
    expect(getClientIp(req)).toBe('192.168.1.100');
  });

  it('returns "unknown" when neither header nor remoteAddress is available', () => {
    const req = {
      headers: {},
      socket: { remoteAddress: undefined },
    };
    expect(getClientIp(req)).toBe('unknown');
  });

  it('handles X-Forwarded-For with a single IP (no commas)', () => {
    const req = {
      headers: { 'x-forwarded-for': '203.0.113.5' },
      socket: { remoteAddress: '127.0.0.1' },
    };
    expect(getClientIp(req)).toBe('203.0.113.5');
  });
});

describe('getSocketIp', () => {
  it('extracts IP from handshake X-Forwarded-For header', () => {
    const socket = {
      handshake: {
        address: '127.0.0.1',
        headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.1' },
      },
    };
    expect(getSocketIp(socket)).toBe('203.0.113.10');
  });

  it('falls back to handshake.address when header is missing', () => {
    const socket = {
      handshake: {
        address: '172.16.0.5',
        headers: {},
      },
    };
    expect(getSocketIp(socket)).toBe('172.16.0.5');
  });

  it('returns "unknown" when address is empty string', () => {
    const socket = {
      handshake: {
        address: '',
        headers: {},
      },
    };
    expect(getSocketIp(socket)).toBe('unknown');
  });
});
