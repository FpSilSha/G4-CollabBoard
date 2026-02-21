import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { teleportFlagService } from '../services/teleportFlagService';
import { WebSocketEvent } from 'shared';
import { getIO } from '../websocket/server';
import { trackedEmit } from '../websocket/wsMetrics';

export const teleportFlagController = {
  /**
   * GET /boards/:id/flags
   */
  async listFlags(req: Request, res: Response, next: NextFunction) {
    try {
      const { id: boardId } = req.params;
      const result = await teleportFlagService.listFlags(boardId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /boards/:id/flags
   */
  async createFlag(req: Request, res: Response, next: NextFunction) {
    try {
      const { sub } = (req as AuthenticatedRequest).user;
      const { id: boardId } = req.params;
      const { label, x, y, color } = req.body;
      const result = await teleportFlagService.createFlag(boardId, sub, { label, x, y, color });

      // Broadcast to all clients in the board room (including sender).
      // Frontend skips the event if userId matches local user (already added optimistically).
      const io = getIO();
      trackedEmit(io.to(boardId), WebSocketEvent.FLAG_CREATED, {
        boardId,
        flag: result,
        userId: sub,
        timestamp: Date.now(),
      });

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },

  /**
   * PATCH /boards/:id/flags/:flagId
   */
  async updateFlag(req: Request, res: Response, next: NextFunction) {
    try {
      const { sub } = (req as AuthenticatedRequest).user;
      const { id: boardId, flagId } = req.params;
      const result = await teleportFlagService.updateFlag(boardId, flagId, req.body);

      // Broadcast to all clients in the board room (including sender).
      // Frontend skips the event if userId matches local user (already updated optimistically).
      const io = getIO();
      trackedEmit(io.to(boardId), WebSocketEvent.FLAG_UPDATED, {
        boardId,
        flag: result,
        userId: sub,
        timestamp: Date.now(),
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  /**
   * DELETE /boards/:id/flags/:flagId
   */
  async deleteFlag(req: Request, res: Response, next: NextFunction) {
    try {
      const { sub } = (req as AuthenticatedRequest).user;
      const { id: boardId, flagId } = req.params;
      const result = await teleportFlagService.deleteFlag(boardId, flagId);

      // Broadcast to all clients in the board room (including sender).
      // Uses io.to() because this is a REST controller — no socket context.
      // Frontend skips the event if userId matches local user (already removed optimistically).
      const io = getIO();
      trackedEmit(io.to(boardId), WebSocketEvent.FLAG_DELETED, {
        boardId,
        flagId,
        userId: sub,
        timestamp: Date.now(),
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  },
};
