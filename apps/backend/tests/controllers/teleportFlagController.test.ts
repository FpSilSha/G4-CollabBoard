import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeReq, makeRes, makeNext } from '../mocks/factories';
import { AppError } from '../../src/middleware/errorHandler';

// ─── Mock teleportFlagService ─────────────────────────────────────────────────
vi.mock('../../src/services/teleportFlagService', () => ({
  teleportFlagService: {
    listFlags: vi.fn(),
    createFlag: vi.fn(),
    updateFlag: vi.fn(),
    deleteFlag: vi.fn(),
  },
}));

// ─── Mock wsMetrics ───────────────────────────────────────────────────────────
vi.mock('../../src/websocket/wsMetrics', () => ({
  trackedEmit: vi.fn(),
}));

import { teleportFlagController } from '../../src/controllers/teleportFlagController';
import { teleportFlagService } from '../../src/services/teleportFlagService';
import { trackedEmit } from '../../src/websocket/wsMetrics';

// ─── Helper factories ─────────────────────────────────────────────────────────
function makeFlag(overrides: Record<string, unknown> = {}) {
  return {
    id: 'flag-1',
    boardId: 'board-1',
    createdBy: 'auth0|user-1',
    label: 'Checkpoint A',
    x: 500,
    y: 300,
    color: '#FF0000',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('teleportFlagController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── listFlags ───────────────────────────────────────────────────────────────
  describe('listFlags', () => {
    it('returns flags list on happy path', async () => {
      const flags = [makeFlag(), makeFlag({ id: 'flag-2' })];
      vi.mocked(teleportFlagService.listFlags).mockResolvedValue({ flags } as never);

      const req = makeReq({ params: { id: 'board-1' } });
      const res = makeRes();
      const next = makeNext();

      await teleportFlagController.listFlags(req, res, next);

      expect(teleportFlagService.listFlags).toHaveBeenCalledWith('board-1');
      expect(res.json).toHaveBeenCalledWith({ flags });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns empty flags array when board has no flags', async () => {
      vi.mocked(teleportFlagService.listFlags).mockResolvedValue({ flags: [] } as never);

      const req = makeReq({ params: { id: 'board-empty' } });
      const res = makeRes();
      const next = makeNext();

      await teleportFlagController.listFlags(req, res, next);

      expect(res.json).toHaveBeenCalledWith({ flags: [] });
    });

    it('calls next with 404 AppError when board is not found', async () => {
      const error = new AppError(404, 'Board not found');
      vi.mocked(teleportFlagService.listFlags).mockRejectedValue(error);

      const req = makeReq({ params: { id: 'nonexistent' } });
      const res = makeRes();
      const next = makeNext();

      await teleportFlagController.listFlags(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.json).not.toHaveBeenCalled();
    });

    it('calls next with generic error when service throws', async () => {
      const error = new Error('DB connection failed');
      vi.mocked(teleportFlagService.listFlags).mockRejectedValue(error);

      const req = makeReq({ params: { id: 'board-1' } });
      const res = makeRes();
      const next = makeNext();

      await teleportFlagController.listFlags(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // ─── createFlag ──────────────────────────────────────────────────────────────
  describe('createFlag', () => {
    it('creates a flag, broadcasts via WebSocket, and returns 201', async () => {
      const flag = makeFlag();
      vi.mocked(teleportFlagService.createFlag).mockResolvedValue(flag as never);

      const req = makeReq({
        params: { id: 'board-1' },
        body: { label: 'Checkpoint A', x: 500, y: 300, color: '#FF0000' },
      });
      const res = makeRes();
      const next = makeNext();

      await teleportFlagController.createFlag(req, res, next);

      expect(teleportFlagService.createFlag).toHaveBeenCalledWith(
        'board-1',
        'auth0|user-1',
        { label: 'Checkpoint A', x: 500, y: 300, color: '#FF0000' }
      );
      expect(trackedEmit).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(flag);
      expect(next).not.toHaveBeenCalled();
    });

    it('broadcasts FLAG_CREATED event with correct payload shape', async () => {
      const flag = makeFlag();
      vi.mocked(teleportFlagService.createFlag).mockResolvedValue(flag as never);

      const req = makeReq({
        params: { id: 'board-1' },
        body: { label: 'Point B', x: 100, y: 200, color: '#00FF00' },
      });
      const res = makeRes();
      const next = makeNext();

      await teleportFlagController.createFlag(req, res, next);

      const [, , payload] = vi.mocked(trackedEmit).mock.calls[0] as [unknown, unknown, Record<string, unknown>];
      expect(payload).toMatchObject({
        boardId: 'board-1',
        flag,
        userId: 'auth0|user-1',
      });
      expect(typeof payload.timestamp).toBe('number');
    });

    it('calls next with AppError when createFlag service throws', async () => {
      const error = new AppError(404, 'Board not found');
      vi.mocked(teleportFlagService.createFlag).mockRejectedValue(error);

      const req = makeReq({
        params: { id: 'bad-board' },
        body: { label: 'Test', x: 0, y: 0, color: '#000' },
      });
      const res = makeRes();
      const next = makeNext();

      await teleportFlagController.createFlag(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  // ─── updateFlag ──────────────────────────────────────────────────────────────
  describe('updateFlag', () => {
    it('updates a flag, broadcasts via WebSocket, and returns updated flag', async () => {
      const updatedFlag = makeFlag({ label: 'Updated Label' });
      vi.mocked(teleportFlagService.updateFlag).mockResolvedValue(updatedFlag as never);

      const req = makeReq({
        params: { id: 'board-1', flagId: 'flag-1' },
        body: { label: 'Updated Label' },
      });
      const res = makeRes();
      const next = makeNext();

      await teleportFlagController.updateFlag(req, res, next);

      expect(teleportFlagService.updateFlag).toHaveBeenCalledWith(
        'board-1',
        'flag-1',
        'auth0|user-1',
        { label: 'Updated Label' }
      );
      expect(trackedEmit).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(updatedFlag);
      expect(next).not.toHaveBeenCalled();
    });

    it('broadcasts FLAG_UPDATED event with correct payload shape', async () => {
      const updatedFlag = makeFlag({ x: 999, y: 888 });
      vi.mocked(teleportFlagService.updateFlag).mockResolvedValue(updatedFlag as never);

      const req = makeReq({
        params: { id: 'board-1', flagId: 'flag-1' },
        body: { x: 999, y: 888 },
      });
      const res = makeRes();
      const next = makeNext();

      await teleportFlagController.updateFlag(req, res, next);

      const [, , payload] = vi.mocked(trackedEmit).mock.calls[0] as [unknown, unknown, Record<string, unknown>];
      expect(payload).toMatchObject({
        boardId: 'board-1',
        flag: updatedFlag,
        userId: 'auth0|user-1',
      });
      expect(typeof payload.timestamp).toBe('number');
    });

    it('calls next when updateFlag service throws 404', async () => {
      const error = new AppError(404, 'Flag not found');
      vi.mocked(teleportFlagService.updateFlag).mockRejectedValue(error);

      const req = makeReq({
        params: { id: 'board-1', flagId: 'nonexistent' },
        body: { label: 'X' },
      });
      const res = makeRes();
      const next = makeNext();

      await teleportFlagController.updateFlag(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.json).not.toHaveBeenCalled();
    });

    it('calls next with generic error when service throws', async () => {
      const error = new Error('Unexpected DB error');
      vi.mocked(teleportFlagService.updateFlag).mockRejectedValue(error);

      const req = makeReq({
        params: { id: 'board-1', flagId: 'flag-1' },
        body: { color: '#AABBCC' },
      });
      const res = makeRes();
      const next = makeNext();

      await teleportFlagController.updateFlag(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // ─── deleteFlag ──────────────────────────────────────────────────────────────
  describe('deleteFlag', () => {
    it('deletes a flag, broadcasts via WebSocket, and returns result', async () => {
      const result = { success: true };
      vi.mocked(teleportFlagService.deleteFlag).mockResolvedValue(result as never);

      const req = makeReq({
        params: { id: 'board-1', flagId: 'flag-1' },
      });
      const res = makeRes();
      const next = makeNext();

      await teleportFlagController.deleteFlag(req, res, next);

      expect(teleportFlagService.deleteFlag).toHaveBeenCalledWith('board-1', 'flag-1', 'auth0|user-1');
      expect(trackedEmit).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(result);
      expect(next).not.toHaveBeenCalled();
    });

    it('broadcasts FLAG_DELETED event with correct payload shape', async () => {
      vi.mocked(teleportFlagService.deleteFlag).mockResolvedValue({} as never);

      const req = makeReq({
        params: { id: 'board-1', flagId: 'flag-42' },
      });
      const res = makeRes();
      const next = makeNext();

      await teleportFlagController.deleteFlag(req, res, next);

      const [, , payload] = vi.mocked(trackedEmit).mock.calls[0] as [unknown, unknown, Record<string, unknown>];
      expect(payload).toMatchObject({
        boardId: 'board-1',
        flagId: 'flag-42',
        userId: 'auth0|user-1',
      });
      expect(typeof payload.timestamp).toBe('number');
    });

    it('calls next with AppError when deleteFlag service throws 404', async () => {
      const error = new AppError(404, 'Flag not found');
      vi.mocked(teleportFlagService.deleteFlag).mockRejectedValue(error);

      const req = makeReq({
        params: { id: 'board-1', flagId: 'nonexistent' },
      });
      const res = makeRes();
      const next = makeNext();

      await teleportFlagController.deleteFlag(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.json).not.toHaveBeenCalled();
    });

    it('calls next with generic error when service throws', async () => {
      const error = new Error('DB error');
      vi.mocked(teleportFlagService.deleteFlag).mockRejectedValue(error);

      const req = makeReq({
        params: { id: 'board-1', flagId: 'flag-1' },
      });
      const res = makeRes();
      const next = makeNext();

      await teleportFlagController.deleteFlag(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });
});
