import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { boardService } from '../services/boardService';

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
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
};
