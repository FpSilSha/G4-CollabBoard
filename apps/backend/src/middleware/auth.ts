import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';
import { logger } from '../utils/logger';

// JWKS client for Auth0 token verification
const jwksClient = jwksRsa({
  jwksUri: `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`,
  cache: true,
  rateLimit: true,
  jwksRequestsPerMinute: 5,
});

function getKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback) {
  jwksClient.getSigningKey(header.kid, (err, key) => {
    if (err) {
      callback(err);
      return;
    }
    const signingKey = key?.getPublicKey();
    callback(null, signingKey);
  });
}

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
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized', message: 'Missing or invalid authorization header', statusCode: 401 });
    return;
  }

  const token = authHeader.split(' ')[1];

  jwt.verify(
    token,
    getKey,
    {
      audience: process.env.AUTH0_AUDIENCE,
      issuer: `https://${process.env.AUTH0_DOMAIN}/`,
      algorithms: ['RS256'],
    },
    (err, decoded) => {
      if (err) {
        logger.warn('JWT verification failed:', err.message);
        res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired token', statusCode: 401 });
        return;
      }

      (req as AuthenticatedRequest).user = decoded as AuthenticatedRequest['user'];
      next();
    }
  );
}
