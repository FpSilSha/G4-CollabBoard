import { RATE_LIMITS } from 'shared';
import { logger } from '../utils/logger';
import type { AuthenticatedSocket } from './server';

/**
 * Per-socket in-memory rate limiter using a sliding window.
 *
 * Tracks event timestamps per socket and disconnects clients
 * that exceed RATE_LIMITS.WEBSOCKET_MESSAGES_PER_SECOND.
 *
 * This runs entirely in memory (no Redis dependency) since it is
 * scoped to individual socket connections on a single server instance.
 */
const socketEventTimestamps = new WeakMap<AuthenticatedSocket, number[]>();

/**
 * Check if the socket has exceeded the rate limit.
 * Returns true if the event should be allowed, false if it should be dropped.
 *
 * If the socket exceeds 3x the limit, it is forcibly disconnected.
 */
export function checkSocketRateLimit(socket: AuthenticatedSocket): boolean {
  const now = Date.now();
  const windowMs = 1000; // 1 second window
  const maxEvents = RATE_LIMITS.WEBSOCKET_MESSAGES_PER_SECOND;

  let timestamps = socketEventTimestamps.get(socket);
  if (!timestamps) {
    timestamps = [];
    socketEventTimestamps.set(socket, timestamps);
  }

  // Prune timestamps outside the window
  const windowStart = now - windowMs;
  while (timestamps.length > 0 && timestamps[0] < windowStart) {
    timestamps.shift();
  }

  timestamps.push(now);

  if (timestamps.length > maxEvents * 3) {
    // Egregious abuse — force disconnect
    logger.warn(
      `Socket ${socket.data.userId} force-disconnected: ${timestamps.length} events/sec (limit: ${maxEvents})`
    );
    socket.disconnect(true);
    return false;
  }

  if (timestamps.length > maxEvents) {
    // Over limit — silently drop event
    return false;
  }

  return true;
}
