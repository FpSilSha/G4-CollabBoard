import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { auditService, AuditAction, getClientIp } from '../services/auditService';
import { verifyAuth0Token } from '../utils/auth0';

export interface AuthenticatedRequest extends Request {
  user: {
    sub: string; // Auth0 user ID (or client ID for M2M tokens)
    email?: string; // Present in user tokens, absent in M2M tokens
    name?: string; // Present in user tokens, absent in M2M tokens
  };
}

/**
 * Express middleware to validate Auth0 JWT tokens.
 * Attaches decoded user info to req.user.
 *
 * Includes runtime validation that the decoded payload contains a
 * non-empty `sub` string — prevents casting an unexpected shape.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized', message: 'Missing or invalid authorization header', statusCode: 401 });
    return;
  }

  const token = authHeader.split(' ')[1];

  verifyAuth0Token(token).then((decoded) => {
    // Runtime validation: ensure decoded payload has a non-empty sub claim
    const payload = decoded as Record<string, unknown> | undefined;
    if (!payload || typeof payload.sub !== 'string' || payload.sub.length === 0) {
      logger.warn('JWT payload missing required sub claim');
      res.status(401).json({ error: 'Unauthorized', message: 'Invalid token payload', statusCode: 401 });
      return;
    }

    (req as AuthenticatedRequest).user = {
      sub: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      name: typeof payload.name === 'string' ? payload.name : undefined,
    };

    auditService.log({
      userId: payload.sub,
      action: AuditAction.AUTH_LOGIN,
      entityType: 'auth',
      entityId: 'http',
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'] as string | undefined,
    });

    next();
  }).catch((err: Error) => {
    logger.warn('JWT verification failed:', err.message);
    auditService.log({
      userId: 'unknown',
      action: AuditAction.AUTH_FAILURE,
      entityType: 'auth',
      entityId: 'http',
      metadata: { error: err.message },
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'] as string | undefined,
    });
    res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired token', statusCode: 401 });
  });
}
