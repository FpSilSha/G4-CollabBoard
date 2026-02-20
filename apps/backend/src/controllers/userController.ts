import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { userService } from '../services/userService';

export const userController = {
  /**
   * GET /auth/me
   * Get current authenticated user. Creates user in DB if first login.
   */
  async getMe(req: Request, res: Response, next: NextFunction) {
    try {
      const { sub, email, name } = (req as AuthenticatedRequest).user;
      const user = await userService.findOrCreateUser(sub, email, name);

      res.json({
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        color: user.color,
        subscriptionStatus: user.subscriptionStatus.toLowerCase(),
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * PATCH /auth/me
   * Update user profile (name only).
   */
  async updateMe(req: Request, res: Response, next: NextFunction) {
    try {
      const { sub } = (req as AuthenticatedRequest).user;
      const { name } = req.body;

      const user = await userService.updateProfile(sub, name);

      res.json({
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        color: user.color,
        subscriptionStatus: user.subscriptionStatus.toLowerCase(),
      });
    } catch (err) {
      next(err);
    }
  },
};
