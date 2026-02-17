import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { versionService } from '../services/versionService';

export const versionController = {
  /**
   * GET /boards/:id/versions
   */
  async listVersions(req: Request, res: Response, next: NextFunction) {
    try {
      const { sub } = (req as AuthenticatedRequest).user;
      const { id } = req.params;
      const result = await versionService.listVersions(id, sub);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
};
