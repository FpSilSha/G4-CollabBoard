import { Server, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import { WEBSOCKET_CONFIG, WebSocketEvent } from 'shared';
import { presenceService } from '../services/presenceService';
import { userService } from '../services/userService';
import { generateColorFromUserId, generateAvatar } from '../utils/helpers';
import { logger } from '../utils/logger';
import { registerConnectionHandlers } from './handlers/connectionHandler';
import { registerCursorHandlers } from './handlers/cursorHandler';
import { registerPresenceHandlers } from './handlers/presenceHandler';
import { registerObjectHandlers } from './handlers/objectHandler';
import { registerEditHandlers } from './handlers/editHandler';
import { wsMetricsMiddleware, trackedEmit } from './wsMetrics';
import { metricsService } from '../services/metricsService';
import { auditService, AuditAction } from '../services/auditService';
import { verifyAuth0Token } from '../utils/auth0';

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

/**
 * Initialize Socket.io server and attach it to the HTTP server.
 */
let ioInstance: Server | null = null;

/** Get the global Socket.io server instance (available after initializeWebSocket). */
export function getIO(): Server {
  if (!ioInstance) throw new Error('Socket.io not initialized yet');
  return ioInstance;
}

export function initializeWebSocket(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL
        ? process.env.FRONTEND_URL.split(',').map((u) => u.trim())
        : ['http://localhost:5173', 'http://localhost:5174'],
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout: WEBSOCKET_CONFIG.PING_TIMEOUT,
    pingInterval: WEBSOCKET_CONFIG.PING_INTERVAL,
    transports: ['websocket', 'polling'],
    perMessageDeflate: {
      threshold: 1024, // Only compress messages larger than 1KB
    },
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

      // Runtime validation of JWT payload — ensure sub is a non-empty string
      if (!decoded.sub || typeof decoded.sub !== 'string') {
        return next(new Error('Invalid token payload: missing sub claim'));
      }

      const userId = decoded.sub;

      // Auth0 access tokens don't include name/email by default.
      // The frontend passes them from the ID token via socket.handshake.auth.
      // Fall back to any claims in the JWT itself (in case an Auth0 Action adds them).
      const profileName =
        (typeof socket.handshake.auth.name === 'string' ? socket.handshake.auth.name : null)
        || decoded.name as string | undefined;
      const profileEmail =
        (typeof socket.handshake.auth.email === 'string' ? socket.handshake.auth.email : null)
        || decoded.email as string | undefined;

      // Ensure user exists in our database (find or create)
      const user = await userService.findOrCreateUser(
        userId,
        profileEmail,
        profileName
      );

      // Attach user data to socket.
      // Use the DB name (which may have been updated from profile data above)
      // rather than email prefix — gives a proper display name like "John Doe".
      const displayName = user.name;
      socket.data.userId = user.id;
      socket.data.userName = displayName;
      socket.data.avatar = user.avatar;
      socket.data.color = user.color;

      // Store session in Redis
      await presenceService.setSession(socket.id, user.id);

      auditService.log({
        userId: user.id,
        action: AuditAction.AUTH_LOGIN,
        entityType: 'websocket',
        entityId: socket.id,
        metadata: { transport: 'websocket', name: user.name },
        ipAddress: socket.handshake.address,
      });

      logger.info(`WebSocket authenticated: ${user.id} (${user.name})`);
      next();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Authentication failed';

      auditService.log({
        userId: 'anonymous',
        action: AuditAction.AUTH_FAILURE,
        entityType: 'websocket',
        entityId: socket.id,
        metadata: { reason: message, transport: 'websocket' },
        ipAddress: socket.handshake.address,
      });

      logger.warn(`WebSocket auth failed: ${message}`);
      next(new Error('Invalid authentication token'));
    }
  });

  // --- Connection Handler ---
  io.on('connection', async (socket: Socket) => {
    const authSocket = socket as AuthenticatedSocket;
    const userId = authSocket.data.userId;
    logger.info(`Socket connected: ${userId} (${socket.id})`);

    // --- Duplicate session enforcement ---
    // If this userId already has an active socket, kick the old one.
    // "Last login wins" — standard pattern (Discord, Figma, Slack).
    try {
      const allSockets = await io.fetchSockets();
      for (const existing of allSockets) {
        if (
          existing.id !== socket.id &&
          (existing as unknown as AuthenticatedSocket).data.userId === userId
        ) {
          logger.info(`Duplicate session for ${userId}: kicking old socket ${existing.id}`);
          // Tell the old client WHY it's being disconnected (before severing)
          existing.emit('session:replaced', {
            reason: 'Another session was opened with this account',
            timestamp: Date.now(),
          });
          // Server-initiated disconnect (close: true = sever transport)
          existing.disconnect(true);
        }
      }
    } catch (err: unknown) {
      // Non-fatal: if fetchSockets fails, allow both connections
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logger.warn(`Duplicate session check failed for ${userId}: ${msg}`);
    }

    // --- Connection metrics ---
    metricsService.incrementWsConnection();
    socket.on('disconnect', () => {
      metricsService.decrementWsConnection();
    });

    // --- Per-socket metrics middleware ---
    // Counts all inbound events for the /metrics dashboard.
    socket.use(wsMetricsMiddleware);

    // Send authenticated user info back to client
    trackedEmit(socket, WebSocketEvent.AUTH_SUCCESS, {
      userId: authSocket.data.userId,
      name: authSocket.data.userName,
      avatar: authSocket.data.avatar,
      color: authSocket.data.color,
    });

    // Register all event handlers
    registerConnectionHandlers(io, authSocket);
    registerCursorHandlers(io, authSocket);
    registerPresenceHandlers(io, authSocket);
    registerObjectHandlers(io, authSocket);
    registerEditHandlers(io, authSocket);
  });

  ioInstance = io;
  logger.info('WebSocket server initialized');
  return io;
}
