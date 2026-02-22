import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public code?: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.code || 'Error',
      message: err.message,
      statusCode: err.statusCode,
    });
    return;
  }

  logger.error('Unhandled error:', err.message, err.stack);

  // Never leak internal error details in the response body.
  // In dev, attach to a debug header for easy inspection.
  if (process.env.NODE_ENV !== 'production') {
    res.setHeader('X-Debug-Error', err.message.substring(0, 200));
  }

  res.status(500).json({
    error: 'Internal Server Error',
    message: 'An unexpected error occurred',
    statusCode: 500,
  });
}
