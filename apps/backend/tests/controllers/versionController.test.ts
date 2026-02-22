import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeReq, makeRes, makeNext } from '../mocks/factories';
import { AppError } from '../../src/middleware/errorHandler';

// ─── Mock versionService ──────────────────────────────────────────────────────
vi.mock('../../src/services/versionService', () => ({
  versionService: {
    listVersions: vi.fn(),
  },
}));

import { versionController } from '../../src/controllers/versionController';
import { versionService } from '../../src/services/versionService';

// ─── Helper factories ─────────────────────────────────────────────────────────
function makeVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ver-' + Math.random().toString(36).slice(2, 8),
    createdAt: new Date().toISOString(),
    label: null,
    snapshot: [],
    ...overrides,
  };
}

describe('versionController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── listVersions ─────────────────────────────────────────────────────────────
  describe('listVersions', () => {
    it('returns versions list on happy path', async () => {
      const versions = [makeVersion({ label: 'v1' }), makeVersion({ label: 'v2' })];
      vi.mocked(versionService.listVersions).mockResolvedValue(versions as never);

      const req = makeReq({ params: { id: 'board-1' } });
      const res = makeRes();
      const next = makeNext();

      await versionController.listVersions(req, res, next);

      expect(versionService.listVersions).toHaveBeenCalledWith('board-1', 'auth0|user-1');
      expect(res.json).toHaveBeenCalledWith(versions);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns empty array when board has no versions', async () => {
      vi.mocked(versionService.listVersions).mockResolvedValue([] as never);

      const req = makeReq({ params: { id: 'board-new' } });
      const res = makeRes();
      const next = makeNext();

      await versionController.listVersions(req, res, next);

      expect(res.json).toHaveBeenCalledWith([]);
    });

    it('passes correct boardId and userId from request to service', async () => {
      vi.mocked(versionService.listVersions).mockResolvedValue([] as never);

      const req = makeReq({
        params: { id: 'board-abc123' },
        user: { sub: 'auth0|specific-user', name: 'Alice', email: 'alice@example.com' },
      });
      const res = makeRes();
      const next = makeNext();

      await versionController.listVersions(req, res, next);

      expect(versionService.listVersions).toHaveBeenCalledWith('board-abc123', 'auth0|specific-user');
    });

    it('calls next with 404 AppError when board is not found', async () => {
      const error = new AppError(404, 'Board not found');
      vi.mocked(versionService.listVersions).mockRejectedValue(error);

      const req = makeReq({ params: { id: 'nonexistent' } });
      const res = makeRes();
      const next = makeNext();

      await versionController.listVersions(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.json).not.toHaveBeenCalled();
    });

    it('calls next with 403 AppError when user is not the board owner', async () => {
      const error = new AppError(403, 'You do not have access to this board');
      vi.mocked(versionService.listVersions).mockRejectedValue(error);

      const req = makeReq({
        params: { id: 'board-owned-by-other' },
        user: { sub: 'auth0|other-user', name: 'Bob', email: 'bob@example.com' },
      });
      const res = makeRes();
      const next = makeNext();

      await versionController.listVersions(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
      const err = vi.mocked(next).mock.calls[0][0] as AppError;
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(403);
    });

    it('calls next with generic error when service throws unexpectedly', async () => {
      const error = new Error('DB connection lost');
      vi.mocked(versionService.listVersions).mockRejectedValue(error);

      const req = makeReq({ params: { id: 'board-1' } });
      const res = makeRes();
      const next = makeNext();

      await versionController.listVersions(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });

    it('calls next when user is missing from request', async () => {
      const req = makeReq({ user: undefined, params: { id: 'board-1' } });
      const res = makeRes();
      const next = makeNext();

      await versionController.listVersions(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(vi.mocked(next).mock.calls[0][0]).toBeInstanceOf(Error);
    });
  });
});
