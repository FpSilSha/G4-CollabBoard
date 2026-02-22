import { describe, it, expect, beforeEach, vi } from 'vitest';
import { boardController } from '../../src/controllers/boardController';
import { makeReq, makeRes, makeNext, makeBoard } from '../mocks/factories';
import { AppError } from '../../src/middleware/errorHandler';

// ─── Mock boardService ────────────────────────────────────────────────────────
vi.mock('../../src/services/boardService', () => ({
  boardService: {
    listBoards: vi.fn(),
    createBoard: vi.fn(),
    getBoard: vi.fn(),
    renameBoard: vi.fn(),
    deleteBoard: vi.fn(),
    unlinkBoard: vi.fn(),
    saveThumbnail: vi.fn(),
    getBoardStateFromRedis: vi.fn(),
    flushRedisToPostgres: vi.fn(),
  },
}));

// ─── Mock auditService ────────────────────────────────────────────────────────
vi.mock('../../src/services/auditService', () => ({
  auditService: {
    log: vi.fn(),
  },
  AuditAction: {
    BOARD_CREATE: 'board.create',
    BOARD_VIEW: 'board.view',
    BOARD_UPDATE: 'board.update',
    BOARD_DELETE: 'board.delete',
  },
}));

import { boardService } from '../../src/services/boardService';

