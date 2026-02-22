import { describe, it, expect, beforeEach, vi } from 'vitest';
import { requireAuth } from '../../src/middleware/auth';
import { makeReq, makeRes, makeNext } from '../mocks/factories';

// ─── Mock jwt and jwks-rsa ────────────────────────────────────────────────────
// We cannot run real JWT verification without Auth0, so we mock the jwt module.
vi.mock('jsonwebtoken', () => ({
  default: {
    verify: vi.fn(),
  },
}));

vi.mock('jwks-rsa', () => ({
  default: vi.fn(() => ({
    getSigningKey: vi.fn(),
  })),
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

import jwt from 'jsonwebtoken';

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
      // jwt.verify must NOT be called — reject before token parsing
      expect(jwt.verify).not.toHaveBeenCalled();
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

  // ─── JWT verification callbacks ───────────────────────────────────────────
  describe('JWT verification (mocked jwt.verify)', () => {
    it('responds 401 when jwt.verify calls back with an error', () => {
      vi.mocked(jwt.verify).mockImplementation((_token, _getKey, _options, callback) => {
        (callback as (err: Error | null, decoded?: unknown) => void)(
          new Error('jwt expired'),
          undefined,
        );
      });

      const req = makeReq({ headers: { authorization: 'Bearer expired.token.here' } });
      const res = makeRes();
      const next = makeNext();

      requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Invalid or expired token',
        statusCode: 401,
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('responds 401 when decoded payload is null', () => {
      vi.mocked(jwt.verify).mockImplementation((_token, _getKey, _options, callback) => {
        (callback as (err: null, decoded: unknown) => void)(null, null);
      });

      const req = makeReq({ headers: { authorization: 'Bearer valid.looking.token' } });
      const res = makeRes();
      const next = makeNext();

      requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Invalid token payload',
        statusCode: 401,
      });
    });

    it('responds 401 when decoded payload has no sub claim', () => {
      vi.mocked(jwt.verify).mockImplementation((_token, _getKey, _options, callback) => {
        (callback as (err: null, decoded: unknown) => void)(null, { email: 'test@example.com' });
      });

      const req = makeReq({ headers: { authorization: 'Bearer valid.looking.token' } });
      const res = makeRes();
      const next = makeNext();

      requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Invalid token payload',
        statusCode: 401,
      });
    });

    it('responds 401 when sub claim is an empty string', () => {
      vi.mocked(jwt.verify).mockImplementation((_token, _getKey, _options, callback) => {
        (callback as (err: null, decoded: unknown) => void)(null, { sub: '' });
      });

      const req = makeReq({ headers: { authorization: 'Bearer valid.looking.token' } });
      const res = makeRes();
      const next = makeNext();

      requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Invalid token payload',
        statusCode: 401,
      });
    });

    it('calls next() and attaches user when payload is valid', () => {
      const decodedPayload = {
        sub: 'auth0|user-123',
        email: 'user@example.com',
        name: 'Test User',
      };

      vi.mocked(jwt.verify).mockImplementation((_token, _getKey, _options, callback) => {
        (callback as (err: null, decoded: unknown) => void)(null, decodedPayload);
      });

      const req = makeReq({ headers: { authorization: 'Bearer valid.token.here' } });
      const res = makeRes();
      const next = makeNext();

      requireAuth(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(res.status).not.toHaveBeenCalled();

      // req.user should be attached
      const authedReq = req as unknown as { user: { sub: string; email?: string; name?: string } };
      expect(authedReq.user.sub).toBe('auth0|user-123');
      expect(authedReq.user.email).toBe('user@example.com');
      expect(authedReq.user.name).toBe('Test User');
    });

    it('attaches user with undefined email and name for M2M tokens', () => {
      const decodedPayload = { sub: 'client-id|machine' };

      vi.mocked(jwt.verify).mockImplementation((_token, _getKey, _options, callback) => {
        (callback as (err: null, decoded: unknown) => void)(null, decodedPayload);
      });

      const req = makeReq({ headers: { authorization: 'Bearer m2m.token.here' } });
      const res = makeRes();
      const next = makeNext();

      requireAuth(req, res, next);

      expect(next).toHaveBeenCalledWith();
      const authedReq = req as unknown as { user: { sub: string; email?: string; name?: string } };
      expect(authedReq.user.sub).toBe('client-id|machine');
      expect(authedReq.user.email).toBeUndefined();
      expect(authedReq.user.name).toBeUndefined();
    });

    it('calls jwt.verify with the token extracted from Bearer header', () => {
      vi.mocked(jwt.verify).mockImplementation((_token, _getKey, _options, callback) => {
        (callback as (err: Error) => void)(new Error('test'));
      });

      const req = makeReq({ headers: { authorization: 'Bearer my.special.token' } });
      const res = makeRes();
      const next = makeNext();

      requireAuth(req, res, next);

      expect(jwt.verify).toHaveBeenCalledWith(
        'my.special.token',
        expect.any(Function),
        expect.objectContaining({ algorithms: ['RS256'] }),
        expect.any(Function),
      );
    });
  });
});
