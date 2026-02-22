import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { errorHandler, AppError } from '../../src/middleware/errorHandler';
import { makeReq, makeRes, makeNext } from '../mocks/factories';

describe('errorHandler middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── AppError handling ─────────────────────────────────────────────────────
  describe('AppError instances', () => {
    it('responds with AppError statusCode and message', () => {
      const err = new AppError(404, 'Not Found');
      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Error',
        message: 'Not Found',
        statusCode: 404,
      });
    });

    it('uses err.code when provided', () => {
      const err = new AppError(400, 'Bad input', 'VALIDATION_ERROR');
      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'VALIDATION_ERROR',
        message: 'Bad input',
        statusCode: 400,
      });
    });

    it('uses "Error" as default when code is not provided', () => {
      const err = new AppError(403, 'Forbidden');
      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      errorHandler(err, req, res, next);

      const jsonArg = vi.mocked(res.json).mock.calls[0][0] as Record<string, unknown>;
      expect(jsonArg.error).toBe('Error');
    });

    it('handles 401 AppError correctly', () => {
      const err = new AppError(401, 'Unauthorized', 'AUTH_REQUIRED');
      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'AUTH_REQUIRED',
        message: 'Unauthorized',
        statusCode: 401,
      });
    });

    it('handles 500 AppError correctly', () => {
      const err = new AppError(500, 'Internal service error', 'SERVICE_FAILURE');
      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ─── Generic Error handling ────────────────────────────────────────────────
  describe('generic Error instances', () => {
    it('responds with 500 in production (hides real message)', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const err = new Error('secret db credentials in here');
      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      const jsonArg = vi.mocked(res.json).mock.calls[0][0] as Record<string, unknown>;
      expect(jsonArg.message).toBe('An unexpected error occurred');
      expect(jsonArg.error).toBe('Internal Server Error');
      expect(jsonArg.statusCode).toBe(500);

      process.env.NODE_ENV = originalEnv;
    });

    it('exposes the real error message in development', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const err = new Error('Cannot read property of undefined');
      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      const jsonArg = vi.mocked(res.json).mock.calls[0][0] as Record<string, unknown>;
      expect(jsonArg.message).toBe('Cannot read property of undefined');

      process.env.NODE_ENV = originalEnv;
    });

    it('exposes the real error message in test environment', () => {
      // process.env.NODE_ENV is 'test' in setup.ts — not 'production', so message shown
      const err = new Error('Test error details');
      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      errorHandler(err, req, res, next);

      const jsonArg = vi.mocked(res.json).mock.calls[0][0] as Record<string, unknown>;
      expect(jsonArg.message).toBe('Test error details');
    });

    it('does not call next for any error type', () => {
      const err = new Error('Some error');
      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      errorHandler(err, req, res, next);

      expect(next).not.toHaveBeenCalled();
    });
  });

  // ─── AppError class itself ─────────────────────────────────────────────────
  describe('AppError class', () => {
    it('sets name to AppError', () => {
      const err = new AppError(400, 'Bad Request');
      expect(err.name).toBe('AppError');
    });

    it('is an instance of Error', () => {
      const err = new AppError(400, 'Bad Request');
      expect(err).toBeInstanceOf(Error);
    });

    it('exposes statusCode, message, and code properties', () => {
      const err = new AppError(422, 'Unprocessable', 'UNPROCESSABLE');
      expect(err.statusCode).toBe(422);
      expect(err.message).toBe('Unprocessable');
      expect(err.code).toBe('UNPROCESSABLE');
    });

    it('code defaults to undefined when not provided', () => {
      const err = new AppError(400, 'Bad');
      expect(err.code).toBeUndefined();
    });
  });
});