describe('boardController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── listBoards ─────────────────────────────────────────────────────────────
  describe('listBoards', () => {
    it('returns board list on happy path', async () => {
      const boards = [makeBoard(), makeBoard()];
      vi.mocked(boardService.listBoards).mockResolvedValue(boards as never);

      const req = makeReq({ query: {} });
      const res = makeRes();
      const next = makeNext();

      await boardController.listBoards(req, res, next);

      expect(boardService.listBoards).toHaveBeenCalledWith('auth0|user-1', false);
      expect(res.json).toHaveBeenCalledWith(boards);
      expect(next).not.toHaveBeenCalled();
    });

    it('passes includeDeleted=true from query string', async () => {
      vi.mocked(boardService.listBoards).mockResolvedValue([] as never);

      const req = makeReq({ query: { includeDeleted: 'true' } });
      const res = makeRes();
      const next = makeNext();

      await boardController.listBoards(req, res, next);

      expect(boardService.listBoards).toHaveBeenCalledWith('auth0|user-1', true);
    });

    it('calls next with AppError when service throws AppError', async () => {
      const error = new AppError(403, 'Forbidden');
      vi.mocked(boardService.listBoards).mockRejectedValue(error);

      const req = makeReq({ query: {} });
      const res = makeRes();
      const next = makeNext();

      await boardController.listBoards(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.json).not.toHaveBeenCalled();
    });

    it('calls next with generic error when service throws', async () => {
      const error = new Error('DB connection failed');
      vi.mocked(boardService.listBoards).mockRejectedValue(error);

      const req = makeReq({ query: {} });
      const res = makeRes();
      const next = makeNext();

      await boardController.listBoards(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });

    it('calls next with TypeError when user is missing from request', async () => {
      const req = makeReq({ user: undefined, query: {} });
      const res = makeRes();
      const next = makeNext();

      await boardController.listBoards(req, res, next);

      expect(next).toHaveBeenCalled();
      const calledWith = vi.mocked(next).mock.calls[0][0];
      expect(calledWith).toBeInstanceOf(Error);
    });
  });

  // ─── createBoard ─────────────────────────────────────────────────────────────
  describe('createBoard', () => {
    it('creates a board and responds with 201', async () => {
      const board = makeBoard({ title: 'New Board' });
      vi.mocked(boardService.createBoard).mockResolvedValue(board as never);

      const req = makeReq({ body: { title: 'New Board' } });
      const res = makeRes();
      const next = makeNext();

      await boardController.createBoard(req, res, next);

      expect(boardService.createBoard).toHaveBeenCalledWith('auth0|user-1', 'New Board');
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(board);
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next when createBoard service throws AppError', async () => {
      const error = new AppError(400, 'Invalid title');
      vi.mocked(boardService.createBoard).mockRejectedValue(error);

      const req = makeReq({ body: { title: '' } });
      const res = makeRes();
      const next = makeNext();

      await boardController.createBoard(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('calls next with generic error from service', async () => {
      const error = new Error('Unexpected failure');
      vi.mocked(boardService.createBoard).mockRejectedValue(error);

      const req = makeReq({ body: { title: 'Board' } });
      const res = makeRes();
      const next = makeNext();

      await boardController.createBoard(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });

    it('throws when user is missing', async () => {
      const req = makeReq({ user: undefined, body: { title: 'Board' } });
      const res = makeRes();
      const next = makeNext();

      await boardController.createBoard(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(vi.mocked(next).mock.calls[0][0]).toBeInstanceOf(Error);
    });
  });

  // ─── getBoard ────────────────────────────────────────────────────────────────
  describe('getBoard', () => {
    it('returns board on happy path', async () => {
      const board = makeBoard();
      vi.mocked(boardService.getBoard).mockResolvedValue(board as never);

      const req = makeReq({ params: { id: board.id } });
      const res = makeRes();
      const next = makeNext();

      await boardController.getBoard(req, res, next);

      expect(boardService.getBoard).toHaveBeenCalledWith(board.id, 'auth0|user-1');
      expect(res.json).toHaveBeenCalledWith(board);
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next with 404 AppError when board service throws 404', async () => {
      const error = new AppError(404, 'Board not found');
      vi.mocked(boardService.getBoard).mockRejectedValue(error);

      const req = makeReq({ params: { id: 'nonexistent' } });
      const res = makeRes();
      const next = makeNext();

      await boardController.getBoard(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect((next as ReturnType<typeof makeNext> & { mock: { calls: unknown[][] } })
        .mock.calls[0][0]).toBeInstanceOf(AppError);
    });

    it('calls next with 403 AppError when user lacks access', async () => {
      const error = new AppError(403, 'Access denied');
      vi.mocked(boardService.getBoard).mockRejectedValue(error);

      const req = makeReq({ params: { id: 'some-board' } });
      const res = makeRes();
      const next = makeNext();

      await boardController.getBoard(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });

    it('passes user sub and board id to getBoard', async () => {
      const board = makeBoard({ id: 'board-abc' });
      vi.mocked(boardService.getBoard).mockResolvedValue(board as never);

      const req = makeReq({ params: { id: 'board-abc' } });
      const res = makeRes();
      const next = makeNext();

      await boardController.getBoard(req, res, next);

      expect(boardService.getBoard).toHaveBeenCalledWith('board-abc', 'auth0|user-1');
    });
  });

  // ─── renameBoard ─────────────────────────────────────────────────────────────
  describe('renameBoard', () => {
    it('renames a board and returns result', async () => {
      const board = makeBoard({ title: 'Renamed' });
      vi.mocked(boardService.renameBoard).mockResolvedValue(board as never);

      const req = makeReq({ params: { id: board.id }, body: { title: 'Renamed' } });
      const res = makeRes();
      const next = makeNext();

      await boardController.renameBoard(req, res, next);

      expect(boardService.renameBoard).toHaveBeenCalledWith(board.id, 'auth0|user-1', 'Renamed');
      expect(res.json).toHaveBeenCalledWith(board);
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next with AppError when renameBoard throws', async () => {
      const error = new AppError(404, 'Board not found');
      vi.mocked(boardService.renameBoard).mockRejectedValue(error);

      const req = makeReq({ params: { id: 'bad-id' }, body: { title: 'X' } });
      const res = makeRes();
      const next = makeNext();

      await boardController.renameBoard(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.json).not.toHaveBeenCalled();
    });

    it('calls next with generic error from service', async () => {
      const error = new Error('DB error');
      vi.mocked(boardService.renameBoard).mockRejectedValue(error);

      const req = makeReq({ params: { id: 'board-x' }, body: { title: 'T' } });
      const res = makeRes();
      const next = makeNext();

      await boardController.renameBoard(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // ─── deleteBoard ─────────────────────────────────────────────────────────────
  describe('deleteBoard', () => {
    it('deletes a board and returns result', async () => {
      const board = makeBoard({ isDeleted: true });
      vi.mocked(boardService.deleteBoard).mockResolvedValue(board as never);

      const req = makeReq({ params: { id: board.id } });
      const res = makeRes();
      const next = makeNext();

      await boardController.deleteBoard(req, res, next);

      expect(boardService.deleteBoard).toHaveBeenCalledWith(board.id, 'auth0|user-1');
      expect(res.json).toHaveBeenCalledWith(board);
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next with AppError when service throws 403', async () => {
      const error = new AppError(403, 'Cannot delete board you do not own');
      vi.mocked(boardService.deleteBoard).mockRejectedValue(error);

      const req = makeReq({ params: { id: 'board-x' } });
      const res = makeRes();
      const next = makeNext();

      await boardController.deleteBoard(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });

    it('calls next with generic error', async () => {
      const error = new Error('unexpected');
      vi.mocked(boardService.deleteBoard).mockRejectedValue(error);

      const req = makeReq({ params: { id: 'board-x' } });
      const res = makeRes();
      const next = makeNext();

      await boardController.deleteBoard(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // ─── unlinkBoard ─────────────────────────────────────────────────────────────
  describe('unlinkBoard', () => {
    it('unlinks a board and returns result', async () => {
      const result = { success: true };
      vi.mocked(boardService.unlinkBoard).mockResolvedValue(result as never);

      const req = makeReq({ params: { id: 'board-abc' } });
      const res = makeRes();
      const next = makeNext();

      await boardController.unlinkBoard(req, res, next);

      expect(boardService.unlinkBoard).toHaveBeenCalledWith('board-abc', 'auth0|user-1');
      expect(res.json).toHaveBeenCalledWith(result);
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next when unlinkBoard throws', async () => {
      const error = new AppError(404, 'Link not found');
      vi.mocked(boardService.unlinkBoard).mockRejectedValue(error);

      const req = makeReq({ params: { id: 'board-x' } });
      const res = makeRes();
      const next = makeNext();

      await boardController.unlinkBoard(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // ─── saveThumbnail ─────────────────────────────────────────────────────────
  describe('saveThumbnail', () => {
    it('saves thumbnail and returns result', async () => {
      const result = { success: true };
      vi.mocked(boardService.saveThumbnail).mockResolvedValue(result as never);

      const req = makeReq({
        params: { id: 'board-abc' },
        body: { thumbnail: 'data:image/jpeg;base64,abc', version: 1 },
      });
      const res = makeRes();
      const next = makeNext();

      await boardController.saveThumbnail(req, res, next);

      expect(boardService.saveThumbnail).toHaveBeenCalledWith('board-abc', 'data:image/jpeg;base64,abc', 1);
      expect(res.json).toHaveBeenCalledWith(result);
      expect(next).not.toHaveBeenCalled();
    });

    it('responds 400 when thumbnail is missing', async () => {
      const req = makeReq({ params: { id: 'board-abc' }, body: {} });
      const res = makeRes();
      const next = makeNext();

      await boardController.saveThumbnail(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Missing thumbnail data' });
      expect(boardService.saveThumbnail).not.toHaveBeenCalled();
    });

    it('responds 400 when thumbnail is not a string', async () => {
      const req = makeReq({
        params: { id: 'board-abc' },
        body: { thumbnail: 12345 },
      });
      const res = makeRes();
      const next = makeNext();

      await boardController.saveThumbnail(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Missing thumbnail data' });
    });

    it('responds 400 when thumbnail exceeds 200KB', async () => {
      const bigThumbnail = 'x'.repeat(200_001);
      const req = makeReq({
        params: { id: 'board-abc' },
        body: { thumbnail: bigThumbnail },
      });
      const res = makeRes();
      const next = makeNext();

      await boardController.saveThumbnail(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Thumbnail too large (max ~200KB)' });
      expect(boardService.saveThumbnail).not.toHaveBeenCalled();
    });

    it('passes undefined for version when version is not a number', async () => {
      const result = { success: true };
      vi.mocked(boardService.saveThumbnail).mockResolvedValue(result as never);

      const req = makeReq({
        params: { id: 'board-abc' },
        body: { thumbnail: 'data:image/jpeg;base64,abc', version: 'not-a-number' },
      });
      const res = makeRes();
      const next = makeNext();

      await boardController.saveThumbnail(req, res, next);

      expect(boardService.saveThumbnail).toHaveBeenCalledWith('board-abc', 'data:image/jpeg;base64,abc', undefined);
    });

    it('calls next when saveThumbnail service throws', async () => {
      const error = new AppError(404, 'Board not found');
      vi.mocked(boardService.saveThumbnail).mockRejectedValue(error);

      const req = makeReq({
        params: { id: 'board-abc' },
        body: { thumbnail: 'data:image/jpeg;base64,abc' },
      });
      const res = makeRes();
      const next = makeNext();

      await boardController.saveThumbnail(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });
});
