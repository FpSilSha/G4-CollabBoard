import { Request, Response, NextFunction } from 'express';
import { redis } from '../utils/redis';
import { RATE_LIMITS } from 'shared';
import { AuthenticatedRequest } from './auth';
import { logger } from '../utils/logger';

/**
 * In-memory fallback rate limit counters.
 * Used when Redis is unavailable so the API is not left completely unprotected.
 * Map key format: `${action}:${userId}:${bucket}`
 */
const fallbackCounters = new Map<string, { count: number; expires: number }>();

/** Periodically clean expired fallback counters (every 60s) */
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of fallbackCounters) {
    if (entry.expires < now) {
      fallbackCounters.delete(key);
    }
  }
}, 60000);

/**
 * Redis-based rate limiter middleware with in-memory fallback.
 * Uses a fixed-window counter per user per action.
 *
 * When Redis is down, switches to an in-memory Map so rate limiting
 * is never fully bypassed (fail-closed with degraded accuracy).
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
      // Redis is down — fall back to in-memory rate limiting
      logger.warn(`Redis rate-limit unavailable, using in-memory fallback for ${action}`);

      const entry = fallbackCounters.get(key);
      const now = Date.now();

      if (entry && entry.expires > now) {
        entry.count++;
        if (entry.count > limit) {
          res.status(429).json({
            error: 'Rate Limit Exceeded',
            message: 'Too many requests. Please slow down.',
            statusCode: 429,
          });
          return;
        }
      } else {
        fallbackCounters.set(key, { count: 1, expires: now + windowMs });
      }

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
