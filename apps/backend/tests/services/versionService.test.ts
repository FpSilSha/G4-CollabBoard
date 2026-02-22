import { describe, it, expect, beforeEach, vi } from 'vitest';
import { versionService } from '../../src/services/versionService';
import prisma from '../../src/models/index';
import { PERSISTENCE_CONFIG } from 'shared';
import { AppError } from '../../src/middleware/errorHandler';
import { makeBoard } from '../mocks/factories';

describe('versionService.listVersions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws 404 AppError when board does not exist', async () => {
    vi.mocked(prisma.board.findUnique).mockResolvedValue(null);

    await expect(
      versionService.listVersions('nonexistent-board', 'user-1')
    ).rejects.toThrow(AppError);

    await expect(
      versionService.listVersions('nonexistent-board', 'user-1')
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 403 AppError when requesting user is not the board owner', async () => {
    const board = makeBoard({ ownerId: 'owner-user', id: 'board-1' });
    vi.mocked(prisma.board.findUnique).mockResolvedValue(board as never);

    await expect(
      versionService.listVersions('board-1', 'different-user')
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('returns empty versions array when no snapshots exist', async () => {
    const board = makeBoard({ ownerId: 'user-1', id: 'board-1' });
    vi.mocked(prisma.board.findUnique).mockResolvedValue(board as never);
    vi.mocked(prisma.boardVersion.findMany).mockResolvedValue([]);

    const result = await versionService.listVersions('board-1', 'user-1');

    expect(result.versions).toEqual([]);
  });

  it('returns versions with correct shape including versionNumber', async () => {
    const board = makeBoard({ ownerId: 'user-1', id: 'board-1' });
    vi.mocked(prisma.board.findUnique).mockResolvedValue(board as never);

    const mockVersions = [
      {
        id: 'v-3',
        createdAt: new Date('2025-01-03'),
        label: null,
        snapshot: [{ id: 'obj-1' }, { id: 'obj-2' }],
      },
      {
        id: 'v-2',
        createdAt: new Date('2025-01-02'),
        label: 'checkpoint',
        snapshot: [{ id: 'obj-1' }],
      },
      {
        id: 'v-1',
        createdAt: new Date('2025-01-01'),
        label: null,
        snapshot: [],
      },
    ];
    vi.mocked(prisma.boardVersion.findMany).mockResolvedValue(mockVersions as never);

    const result = await versionService.listVersions('board-1', 'user-1');

    expect(result.versions).toHaveLength(3);
    // versionNumber is versions.length - index (descending, so most recent = highest)
    expect(result.versions[0].versionNumber).toBe(3);
    expect(result.versions[1].versionNumber).toBe(2);
    expect(result.versions[2].versionNumber).toBe(1);
  });

  it('counts objectCount from the snapshot array', async () => {
    const board = makeBoard({ ownerId: 'user-1', id: 'board-1' });
    vi.mocked(prisma.board.findUnique).mockResolvedValue(board as never);

    const mockVersions = [
      {
        id: 'v-1',
        createdAt: new Date('2025-01-01'),
        label: null,
        snapshot: [{ id: 'obj-1' }, { id: 'obj-2' }, { id: 'obj-3' }],
      },
    ];
    vi.mocked(prisma.boardVersion.findMany).mockResolvedValue(mockVersions as never);

    const result = await versionService.listVersions('board-1', 'user-1');

    expect(result.versions[0].objectCount).toBe(3);
  });

  it('returns 0 objectCount when snapshot is not an array', async () => {
    const board = makeBoard({ ownerId: 'user-1', id: 'board-1' });
    vi.mocked(prisma.board.findUnique).mockResolvedValue(board as never);

    const mockVersions = [
      {
        id: 'v-1',
        createdAt: new Date('2025-01-01'),
        label: null,
        snapshot: null, // non-array snapshot
      },
    ];
    vi.mocked(prisma.boardVersion.findMany).mockResolvedValue(mockVersions as never);

    const result = await versionService.listVersions('board-1', 'user-1');

    expect(result.versions[0].objectCount).toBe(0);
  });

  it('queries boardVersions ordered by createdAt desc', async () => {
    const board = makeBoard({ ownerId: 'user-1', id: 'board-1' });
    vi.mocked(prisma.board.findUnique).mockResolvedValue(board as never);
    vi.mocked(prisma.boardVersion.findMany).mockResolvedValue([]);

    await versionService.listVersions('board-1', 'user-1');

    expect(prisma.boardVersion.findMany).toHaveBeenCalledWith({
      where: { boardId: 'board-1' },
      orderBy: { createdAt: 'desc' },
      select: expect.objectContaining({
        id: true,
        createdAt: true,
        label: true,
        snapshot: true,
      }),
    });
  });
});

describe('versionService.createVersionSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls prisma.boardVersion.create with the correct data', async () => {
    // Under the version cap — no pruning needed
    vi.mocked(prisma.boardVersion.count).mockResolvedValue(
      PERSISTENCE_CONFIG.MAX_VERSIONS_PER_BOARD - 1 as never
    );
    vi.mocked(prisma.boardVersion.create).mockResolvedValue({
      id: 'new-version',
      boardId: 'board-1',
      createdBy: 'user-1',
      snapshot: [],
    } as never);

    const objects = [{ id: 'obj-1', type: 'sticky' }];
    await versionService.createVersionSnapshot('board-1', 'user-1', objects);

    expect(prisma.boardVersion.create).toHaveBeenCalledWith({
      data: {
        boardId: 'board-1',
        createdBy: 'user-1',
        snapshot: objects,
      },
    });
  });

  it('prunes the oldest version when at MAX_VERSIONS_PER_BOARD limit', async () => {
    const maxCount = PERSISTENCE_CONFIG.MAX_VERSIONS_PER_BOARD;
    vi.mocked(prisma.boardVersion.count).mockResolvedValue(maxCount as never);

    const oldestVersion = { id: 'oldest-version-id', boardId: 'board-1', createdAt: new Date() };
    vi.mocked(prisma.boardVersion.findFirst).mockResolvedValue(oldestVersion as never);
    vi.mocked(prisma.boardVersion.delete).mockResolvedValue(oldestVersion as never);
    vi.mocked(prisma.boardVersion.create).mockResolvedValue({} as never);

    await versionService.createVersionSnapshot('board-1', 'user-1', []);

    expect(prisma.boardVersion.findFirst).toHaveBeenCalledWith({
      where: { boardId: 'board-1' },
      orderBy: { createdAt: 'asc' },
    });
    expect(prisma.boardVersion.delete).toHaveBeenCalledWith({
      where: { id: 'oldest-version-id' },
    });
  });

  it('does not prune when under MAX_VERSIONS_PER_BOARD limit', async () => {
    const belowMax = PERSISTENCE_CONFIG.MAX_VERSIONS_PER_BOARD - 5;
    vi.mocked(prisma.boardVersion.count).mockResolvedValue(belowMax as never);
    vi.mocked(prisma.boardVersion.create).mockResolvedValue({} as never);

    await versionService.createVersionSnapshot('board-1', 'user-1', []);

    expect(prisma.boardVersion.delete).not.toHaveBeenCalled();
    expect(prisma.boardVersion.findFirst).not.toHaveBeenCalled();
  });

  it('does not prune if count equals MAX - 1 (boundary condition)', async () => {
    vi.mocked(prisma.boardVersion.count).mockResolvedValue(
      (PERSISTENCE_CONFIG.MAX_VERSIONS_PER_BOARD - 1) as never
    );
    vi.mocked(prisma.boardVersion.create).mockResolvedValue({} as never);

    await versionService.createVersionSnapshot('board-1', 'user-1', []);

    expect(prisma.boardVersion.delete).not.toHaveBeenCalled();
  });

  it('does prune when count equals MAX (boundary: at limit)', async () => {
    vi.mocked(prisma.boardVersion.count).mockResolvedValue(
      PERSISTENCE_CONFIG.MAX_VERSIONS_PER_BOARD as never
    );
    vi.mocked(prisma.boardVersion.findFirst).mockResolvedValue(
      { id: 'old-v', boardId: 'board-1', createdAt: new Date() } as never
    );
    vi.mocked(prisma.boardVersion.delete).mockResolvedValue({} as never);
    vi.mocked(prisma.boardVersion.create).mockResolvedValue({} as never);

    await versionService.createVersionSnapshot('board-1', 'user-1', []);

    expect(prisma.boardVersion.delete).toHaveBeenCalledTimes(1);
  });

  it('still creates the snapshot even when findFirst returns null for pruning', async () => {
    vi.mocked(prisma.boardVersion.count).mockResolvedValue(
      PERSISTENCE_CONFIG.MAX_VERSIONS_PER_BOARD as never
    );
    vi.mocked(prisma.boardVersion.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.boardVersion.create).mockResolvedValue({} as never);

    // Should not throw even if oldest not found
    await versionService.createVersionSnapshot('board-1', 'user-1', []);

    expect(prisma.boardVersion.create).toHaveBeenCalledTimes(1);
    // delete should NOT be called since oldest was null
    expect(prisma.boardVersion.delete).not.toHaveBeenCalled();
  });

  it('returns the created boardVersion record', async () => {
    vi.mocked(prisma.boardVersion.count).mockResolvedValue(0 as never);
    const createdVersion = {
      id: 'ver-new',
      boardId: 'board-1',
      createdBy: 'user-1',
      snapshot: [{ id: 'obj-1' }],
    };
    vi.mocked(prisma.boardVersion.create).mockResolvedValue(createdVersion as never);

    const result = await versionService.createVersionSnapshot('board-1', 'user-1', [{ id: 'obj-1' }]);

    expect(result).toEqual(createdVersion);
  });
});
