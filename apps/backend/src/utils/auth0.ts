import jwt from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';

/**
 * Single shared JWKS client for Auth0 token verification.
 * Used by both HTTP middleware (auth.ts) and WebSocket auth (server.ts).
 * Cache and rate-limit enabled to avoid hammering the Auth0 JWKS endpoint.
 */
const jwksClient = jwksRsa({
  jwksUri: `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`,
  cache: true,
  rateLimit: true,
  jwksRequestsPerMinute: 5,
});

/**
 * Verify an Auth0 JWT token and return the decoded payload.
 * This is the single source of truth for Auth0 token verification.
 * Used by both HTTP requireAuth middleware and WebSocket auth middleware.
 *
 * @param token - Raw JWT string from Authorization header or socket handshake
 * @returns Decoded JWT payload
 * @throws Error if token is invalid, expired, or fails signature verification
 */
export function verifyAuth0Token(token: string): Promise<jwt.JwtPayload> {
  return new Promise((resolve, reject) => {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || !decoded.header.kid) {
      return reject(new Error('Invalid token format'));
    }

    jwksClient.getSigningKey(decoded.header.kid, (err, key) => {
      if (err) return reject(err);

      const signingKey = key?.getPublicKey();
      if (!signingKey) return reject(new Error('No signing key found'));

      jwt.verify(
        token,
        signingKey,
        {
          audience: process.env.AUTH0_AUDIENCE,
          issuer: `https://${process.env.AUTH0_DOMAIN}/`,
          algorithms: ['RS256'],
        },
        (verifyErr, payload) => {
          if (verifyErr) return reject(verifyErr);
          resolve(payload as jwt.JwtPayload);
        }
      );
    });
  });
}
