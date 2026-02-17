import { Server, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';
import { WEBSOCKET_CONFIG } from 'shared';
import { presenceService } from '../services/presenceService';
import { userService } from '../services/userService';
import { generateColorFromUserId, generateAvatar } from '../utils/helpers';
import { logger } from '../utils/logger';
import { registerConnectionHandlers } from './handlers/connectionHandler';
import { registerCursorHandlers } from './handlers/cursorHandler';
import { registerPresenceHandlers } from './handlers/presenceHandler';

/**
 * Extended Socket type with authenticated user data.
 */
export interface AuthenticatedSocket extends Socket {
  data: {
    userId: string;
    userName: string;
    avatar: string;
    color: string;
    currentBoardId?: string;
  };
}

// JWKS client for Auth0 WebSocket token verification
const jwksClient = jwksRsa({
  jwksUri: `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`,
  cache: true,
  rateLimit: true,
  jwksRequestsPerMinute: 5,
});

/**
 * Verify an Auth0 JWT token and return the decoded payload.
 */
function verifyAuth0Token(token: string): Promise<jwt.JwtPayload> {
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

/**
 * Initialize Socket.io server and attach it to the HTTP server.
 */
export function initializeWebSocket(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:5173',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout: WEBSOCKET_CONFIG.PING_TIMEOUT,
    pingInterval: WEBSOCKET_CONFIG.PING_INTERVAL,
    transports: ['websocket', 'polling'],
  });

  // --- Authentication Middleware ---
  // CRITICAL: Use Socket.io auth object, NOT query params or cookies (.clauderules)
  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;

    if (!token) {
      return next(new Error('Authentication token required'));
    }

    try {
      const decoded = await verifyAuth0Token(token);
      const userId = decoded.sub!;

      // Ensure user exists in our database (find or create)
      const user = await userService.findOrCreateUser(
        userId,
        decoded.email,
        decoded.name
      );

      // Attach user data to socket
      socket.data.userId = user.id;
      socket.data.userName = user.name;
      socket.data.avatar = user.avatar;
      socket.data.color = user.color;

      // Store session in Redis
      await presenceService.setSession(socket.id, user.id);

      logger.info(`WebSocket authenticated: ${user.id} (${user.name})`);
      next();
    } catch (err: any) {
      logger.warn(`WebSocket auth failed: ${err.message}`);
      next(new Error('Invalid authentication token'));
    }
  });

  // --- Connection Handler ---
  io.on('connection', (socket: Socket) => {
    const authSocket = socket as AuthenticatedSocket;
    logger.info(`Socket connected: ${authSocket.data.userId} (${socket.id})`);

    // Register all event handlers
    registerConnectionHandlers(io, authSocket);
    registerCursorHandlers(io, authSocket);
    registerPresenceHandlers(io, authSocket);
  });

  logger.info('WebSocket server initialized');
  return io;
}
