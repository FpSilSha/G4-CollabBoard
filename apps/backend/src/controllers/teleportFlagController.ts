import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { teleportFlagService } from '../services/teleportFlagService';

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
      const { id: boardId, flagId } = req.params;
      const result = await teleportFlagService.updateFlag(boardId, flagId, req.body);
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
      const { id: boardId, flagId } = req.params;
      const result = await teleportFlagService.deleteFlag(boardId, flagId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
};
