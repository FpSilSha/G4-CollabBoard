import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { boardService } from '../services/boardService';
import { auditService, AuditAction } from '../services/auditService';
import { getIO } from '../websocket/server';
import { WebSocketEvent } from 'shared';

export const boardController = {
  /**
   * GET /boards
   */
  async listBoards(req: Request, res: Response, next: NextFunction) {
    try {
      const { sub } = (req as AuthenticatedRequest).user;
      const includeDeleted = req.query.includeDeleted === 'true';
      const result = await boardService.listBoards(sub, includeDeleted);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /boards
   */
  async createBoard(req: Request, res: Response, next: NextFunction) {
    try {
      const { sub } = (req as AuthenticatedRequest).user;
      const { title } = req.body;
      const result = await boardService.createBoard(sub, title);

      auditService.log({
        userId: sub,
        action: AuditAction.BOARD_CREATE,
        entityType: 'board',
        entityId: result.id,
        metadata: { title },
      });

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /boards/:id
   */
  async getBoard(req: Request, res: Response, next: NextFunction) {
    try {
      const { sub } = (req as AuthenticatedRequest).user;
      const { id } = req.params;
      const result = await boardService.getBoard(id, sub);

      auditService.log({
        userId: sub,
        action: AuditAction.BOARD_VIEW,
        entityType: 'board',
        entityId: id,
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  /**
   * PATCH /boards/:id
   */
  async renameBoard(req: Request, res: Response, next: NextFunction) {
    try {
      const { sub } = (req as AuthenticatedRequest).user;
      const { id } = req.params;
      const { title } = req.body;
      const result = await boardService.renameBoard(id, sub, title);

      auditService.log({
        userId: sub,
        action: AuditAction.BOARD_UPDATE,
        entityType: 'board',
        entityId: id,
        metadata: { title },
      });

      // Broadcast rename to all users on this board
      try {
        getIO().to(id).emit(WebSocketEvent.BOARD_RENAMED, { boardId: id, title });
      } catch {
        // Socket.io not initialized (e.g. during tests) — skip broadcast
      }

      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  /**
   * DELETE /boards/:id
   */
  async deleteBoard(req: Request, res: Response, next: NextFunction) {
    try {
      const { sub } = (req as AuthenticatedRequest).user;
      const { id } = req.params;
      const result = await boardService.deleteBoard(id, sub);

      auditService.log({
        userId: sub,
        action: AuditAction.BOARD_DELETE,
        entityType: 'board',
        entityId: id,
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  /**
   * DELETE /boards/:id/link
   * Remove a linked-board entry (user visited via link). Does NOT delete the board.
   */
  async unlinkBoard(req: Request, res: Response, next: NextFunction) {
    try {
      const { sub } = (req as AuthenticatedRequest).user;
      const { id } = req.params;
      const result = await boardService.unlinkBoard(id, sub);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  /**
   * PUT /boards/:id/thumbnail
   * Save a JPEG thumbnail (base64) for the board's dashboard card.
   */
  async saveThumbnail(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { thumbnail, version } = req.body;

      if (!thumbnail || typeof thumbnail !== 'string') {
        res.status(400).json({ error: 'Missing thumbnail data' });
        return;
      }

      // Cap at ~200KB to prevent abuse
      if (thumbnail.length > 200_000) {
        res.status(400).json({ error: 'Thumbnail too large (max ~200KB)' });
        return;
      }

      const result = await boardService.saveThumbnail(
        id,
        thumbnail,
        typeof version === 'number' ? version : undefined,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
};
