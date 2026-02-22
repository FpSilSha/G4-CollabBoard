import { describe, it, expect, beforeEach, vi } from 'vitest';
import { rateLimit } from '../../src/middleware/rateLimit';
import { makeReq, makeRes, makeNext } from '../mocks/factories';

// ─── Mock auditService ────────────────────────────────────────────────────────
vi.mock('../../src/services/auditService', () => ({
  auditService: {
    log: vi.fn(),
  },
  AuditAction: {
    RATE_LIMIT_EXCEEDED: 'rate_limit.exceeded',
  },
}));

import { instrumentedRedis as redis } from '../../src/utils/instrumentedRedis';

describe('rateLimit middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Redis path: under limit ───────────────────────────────────────────────
  describe('under limit (Redis available)', () => {
    it('calls next() when current count is within limit', async () => {
      vi.mocked(redis.incr).mockResolvedValue(1);
      vi.mocked(redis.expire).mockResolvedValue(1 as never);

      const middleware = rateLimit('test-action', 10, 60000);
      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('calls expire on the first request (incr returns 1)', async () => {
      vi.mocked(redis.incr).mockResolvedValue(1);
      vi.mocked(redis.expire).mockResolvedValue(1 as never);

      const middleware = rateLimit('test-action', 10, 60000);
      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      await middleware(req, res, next);

      expect(redis.expire).toHaveBeenCalledWith(
        expect.stringContaining('ratelimit:test-action:'),
        expect.any(Number),
      );
    });

    it('does NOT call expire for subsequent requests (incr > 1)', async () => {
      vi.mocked(redis.incr).mockResolvedValue(5); // 5th request in window
      vi.mocked(redis.expire).mockResolvedValue(1 as never);

      const middleware = rateLimit('test-action', 10, 60000);
      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      await middleware(req, res, next);

      expect(redis.expire).not.toHaveBeenCalled();
    });

    it('sets X-RateLimit-Limit and X-RateLimit-Remaining headers', async () => {
      vi.mocked(redis.incr).mockResolvedValue(3);
      vi.mocked(redis.expire).mockResolvedValue(1 as never);

      const res = makeRes();
      const setHeaderMock = vi.fn();
      (res as unknown as { setHeader: typeof setHeaderMock }).setHeader = setHeaderMock;

      const middleware = rateLimit('test-action', 10, 60000);
      const req = makeReq();
      const next = makeNext();

      await middleware(req, res as never, next);

      expect(setHeaderMock).toHaveBeenCalledWith('X-RateLimit-Limit', 10);
      expect(setHeaderMock).toHaveBeenCalledWith('X-RateLimit-Remaining', 7); // 10 - 3
    });

    it('sets X-RateLimit-Remaining to 0 (not negative) at the limit boundary', async () => {
      vi.mocked(redis.incr).mockResolvedValue(10); // exactly at limit
      vi.mocked(redis.expire).mockResolvedValue(1 as never);

      const res = makeRes();
      const setHeaderMock = vi.fn();
      (res as unknown as { setHeader: typeof setHeaderMock }).setHeader = setHeaderMock;

      const middleware = rateLimit('test-action', 10, 60000);
      const req = makeReq();
      const next = makeNext();

      await middleware(req, res as never, next);

      // still allows through (count === limit, not count > limit)
      expect(next).toHaveBeenCalledWith();
      expect(setHeaderMock).toHaveBeenCalledWith('X-RateLimit-Remaining', 0);
    });
  });

  // ─── Redis path: over limit ────────────────────────────────────────────────
  describe('over limit (Redis available)', () => {
    it('responds 429 when current count exceeds limit', async () => {
      vi.mocked(redis.incr).mockResolvedValue(11); // 11 > limit of 10
      vi.mocked(redis.expire).mockResolvedValue(1 as never);

      const middleware = rateLimit('test-action', 10, 60000);
      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      await middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Rate Limit Exceeded',
        message: 'Too many requests. Please slow down.',
        statusCode: 429,
      });
    });

    it('uses req.user.sub as the rate limit identifier when available', async () => {
      vi.mocked(redis.incr).mockResolvedValue(1);
      vi.mocked(redis.expire).mockResolvedValue(1 as never);

      const middleware = rateLimit('test-action', 10, 60000);
      const req = makeReq(); // has user.sub = 'auth0|user-1'
      const res = makeRes();
      const next = makeNext();

      await middleware(req, res, next);

      const keyUsed = vi.mocked(redis.incr).mock.calls[0][0] as string;
      expect(keyUsed).toContain('auth0|user-1');
    });

    it('uses req.ip as fallback when user is not authenticated', async () => {
      vi.mocked(redis.incr).mockResolvedValue(1);
      vi.mocked(redis.expire).mockResolvedValue(1 as never);

      const middleware = rateLimit('test-action', 10, 60000);
      // No user on request, but has ip
      const req = makeReq({ user: undefined, ip: '192.168.1.1' });
      const res = makeRes();
      const next = makeNext();

      await middleware(req, res, next);

      const keyUsed = vi.mocked(redis.incr).mock.calls[0][0] as string;
      expect(keyUsed).toContain('192.168.1.1');
    });
  });

  // ─── In-memory fallback: Redis unavailable ────────────────────────────────
  describe('fallback path (Redis unavailable)', () => {
    it('calls next() and falls back to in-memory counter when Redis throws', async () => {
      vi.mocked(redis.incr).mockRejectedValue(new Error('Redis connection refused'));

      const middleware = rateLimit('fallback-action', 10, 60000);
      const req = makeReq({ user: { sub: 'user-fallback-001' } });
      const res = makeRes();
      const next = makeNext();

      await middleware(req, res, next);

      // First request always passes (sets count to 1)
      expect(next).toHaveBeenCalledWith();
    });

    it('responds 429 in fallback mode after limit is exceeded', async () => {
      vi.mocked(redis.incr).mockRejectedValue(new Error('Redis down'));

      // Use a unique user ID to isolate this test from others in the fallback map
      const uniqueUserId = `user-limit-test-${Date.now()}`;
      const limit = 2;
      const middleware = rateLimit('fallback-limit-test', limit, 60000);

      // First request: creates entry with count=1
      const req1 = makeReq({ user: { sub: uniqueUserId } });
      await middleware(req1, makeRes(), makeNext());

      // Second request: count=2, still within limit (count <= limit means still sets in fallback)
      // The fallback logic increments an existing entry; let's check 3rd request
      const next3 = makeNext();
      const res3 = makeRes();
      const req3 = makeReq({ user: { sub: uniqueUserId } });
      await middleware(req3, res3, next3);

      // 4th request should be over limit (count > limit)
      const next4 = makeNext();
      const res4 = makeRes();
      const req4 = makeReq({ user: { sub: uniqueUserId } });
      await middleware(req4, res4, next4);

      expect(res4.status).toHaveBeenCalledWith(429);
      expect(next4).not.toHaveBeenCalled();
    });

    it('uses "unknown" identifier when neither user nor ip is available in fallback', async () => {
      vi.mocked(redis.incr).mockRejectedValue(new Error('Redis down'));

      const middleware = rateLimit('test-action', 10, 60000);
      const req = makeReq({ user: undefined, ip: undefined });
      const res = makeRes();
      const next = makeNext();

      await middleware(req, res, next);

      // Should not crash and should call next (first request in bucket)
      expect(next).toHaveBeenCalledWith();
    });
  });

  // ─── Redis key format ──────────────────────────────────────────────────────
  describe('Redis key format', () => {
    it('builds key in format ratelimit:{action}:{userId}:{bucket}', async () => {
      vi.mocked(redis.incr).mockResolvedValue(1);
      vi.mocked(redis.expire).mockResolvedValue(1 as never);

      const middleware = rateLimit('my-action', 5, 60000);
      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      await middleware(req, res, next);

      const keyUsed = vi.mocked(redis.incr).mock.calls[0][0] as string;
      expect(keyUsed).toMatch(/^ratelimit:my-action:auth0\|user-1:\d+$/);
    });
  });
});
