import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { teleportFlagService } from '../../src/services/teleportFlagService';
import prisma from '../../src/models/index';
import { AppError } from '../../src/middleware/errorHandler';
import { makeBoard } from '../mocks/factories';

// The global setup.ts mock for prisma does not include teleportFlag.
// Add it here so all tests in this file can use it.
beforeAll(() => {
  const prismaMock = prisma as Record<string, unknown>;
  if (!prismaMock.teleportFlag) {
    prismaMock.teleportFlag = {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getTeleportFlagMock() {
  return (prisma as Record<string, unknown>).teleportFlag as Record<string, ReturnType<typeof vi.fn>>;
}

function makeFlag(overrides: Record<string, unknown> = {}) {
  return {
    id: 'flag-1',
    boardId: 'board-1',
    createdBy: 'user-1',
    label: 'My Flag',
    x: 100,
    y: 200,
    color: '#FF0000',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

// ─── listFlags ────────────────────────────────────────────────────────────────

describe('teleportFlagService.listFlags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws 404 when board does not exist', async () => {
    vi.mocked(prisma.board.findUnique).mockResolvedValue(null);

    await expect(teleportFlagService.listFlags('nonexistent')).rejects.toMatchObject({
      statusCode: 404,
      message: 'Board not found',
    });
  });

  it('throws 404 when board is soft-deleted', async () => {
    vi.mocked(prisma.board.findUnique).mockResolvedValue(
      makeBoard({ isDeleted: true }) as never
    );

    await expect(teleportFlagService.listFlags('board-1')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('returns flags array wrapped in an object', async () => {
    vi.mocked(prisma.board.findUnique).mockResolvedValue(
      makeBoard({ id: 'board-1', isDeleted: false }) as never
    );
    const flag = makeFlag();
    getTeleportFlagMock().findMany.mockResolvedValue([flag] as never);

    const result = await teleportFlagService.listFlags('board-1');

    expect(result).toHaveProperty('flags');
    expect(result.flags).toHaveLength(1);
    expect(result.flags[0].id).toBe('flag-1');
  });

  it('returns empty flags array when board has no flags', async () => {
    vi.mocked(prisma.board.findUnique).mockResolvedValue(
      makeBoard({ id: 'board-1', isDeleted: false }) as never
    );
    getTeleportFlagMock().findMany.mockResolvedValue([] as never);

    const result = await teleportFlagService.listFlags('board-1');

    expect(result.flags).toEqual([]);
  });

  it('queries flags for the correct boardId ordered by createdAt asc', async () => {
    vi.mocked(prisma.board.findUnique).mockResolvedValue(
      makeBoard({ id: 'board-1', isDeleted: false }) as never
    );
    getTeleportFlagMock().findMany.mockResolvedValue([] as never);

    await teleportFlagService.listFlags('board-1');

    expect(getTeleportFlagMock().findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { boardId: 'board-1' },
        orderBy: { createdAt: 'asc' },
      })
    );
  });

  it('selects only the expected fields (no extra internal fields)', async () => {
    vi.mocked(prisma.board.findUnique).mockResolvedValue(
      makeBoard({ id: 'board-1', isDeleted: false }) as never
    );
    getTeleportFlagMock().findMany.mockResolvedValue([] as never);

    await teleportFlagService.listFlags('board-1');

    const findManyCall = getTeleportFlagMock().findMany.mock.calls[0][0];
    expect(findManyCall.select).toMatchObject({
      id: true,
      boardId: true,
      label: true,
      x: true,
      y: true,
      color: true,
      createdBy: true,
      createdAt: true,
      updatedAt: true,
    });
  });
});

// ─── createFlag ───────────────────────────────────────────────────────────────

describe('teleportFlagService.createFlag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws 404 when board does not exist', async () => {
    vi.mocked(prisma.board.findUnique).mockResolvedValue(null);

    await expect(
      teleportFlagService.createFlag('nonexistent', 'user-1', { label: 'F', x: 0, y: 0, color: '#000' })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 404 when board is soft-deleted', async () => {
    vi.mocked(prisma.board.findUnique).mockResolvedValue(
      makeBoard({ isDeleted: true }) as never
    );

    await expect(
      teleportFlagService.createFlag('board-1', 'user-1', { label: 'F', x: 0, y: 0, color: '#000' })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('creates a flag with the correct data', async () => {
    vi.mocked(prisma.board.findUnique).mockResolvedValue(
      makeBoard({ id: 'board-1', isDeleted: false }) as never
    );
    const created = makeFlag({ boardId: 'board-1', createdBy: 'user-1', label: 'Point A', x: 50, y: 75, color: '#0000FF' });
    getTeleportFlagMock().create.mockResolvedValue(created as never);

    await teleportFlagService.createFlag('board-1', 'user-1', {
      label: 'Point A',
      x: 50,
      y: 75,
      color: '#0000FF',
    });

    expect(getTeleportFlagMock().create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        boardId: 'board-1',
        createdBy: 'user-1',
        label: 'Point A',
        x: 50,
        y: 75,
        color: '#0000FF',
      }),
    });
  });

  it('returns the created flag shape with expected fields', async () => {
    vi.mocked(prisma.board.findUnique).mockResolvedValue(
      makeBoard({ id: 'board-1', isDeleted: false }) as never
    );
    const created = makeFlag();
    getTeleportFlagMock().create.mockResolvedValue(created as never);

    const result = await teleportFlagService.createFlag('board-1', 'user-1', {
      label: 'My Flag',
      x: 100,
      y: 200,
      color: '#FF0000',
    });

    expect(result).toMatchObject({
      id: 'flag-1',
      boardId: 'board-1',
      createdBy: 'user-1',
      label: 'My Flag',
      x: 100,
      y: 200,
      color: '#FF0000',
    });
    expect(result).toHaveProperty('createdAt');
    expect(result).toHaveProperty('updatedAt');
  });
});

// ─── updateFlag ───────────────────────────────────────────────────────────────

describe('teleportFlagService.updateFlag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws 404 when flag does not exist', async () => {
    getTeleportFlagMock().findUnique.mockResolvedValue(null);

    await expect(
      teleportFlagService.updateFlag('board-1', 'nonexistent-flag', { label: 'Updated' })
    ).rejects.toMatchObject({ statusCode: 404, message: 'Flag not found' });
  });

  it('throws 404 when flag belongs to a different board', async () => {
    const flag = makeFlag({ boardId: 'board-OTHER' });
    getTeleportFlagMock().findUnique.mockResolvedValue(flag as never);

    await expect(
      teleportFlagService.updateFlag('board-1', 'flag-1', { label: 'New' })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('calls prisma.teleportFlag.update with correct data', async () => {
    const flag = makeFlag({ boardId: 'board-1' });
    getTeleportFlagMock().findUnique.mockResolvedValue(flag as never);
    const updated = makeFlag({ label: 'Updated Label', x: 300, y: 400 });
    getTeleportFlagMock().update.mockResolvedValue(updated as never);

    await teleportFlagService.updateFlag('board-1', 'flag-1', { label: 'Updated Label', x: 300, y: 400 });

    expect(getTeleportFlagMock().update).toHaveBeenCalledWith({
      where: { id: 'flag-1' },
      data: { label: 'Updated Label', x: 300, y: 400 },
    });
  });

  it('returns the updated flag shape with all expected fields', async () => {
    const flag = makeFlag({ boardId: 'board-1' });
    getTeleportFlagMock().findUnique.mockResolvedValue(flag as never);
    const updated = makeFlag({ label: 'New Label', color: '#00FF00' });
    getTeleportFlagMock().update.mockResolvedValue(updated as never);

    const result = await teleportFlagService.updateFlag('board-1', 'flag-1', { label: 'New Label', color: '#00FF00' });

    expect(result).toMatchObject({
      id: 'flag-1',
      boardId: 'board-1',
      label: 'New Label',
      color: '#00FF00',
    });
    expect(result).toHaveProperty('createdAt');
    expect(result).toHaveProperty('updatedAt');
  });

  it('allows partial updates (only updating label, leaving x/y/color unchanged)', async () => {
    const flag = makeFlag({ boardId: 'board-1' });
    getTeleportFlagMock().findUnique.mockResolvedValue(flag as never);
    const updated = makeFlag({ label: 'Only Label Changed' });
    getTeleportFlagMock().update.mockResolvedValue(updated as never);

    await teleportFlagService.updateFlag('board-1', 'flag-1', { label: 'Only Label Changed' });

    expect(getTeleportFlagMock().update).toHaveBeenCalledWith({
      where: { id: 'flag-1' },
      data: { label: 'Only Label Changed' },
    });
  });

  it('throws 404 as an AppError instance', async () => {
    getTeleportFlagMock().findUnique.mockResolvedValue(null);

    await expect(
      teleportFlagService.updateFlag('board-1', 'bad-flag', {})
    ).rejects.toBeInstanceOf(AppError);
  });
});

// ─── deleteFlag ───────────────────────────────────────────────────────────────

describe('teleportFlagService.deleteFlag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws 404 when flag does not exist', async () => {
    getTeleportFlagMock().findUnique.mockResolvedValue(null);

    await expect(
      teleportFlagService.deleteFlag('board-1', 'nonexistent-flag')
    ).rejects.toMatchObject({ statusCode: 404, message: 'Flag not found' });
  });

  it('throws 404 when flag belongs to a different board', async () => {
    const flag = makeFlag({ boardId: 'board-OTHER' });
    getTeleportFlagMock().findUnique.mockResolvedValue(flag as never);

    await expect(
      teleportFlagService.deleteFlag('board-1', 'flag-1')
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('calls prisma.teleportFlag.delete with correct flagId', async () => {
    const flag = makeFlag({ id: 'flag-1', boardId: 'board-1' });
    getTeleportFlagMock().findUnique.mockResolvedValue(flag as never);
    getTeleportFlagMock().delete.mockResolvedValue(flag as never);

    await teleportFlagService.deleteFlag('board-1', 'flag-1');

    expect(getTeleportFlagMock().delete).toHaveBeenCalledWith({
      where: { id: 'flag-1' },
    });
  });

  it('returns { success: true } on successful delete', async () => {
    const flag = makeFlag({ boardId: 'board-1' });
    getTeleportFlagMock().findUnique.mockResolvedValue(flag as never);
    getTeleportFlagMock().delete.mockResolvedValue(flag as never);

    const result = await teleportFlagService.deleteFlag('board-1', 'flag-1');

    expect(result).toEqual({ success: true });
  });

  it('throws 404 as an AppError instance', async () => {
    getTeleportFlagMock().findUnique.mockResolvedValue(null);

    await expect(
      teleportFlagService.deleteFlag('board-1', 'bad-flag')
    ).rejects.toBeInstanceOf(AppError);
  });
});
