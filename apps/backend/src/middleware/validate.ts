import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

/**
 * Express middleware factory for Zod schema validation.
 * Validates req.body, req.params, or req.query depending on the `source` parameter.
 */
export function validate(schema: ZodSchema, source: 'body' | 'params' | 'query' = 'body') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      const formatted = result.error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));

      res.status(400).json({
        error: 'Validation Error',
        message: 'Invalid request data',
        statusCode: 400,
        details: formatted,
      });
      return;
    }

    // Replace the source data with the parsed (and potentially transformed) data
    (req as unknown as Record<string, unknown>)[source] = result.data;
    next();
  };
}
