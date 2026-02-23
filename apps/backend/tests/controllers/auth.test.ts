import { describe, it, expect, beforeEach, vi } from 'vitest';
import { requireAuth } from '../../src/middleware/auth';
import { makeReq, makeRes, makeNext } from '../mocks/factories';

// ─── Mock the shared auth0 utility ───────────────────────────────────────────
// FIX-012 moved JWT verification into a shared utils/auth0.ts module.
// We mock that module so tests control what verifyAuth0Token resolves/rejects with,
// without needing real JWKS keys or Auth0 network calls.
vi.mock('../../src/utils/auth0', () => ({
  verifyAuth0Token: vi.fn(),
}));

// ─── Mock auditService ────────────────────────────────────────────────────────
vi.mock('../../src/services/auditService', () => ({
  auditService: {
    log: vi.fn(),
  },
  AuditAction: {
    AUTH_LOGIN: 'auth.login',
    AUTH_FAILURE: 'auth.failure',
  },
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

import { verifyAuth0Token } from '../../src/utils/auth0';

/** Flush all pending Promise microtasks so async .then()/.catch() chains resolve. */
const flushPromises = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('requireAuth middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Missing / malformed Authorization header ──────────────────────────────
  describe('missing or malformed Authorization header', () => {
    it('responds 401 when Authorization header is absent', () => {
      const req = makeReq({ headers: {} });
      const res = makeRes();
      const next = makeNext();

      requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Missing or invalid authorization header',
        statusCode: 401,
      });
      expect(next).not.toHaveBeenCalled();
      // verifyAuth0Token must NOT be called — reject before token parsing
      expect(verifyAuth0Token).not.toHaveBeenCalled();
    });

    it('responds 401 when header does not start with "Bearer "', () => {
      const req = makeReq({ headers: { authorization: 'Basic dXNlcjpwYXNz' } });
      const res = makeRes();
      const next = makeNext();

      requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Missing or invalid authorization header',
        statusCode: 401,
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('responds 401 when header is just "Bearer" (no space or token)', () => {
      const req = makeReq({ headers: { authorization: 'Bearer' } });
      const res = makeRes();
      const next = makeNext();

      requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('responds 401 when Authorization header is an empty string', () => {
      const req = makeReq({ headers: { authorization: '' } });
      const res = makeRes();
      const next = makeNext();

      requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  // ─── JWT verification via shared verifyAuth0Token ─────────────────────────
  // FIX-012: requireAuth now delegates to the shared verifyAuth0Token() Promise.
  // Tests control the outcome by resolving/rejecting that mock.
  describe('JWT verification (mocked verifyAuth0Token)', () => {
    it('responds 401 when verifyAuth0Token rejects (e.g. expired token)', async () => {
      vi.mocked(verifyAuth0Token).mockRejectedValue(new Error('jwt expired'));

      const req = makeReq({ headers: { authorization: 'Bearer expired.token.here' } });
      const res = makeRes();
      const next = makeNext();

      requireAuth(req, res, next);
      await flushPromises();

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Invalid or expired token',
        statusCode: 401,
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('responds 401 when decoded payload is null', async () => {
      vi.mocked(verifyAuth0Token).mockResolvedValue(null as never);

      const req = makeReq({ headers: { authorization: 'Bearer valid.looking.token' } });
      const res = makeRes();
      const next = makeNext();

      requireAuth(req, res, next);
      await flushPromises();

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Invalid token payload',
        statusCode: 401,
      });
    });

    it('responds 401 when decoded payload has no sub claim', async () => {
      vi.mocked(verifyAuth0Token).mockResolvedValue({ email: 'test@example.com' } as never);

      const req = makeReq({ headers: { authorization: 'Bearer valid.looking.token' } });
      const res = makeRes();
      const next = makeNext();

      requireAuth(req, res, next);
      await flushPromises();

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Invalid token payload',
        statusCode: 401,
      });
    });

    it('responds 401 when sub claim is an empty string', async () => {
      vi.mocked(verifyAuth0Token).mockResolvedValue({ sub: '' } as never);

      const req = makeReq({ headers: { authorization: 'Bearer valid.looking.token' } });
      const res = makeRes();
      const next = makeNext();

      requireAuth(req, res, next);
      await flushPromises();

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Invalid token payload',
        statusCode: 401,
      });
    });

    it('calls next() and attaches user when payload is valid', async () => {
      const decodedPayload = {
        sub: 'auth0|user-123',
        email: 'user@example.com',
        name: 'Test User',
      };

      vi.mocked(verifyAuth0Token).mockResolvedValue(decodedPayload as never);

      const req = makeReq({ headers: { authorization: 'Bearer valid.token.here' } });
      const res = makeRes();
      const next = makeNext();

      requireAuth(req, res, next);
      await flushPromises();

      expect(next).toHaveBeenCalledWith();
      expect(res.status).not.toHaveBeenCalled();

      // req.user should be attached
      const authedReq = req as unknown as { user: { sub: string; email?: string; name?: string } };
      expect(authedReq.user.sub).toBe('auth0|user-123');
      expect(authedReq.user.email).toBe('user@example.com');
      expect(authedReq.user.name).toBe('Test User');
    });

    it('attaches user with undefined email and name for M2M tokens', async () => {
      const decodedPayload = { sub: 'client-id|machine' };

      vi.mocked(verifyAuth0Token).mockResolvedValue(decodedPayload as never);

      const req = makeReq({ headers: { authorization: 'Bearer m2m.token.here' } });
      const res = makeRes();
      const next = makeNext();

      requireAuth(req, res, next);
      await flushPromises();

      expect(next).toHaveBeenCalledWith();
      const authedReq = req as unknown as { user: { sub: string; email?: string; name?: string } };
      expect(authedReq.user.sub).toBe('client-id|machine');
      expect(authedReq.user.email).toBeUndefined();
      expect(authedReq.user.name).toBeUndefined();
    });

    it('calls verifyAuth0Token with the token extracted from Bearer header', async () => {
      vi.mocked(verifyAuth0Token).mockRejectedValue(new Error('test'));

      const req = makeReq({ headers: { authorization: 'Bearer my.special.token' } });
      const res = makeRes();
      const next = makeNext();

      requireAuth(req, res, next);
      await flushPromises();

      expect(verifyAuth0Token).toHaveBeenCalledWith('my.special.token');
    });
  });
});
