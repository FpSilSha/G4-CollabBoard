import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { validate } from '../../src/middleware/validate';
import { makeReq, makeRes, makeNext } from '../mocks/factories';

describe('validate middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Body validation (default) ─────────────────────────────────────────────
  describe('body validation (default source)', () => {
    const schema = z.object({
      name: z.string().min(1),
      age: z.number().int().positive(),
    });

    it('calls next() and replaces req.body with parsed data on valid input', () => {
      const req = makeReq({ body: { name: 'Alice', age: 30 } });
      const res = makeRes();
      const next = makeNext();

      validate(schema)(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(res.status).not.toHaveBeenCalled();
      // The body is replaced with the zod-parsed output
      expect((req as unknown as { body: unknown }).body).toEqual({ name: 'Alice', age: 30 });
    });

    it('responds 400 when a required field is missing', () => {
      const req = makeReq({ body: { name: 'Alice' } }); // missing age
      const res = makeRes();
      const next = makeNext();

      validate(schema)(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      const jsonArg = vi.mocked(res.json).mock.calls[0][0] as Record<string, unknown>;
      expect(jsonArg.error).toBe('Validation Error');
      expect(jsonArg.statusCode).toBe(400);
      expect(Array.isArray(jsonArg.details)).toBe(true);
    });

    it('responds 400 when field type is wrong', () => {
      const req = makeReq({ body: { name: 'Alice', age: 'not-a-number' } });
      const res = makeRes();
      const next = makeNext();

      validate(schema)(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      const jsonArg = vi.mocked(res.json).mock.calls[0][0] as Record<string, unknown>;
      expect(jsonArg.error).toBe('Validation Error');
    });

    it('includes field-level error details in the 400 response', () => {
      const req = makeReq({ body: { name: '', age: -1 } });
      const res = makeRes();
      const next = makeNext();

      validate(schema)(req, res, next);

      const jsonArg = vi.mocked(res.json).mock.calls[0][0] as {
        details: { field: string; message: string }[];
      };
      expect(jsonArg.details.length).toBeGreaterThan(0);
      // Each detail must have field and message
      jsonArg.details.forEach((d) => {
        expect(typeof d.field).toBe('string');
        expect(typeof d.message).toBe('string');
      });
    });

    it('responds 400 when body is completely empty', () => {
      const req = makeReq({ body: {} });
      const res = makeRes();
      const next = makeNext();

      validate(schema)(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(next).not.toHaveBeenCalled();
    });

    it('includes "Invalid request data" as the message', () => {
      const req = makeReq({ body: {} });
      const res = makeRes();
      const next = makeNext();

      validate(schema)(req, res, next);

      const jsonArg = vi.mocked(res.json).mock.calls[0][0] as Record<string, unknown>;
      expect(jsonArg.message).toBe('Invalid request data');
    });
  });

  // ─── Params validation ─────────────────────────────────────────────────────
  describe('params validation', () => {
    const paramSchema = z.object({ id: z.string().uuid() });

    it('calls next() on valid UUID param', () => {
      const req = makeReq({ params: { id: '123e4567-e89b-12d3-a456-426614174000' } });
      const res = makeRes();
      const next = makeNext();

      validate(paramSchema, 'params')(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('responds 400 on invalid UUID param', () => {
      const req = makeReq({ params: { id: 'not-a-uuid' } });
      const res = makeRes();
      const next = makeNext();

      validate(paramSchema, 'params')(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(next).not.toHaveBeenCalled();
    });
  });

  // ─── Query validation ──────────────────────────────────────────────────────
  describe('query validation', () => {
    const querySchema = z.object({
      page: z.coerce.number().int().positive(),
    });

    it('calls next() on valid query params', () => {
      const req = makeReq({ query: { page: '1' } });
      const res = makeRes();
      const next = makeNext();

      validate(querySchema, 'query')(req, res, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('responds 400 on invalid query params', () => {
      const req = makeReq({ query: { page: 'abc' } });
      const res = makeRes();
      const next = makeNext();

      validate(querySchema, 'query')(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(next).not.toHaveBeenCalled();
    });
  });

  // ─── Zod transform / coerce ────────────────────────────────────────────────
  describe('zod transform and coerce', () => {
    it('replaces body with parsed output (including transforms)', () => {
      const schemaWithTransform = z.object({
        name: z.string().transform((s) => s.trim().toUpperCase()),
      });

      const req = makeReq({ body: { name: '  hello  ' } });
      const res = makeRes();
      const next = makeNext();

      validate(schemaWithTransform)(req, res, next);

      expect(next).toHaveBeenCalledWith();
      // The transformed value should be written back
      expect((req as unknown as { body: { name: string } }).body.name).toBe('HELLO');
    });
  });
});
