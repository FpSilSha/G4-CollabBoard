import { Request, Response, NextFunction } from 'express';
import { redis } from '../utils/redis';
import { RATE_LIMITS } from 'shared';
import { AuthenticatedRequest } from './auth';

/**
 * Redis-based rate limiter middleware.
 * Uses a fixed-window counter per user per action.
 */
export function rateLimit(action: string, limit: number, windowMs: number) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = (req as AuthenticatedRequest).user?.sub || req.ip;
    const bucket = Math.floor(Date.now() / windowMs);
    const key = `ratelimit:${action}:${userId}:${bucket}`;

    try {
      const current = await redis.incr(key);

      if (current === 1) {
        await redis.expire(key, Math.ceil(windowMs / 1000));
      }

      res.setHeader('X-RateLimit-Limit', limit);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - current));

      if (current > limit) {
        res.status(429).json({
          error: 'Rate Limit Exceeded',
          message: 'Too many requests. Please slow down.',
          statusCode: 429,
        });
        return;
      }

      next();
    } catch (err) {
      // If Redis is down, allow the request through (fail open)
      next();
    }
  };
}

/**
 * Default API rate limiter: 100 requests per minute
 */
export const apiRateLimit = rateLimit(
  'api',
  RATE_LIMITS.API_REQUESTS_PER_MINUTE,
  60000
);
